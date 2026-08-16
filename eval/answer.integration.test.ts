// @vitest-environment node

/**
 * Offline answer-quality eval: builds the exact prompt the app sends (via the
 * real getFormattedSearchResults + getDefaultChatMessages, with the pubSub
 * state mocked to the golden query), asks a chosen LLM backend for an answer,
 * and scores it with a separate LLM judge against the golden set's reference
 * answer and rubric.
 *
 * This is the regression signal for changes to the system prompt (imported
 * from shared/defaultSystemPrompt.ts, the same source the client uses), the
 * search-results formatting, or the model. The prompt-construction checks
 * (no model, no key) live in promptConstruction.test.ts and run in the
 * default suite; only the LLM-judged tests are here. buildMessagesForGolden
 * is shared with that file (eval/goldenPrompt.ts) so both build the prompt
 * identically.
 *
 * It makes real network calls, so the judged tests are gated on an API key and
 * skip cleanly without one.
 *
 *   EVAL_LLM_API_KEY=... \
 *   EVAL_LLM_BASE_URL=https://api.openai.com/v1 \
 *   EVAL_LLM_MODEL=gpt-4o-mini \
 *   EVAL_JUDGE_MODEL=gpt-4o \
 *   npx vitest run --config vitest.eval.config.ts answer
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildMessagesForGolden, type ChatMessage } from "./goldenPrompt.ts";
import { goldenQueries } from "./goldenSet.ts";

const state = vi.hoisted(() => ({
  query: "",
  searchResults: [] as [string, string, string][],
  pageContents: {} as Record<string, string>,
  settings: {
    systemPrompt: "",
    inferenceType: "openai",
    openAiContextLength: 4096,
  } as {
    systemPrompt: string;
    inferenceType?: string;
    openAiContextLength?: number;
  },
}));

vi.mock("../client/modules/pubSub", () => ({
  getSettings: () => state.settings,
  getLlmTextSearchResults: () => state.searchResults,
  getPageContents: () => state.pageContents,
  getQuery: () => state.query,
  getSearchPromise: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

const LLM_API_KEY = process.env.EVAL_LLM_API_KEY ?? "";
// Strip any trailing slash so a configured base URL can't produce /v1//chat/....
const LLM_BASE_URL = (
  process.env.EVAL_LLM_BASE_URL ?? "https://api.openai.com/v1"
).replace(/\/$/, "");
const LLM_MODEL = process.env.EVAL_LLM_MODEL ?? "gpt-4o-mini";
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? LLM_MODEL;
// Match the app's own answer budget (openAiContextLength default) so an answer
// is not truncated for budget reasons; the judge needs far less.
const ANSWER_MAX_TOKENS = 4096;
const JUDGE_MAX_TOKENS = 512;

// A regression guard, not a quality target: the current model clears it
// comfortably, and a prompt/model change that degrades answers drops it.
const MIN_MEAN_RUBRIC_PASS = 0.7;

/**
 * The fraction of answers that cite at least one source as a Markdown link.
 * The system prompt instructs the model to cite each fact; this deterministic
 * check is what makes deleting that instruction visible. It is a rate rather
 * than a per-query assert so a single model non-citation does not fail the
 * run, while a wholesale loss of citations (the regression we care about)
 * drops the rate to near zero.
 */
const MIN_CITATION_RATE = 0.8;

// The mean rubric pass fraction over the snippet-only entries (facts that
// exist only in the search results). Graded separately so a handful of them
// can't be drowned out by the rest of the set: this is what catches the
// results path breaking while the citation rate stays high.
const MIN_SNIPPET_ONLY_PASS = 0.8;

/** True if the text contains at least one Markdown link, [any](url). */
function hasMarkdownLink(text: string): boolean {
  return /\[[^\]]+\]\([^)]+\)/.test(text);
}

const hasLlmKey = LLM_API_KEY.length > 0;

interface ChatCompletionResponse {
  error?: { message?: string };
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string;
  }[];
}

async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  label: string,
): Promise<string> {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
    // Keep each call well under the 180s per-test budget, which covers the two
    // sequential calls (answer + judge); a hung call is closed here instead of
    // outliving the test's own timeout.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`LLM call failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as ChatCompletionResponse;
  // Some OpenAI-compatible proxies return 200 with an { error } body.
  if (data.error) {
    throw new Error(`LLM error: ${JSON.stringify(data.error)}`);
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error(
      `${label} was truncated at max_tokens=${maxTokens}; raise the budget or shorten the prompt.`,
    );
  }
  const content = choice?.message?.content;
  if (typeof content !== "string") {
    // Empty choices (content filter) or null content (refusal) are not a
    // usable answer; fail loudly with the raw body for diagnosis.
    throw new Error(
      `${label} returned no usable content: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return content;
}

const JudgeResponseSchema = z.object({
  scores: z.array(z.object({ criterion: z.string(), pass: z.boolean() })),
});

interface JudgeScore {
  criterion: string;
  pass: boolean;
}

/**
 * Asks the judge to check each rubric point against the answer and return
 * strict JSON. Throws if the response is not valid JSON matching the schema,
 * or if the number of returned rubric points does not match the golden
 * rubric (a judge returning fewer points would silently inflate the score).
 */
async function judgeAnswer(
  goldenId: string,
  answer: string,
): Promise<{ scores: JudgeScore[]; passFraction: number }> {
  const golden = goldenQueries.find((g) => g.id === goldenId);
  if (!golden) throw new Error(`Unknown golden id: ${goldenId}`);

  const rubric = golden.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const judgePrompt = [
    "You are grading an AI search answer. For each numbered rubric point",
    "below, decide whether the answer satisfies it. Be strict: a point passes",
    "only if the answer clearly and correctly satisfies it.",
    "",
    `Question: ${golden.query}`,
    "",
    `Reference answer: ${golden.referenceAnswer}`,
    "",
    `Answer under evaluation:\n${answer}`,
    "",
    "Rubric points:",
    rubric,
    "",
    "Respond with ONLY a JSON object of the exact form:",
    '{"scores":[{"criterion":"<rubric point>","pass":true}]}',
    "with one entry per rubric point, in the same order.",
  ].join("\n");

  const raw = await chatCompletion(
    JUDGE_MODEL,
    [{ role: "user", content: judgePrompt }],
    JUDGE_MAX_TOKENS,
    "Judge",
  );

  const jsonText = raw
    .replace(/```json\s*/g, "")
    .replace(/```/g, "")
    .trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Judge returned no JSON object: ${raw.slice(0, 500)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    throw new Error(`Judge returned invalid JSON: ${raw.slice(0, 500)}`);
  }

  const result = JudgeResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Judge response failed schema (${result.error.message}): ${raw.slice(0, 500)}`,
    );
  }

  const scores = result.data.scores;
  if (scores.length !== golden.rubric.length) {
    throw new Error(
      `Judge returned ${scores.length} rubric points, expected ${golden.rubric.length}: ${raw.slice(0, 500)}`,
    );
  }

  const passFraction = scores.filter((s) => s.pass).length / scores.length;
  return { scores, passFraction };
}

describe("answer eval: LLM-judged quality", () => {
  // Module-level results collected by the per-query tests below and asserted
  // on by the aggregate test. Within a file, vitest runs tests in order, so
  // the per-query tests always populate this before the aggregate runs.
  const results: {
    id: string;
    passFraction: number;
    cited: boolean;
    failed: string[];
  }[] = [];

  for (const golden of goldenQueries) {
    it.skipIf(!hasLlmKey)(
      `grades ${golden.id}`,
      async () => {
        const messages = buildMessagesForGolden(state, golden.id);
        const answer = await chatCompletion(
          LLM_MODEL,
          messages,
          ANSWER_MAX_TOKENS,
          "Answer",
        );
        expect(answer.trim().length).toBeGreaterThan(0);
        const { scores, passFraction } = await judgeAnswer(golden.id, answer);
        const failed = scores.filter((s) => !s.pass).map((s) => s.criterion);
        results.push({
          id: golden.id,
          passFraction,
          cited: hasMarkdownLink(answer),
          failed,
        });
      },
      180_000,
    );
  }

  it.skipIf(!hasLlmKey)(
    "keeps the mean rubric pass fraction above the threshold",
    async () => {
      // Print the breakdown before asserting, so a per-query failure still
      // shows which queries scored what (the diagnostic you need when a
      // regression fires). The length assert below keeps the headline from
      // being a partial-run average on a complete run.
      const mean =
        results.length > 0
          ? results.reduce((sum, r) => sum + r.passFraction, 0) / results.length
          : 0;
      const citationRate =
        results.length > 0
          ? results.filter((r) => r.cited).length / results.length
          : 0;

      console.table(
        results.map((r) => ({
          id: r.id,
          "rubric pass": r.passFraction.toFixed(2),
          cited: r.cited ? "yes" : "no",
          failed: r.failed.join("; ") || "-",
        })),
      );
      console.log(
        `mean rubric pass fraction: ${mean.toFixed(3)}  citation rate: ${citationRate.toFixed(3)}`,
      );

      expect(results).toHaveLength(goldenQueries.length);
      expect(mean).toBeGreaterThanOrEqual(MIN_MEAN_RUBRIC_PASS);
      expect(
        citationRate,
        "too few answers cite their sources",
      ).toBeGreaterThanOrEqual(MIN_CITATION_RATE);

      const snippetOnlyIds = new Set(
        goldenQueries.filter((g) => g.snippetOnly).map((g) => g.id),
      );
      const snippetOnly = results.filter((r) => snippetOnlyIds.has(r.id));
      expect(
        snippetOnly.length,
        "no snippet-only entries in the golden set",
      ).toBeGreaterThan(0);
      const snippetOnlyMean =
        snippetOnly.reduce((sum, r) => sum + r.passFraction, 0) /
        snippetOnly.length;
      console.log(
        `mean snippet-only rubric pass fraction: ${snippetOnlyMean.toFixed(3)}`,
      );
      expect(
        snippetOnlyMean,
        "snippet-only facts are not being answered from the search results",
      ).toBeGreaterThanOrEqual(MIN_SNIPPET_ONLY_PASS);
    },
    60_000,
  );
});
