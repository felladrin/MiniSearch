#!/usr/bin/env node
// Scores bench answers against what the default system prompt asks for:
// answer from the results, in the question's language, citing each fact with
// a link to one of the results, never inventing a link. A case that lists
// `facts` (regular expressions) and a `language` is scored; one without them
// is only timed.
//
//   node scripts/wllama-bench/score.mjs <cases.json> <results.json> [...]
//
// See docs/wllama-model-evaluation.md for the rules and the latest results.

import { readFileSync } from "node:fs";

const STOPWORDS = {
  en: "the is was and of it to in by for are with",
  pt: "é foi que da do uma ela para com não são em ao os as",
  es: "es fue que del el la una los se en con las por",
  de: "der die das und ist war wurde am im mit sie ein eine",
  fr: "le la les est été et des du une il en pour par",
};

const SCRIPTS = {
  han: /[一-鿿]/g,
  kana: /[぀-ヿ]/g,
  hangul: /[가-힯]/g,
  arabic: /[؀-ۿ]/g,
  devanagari: /[ऀ-ॿ]/g,
  cyrillic: /[Ѐ-ӿ]/g,
};

/** Non-Latin scripts an answer in each language may use. */
const ALLOWED_SCRIPTS = {
  zh: ["han"],
  ja: ["han", "kana"],
  ko: ["hangul", "han"],
  ar: ["arabic"],
  hi: ["devanagari"],
  ru: ["cyrillic"],
};

const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const URL = /https?:\/\/[^\s)\]>"']+/g;
// A result line echoed back the way the prompt lists them: `[title](url) | snippet`.
const ECHOED_RESULT = /\[[^\]]*\]\([^)]*\)\s*\|[^\n]*/g;

const count = (text, pattern) => (text.match(pattern) ?? []).length;
// Digits of each number with three or more of them, thousands separators
// dropped. A number converted to imperial units ("1,083 ft") is derived, not
// invented, so it is skipped.
const NUMBER =
  /(\d{1,3}(?:[,.\u202f ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:(?:ft|feet|foot|miles?|mi)\b|英尺))?/g;
const digitsOf = (text) =>
  [...text.matchAll(NUMBER)]
    .filter(([, , imperialUnit]) => !imperialUnit)
    .map(([, number]) => number.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 3);

function sourceTexts(spec) {
  return [
    spec.query,
    // Titles and snippets; the URL is not text the answer can copy.
    ...spec.results.flatMap((result) => result.slice(0, 2)),
    ...Object.values(spec.pages ?? {}),
  ];
}

function detectLanguage(text) {
  const plain = text.replace(LINK, " ").replace(URL, " ");
  const scripts = Object.fromEntries(
    Object.entries(SCRIPTS).map(([name, pattern]) => [
      name,
      count(plain, pattern),
    ]),
  );
  const latin = count(plain, /[A-Za-zÀ-ÿ]/g);
  if (scripts.hangul >= 5) return "ko";
  if (scripts.arabic >= 10) return "ar";
  if (scripts.devanagari >= 10) return "hi";
  if (scripts.kana >= 3) return "ja";
  if (scripts.han >= 5 && scripts.han > latin / 4) return "zh";
  if (scripts.cyrillic > latin) return "ru";
  const words = plain.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  let best = "?";
  let bestHits = 0;
  for (const [language, list] of Object.entries(STOPWORDS)) {
    const stopwords = new Set(list.split(" "));
    const hits = words.filter((word) => stopwords.has(word)).length;
    if (hits > bestHits) [best, bestHits] = [language, hits];
  }
  return best;
}

/**
 * The language the model wrote in, ignoring what it copied from the
 * results: a snippet quoted in the question's language must not pass for an
 * answer written in it. When the copy is all there is, the copy decides,
 * since reusing the sources' own words is fine in the question's language.
 */
function answerLanguage(answer, spec) {
  let own = answer.replace(ECHOED_RESULT, " ");
  for (const source of sourceTexts(spec).slice(1)) {
    for (const fragment of source.split(/[.。!?！？,，;；:：|]/)) {
      if (fragment.trim().length >= 10)
        own = own.replaceAll(fragment.trim(), " ");
    }
  }
  const language = detectLanguage(own);
  return language === "?"
    ? detectLanguage(answer.replace(ECHOED_RESULT, " "))
    : language;
}

/** Sentences of the prompt that are instructions, not search results. */
function instructionSentences(prompt) {
  return prompt
    .split("\n")
    .filter((line) => !/^\s*(•|>)/.test(line))
    .join("\n")
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 25);
}

function scoreCase(spec, answer, prompt = "", timedOut = false) {
  const resultUrls = new Set(spec.results.map(([, , url]) => url));
  const linkedUrls = [...answer.matchAll(LINK)].map(([, , url]) => url);
  const allUrls = answer.match(URL) ?? [];
  const trimUrl = (url) => url.replace(/[.,;:]+$/, "");

  const facts =
    spec.facts.filter((fact) => new RegExp(fact, "i").test(answer)).length /
    spec.facts.length;
  const language = answer.trim() ? answerLanguage(answer, spec) : "-";
  // When no result answers the question there is nothing to cite, so saying
  // so earns the citation point too.
  const cited = spec.allowOwnKnowledge
    ? facts > 0
    : linkedUrls.some((url) => resultUrls.has(trimUrl(url)));

  const violations = timedOut ? ["timeout"] : [];
  if (
    (spec.forbidden ?? []).some((fact) => new RegExp(fact, "i").test(answer))
  ) {
    violations.push("wrong-fact");
  }
  if (allUrls.some((url) => !resultUrls.has(trimUrl(url)))) {
    violations.push("invented-link");
  }
  if (
    instructionSentences(prompt).some((sentence) => answer.includes(sentence))
  ) {
    violations.push("echoed-instructions");
  }
  const sentences = answer
    .split(/[.!?。！？\n]+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter((sentence) => sentence.length >= 20);
  if (new Set(sentences).size < sentences.length) violations.push("repetition");
  const plain = answer.replace(LINK, " ").replace(URL, " ");
  const allowed = ALLOWED_SCRIPTS[spec.language] ?? [];
  if (
    Object.entries(SCRIPTS).some(
      ([name, pattern]) =>
        !allowed.includes(name) && count(plain, pattern) >= 3,
    )
  ) {
    violations.push("foreign-script");
  }
  // Numbers the answer must compute (`allowNumbers`) are not invented, and a
  // case whose results cannot answer accepts the model's own knowledge.
  const sourceDigits = [
    ...sourceTexts(spec).flatMap(digitsOf),
    ...(spec.allowNumbers ?? []),
  ];
  if (
    !spec.allowOwnKnowledge &&
    digitsOf(plain).some(
      (digits) => !sourceDigits.some((source) => source.includes(digits)),
    )
  ) {
    violations.push("unsupported-number");
  }

  const points = Math.max(
    0,
    2 * facts +
      (language === spec.language ? 1 : 0) +
      (cited ? 1 : 0) -
      violations.length,
  );
  return {
    facts,
    language,
    cited,
    violations,
    points,
    weight: caseWeight(spec),
  };
}

/** English counts once and every other language twice: MiniSearch takes queries in any language. */
const caseWeight = (spec) => (spec.language === "en" ? 1 : 2);
const MAX_CASE_POINTS = 4;

/** Mean weighted score per model across its runs, highest first. */
export function scoreResults(cases, results) {
  const specs = new Map(cases.filter((c) => c.facts).map((c) => [c.name, c]));
  const maximum = [...specs.values()].reduce(
    (sum, spec) => sum + caseWeight(spec) * MAX_CASE_POINTS,
    0,
  );
  // The prompt depends on the case, not the model, so a result saved before
  // prompts were recorded can borrow one from another run of the same case.
  const prompts = new Map(
    results.flatMap((r) =>
      r.cases.filter((c) => c.prompt).map((c) => [c.name, c.prompt]),
    ),
  );
  const byModel = new Map();
  for (const result of results) {
    const runs = byModel.get(result.model) ?? [];
    runs.push(
      result.cases
        .filter((c) => specs.has(c.name))
        .map((c) => ({
          name: c.name,
          ...scoreCase(
            specs.get(c.name),
            c.answer,
            c.prompt ?? prompts.get(c.name),
            c.timedOut,
          ),
        })),
    );
    byModel.set(result.model, runs);
  }
  return [...byModel]
    .map(([model, runs]) => ({
      model,
      runs,
      score:
        runs.reduce(
          (sum, run) => sum + run.reduce((s, c) => s + c.points * c.weight, 0),
          0,
        ) / runs.length,
      maximum,
    }))
    .sort((a, b) => b.score - a.score);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [casesPath, ...resultPaths] = process.argv.slice(2);
  const cases = JSON.parse(readFileSync(casesPath, "utf8"));
  const results = resultPaths.flatMap((path) =>
    JSON.parse(readFileSync(path, "utf8")),
  );
  for (const { model, runs, score, maximum } of scoreResults(cases, results)) {
    const cells = runs[0]
      .map((c) => {
        const notes = runs.map((run) => {
          const r = run.find((x) => x.name === c.name);
          return `${r.points.toFixed(1)}${r.violations.length ? `!${r.violations.map((v) => v[0]).join("")}` : ""}`;
        });
        return `${c.name}=${notes.join(",")}`;
      })
      .join(" ");
    console.log(
      `${score.toFixed(1).padStart(5)}/${maximum}  ${model.padEnd(28)} ${cells}`,
    );
  }
}
