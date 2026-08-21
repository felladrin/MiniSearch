import { convert as convertHtmlToPlainText } from "html-to-text";
import { repository, version } from "../package.json" with { type: "json" };
import {
  type PageReadOutcome,
  recordPageRead,
} from "./pageReadsSinceLastRestart.ts";
import { resolvePublicUrl } from "./utils/publicUrl.ts";
import { readCappedBytes } from "./utils/streamUtils.ts";

const REQUEST_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_500_000;
/** Extracted text kept per page, before the client applies its token budget. */
const MAX_PAGE_CHARS = 6000;
/** Below this, a page yielded a cookie wall or an empty shell, not an article. */
const MIN_USEFUL_CHARS = 200;
const MIN_PASSAGE_CHARS = 180;
const MAX_PASSAGE_CHARS = 1200;
const OVERLAP_CHARS = 200;

const appName = repository.url.slice(repository.url.lastIndexOf("/") + 1);

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
  // No language preference: searches arrive in every language, and asking for
  // English made a multilingual site serve its English edition for a query
  // written in something else.
  "Accept-Language": "*",
  "User-Agent": `Mozilla/5.0 (compatible; ${appName}/${version}; +${repository.url})`,
} as const;

const READABLE_CONTENT_TYPES =
  /^(text\/html|application\/xhtml\+xml|text\/plain)/i;

/**
 * Elements that survive `baseElements` but still carry no article text:
 * cookie banners, share bars, and inline widgets.
 */
const SKIPPED_SELECTORS = [
  "aside",
  "button",
  "footer",
  "form",
  "header",
  "iframe",
  "img",
  "input",
  "nav",
  "noscript",
  "select",
  "svg",
  "textarea",
];

/**
 * Word and sentence boundaries come from ICU rather than from an expression
 * over character classes. `[^\p{L}\p{N}]+` cut Brahmic scripts and Thai at
 * every combining vowel mark and discarded the marks, turning a Hindi query
 * into one meaningless fragment, and no expression can find a boundary in
 * Chinese, Japanese or Thai, which write none: a whole sentence arrived as a
 * single token that matched nothing. Both segmenters are script-driven, so the
 * locale is left unset and the result is the same on every host.
 */
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const sentenceSegmenter = new Intl.Segmenter(undefined, {
  granularity: "sentence",
});

/**
 * A query term and a word on the page count as the same word when one is a
 * prefix of the other within these bounds. Suffix inflection is the common case
 * wherever it happens at all ("gato"/"gatos", "sleep"/"sleeping",
 * "बिल्ली"/"बिल्लियाँ"), so a shared prefix catches it without a suffix table per
 * language, and scripts that do not inflect fall back to equality.
 *
 * Three characters is the shortest prefix worth trusting, and three more is
 * about as long as an inflectional ending runs, which together keep "cat" on
 * "cats" and off "catalogue".
 *
 * Measuring in characters is a compromise, since a character is worth a
 * different amount per script: the floor rules out Chinese compounds like
 * "睡"/"睡眠". Making the rule proportional instead admits those and also lets
 * "do" match "dog", which cost more on the pages this was measured against
 * than the compounds gained.
 *
 * A false positive costs more than the noise it adds: it raises the term's
 * document frequency, which lowers the weight of a term that may have been the
 * one worth ranking on. A query for "war" against a page repeating "warm" loses
 * most of that term's weight.
 */
const MIN_PREFIX_MATCH_CHARS = 3;
const MAX_INFLECTION_CHARS = 3;

/** Extracted text for a single page, keyed by the URL it was read from. */
export interface PageContent {
  url: string;
  content: string;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function findCharset(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

/**
 * Resolves the encoding of a document. The `Content-Type` header wins, but
 * plenty of pages declare their encoding only in a `<meta>` tag, and decoding
 * those as UTF-8 turns the whole excerpt into mojibake.
 */
function decodeDocument(bytes: Uint8Array, contentType: string): string {
  try {
    const declaredCharset =
      findCharset(contentType, /charset\s*=\s*["']?([\w-]+)/i) ??
      // Only a meta element counts, the way a browser's prescan reads it: a
      // `charset=` inside a script or a link href is not a declaration. The
      // element is ASCII-compatible in every encoding worth sniffing, so
      // reading the head of the document as Latin-1 is enough to find it.
      findCharset(
        new TextDecoder("latin1").decode(bytes.slice(0, 4096)),
        /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i,
      );

    return new TextDecoder(declaredCharset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** `AbortSignal.timeout` rejects with this; a network failure is a `TypeError`. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

type DownloadResult =
  | { outcome: "ok"; html: string; bodyTruncated: boolean }
  | { outcome: Exclude<PageReadOutcome, "read" | "tooLittleText"> };

/**
 * Follows redirects by hand so that every hop is validated: `redirect:
 * "follow"` would let a public URL bounce the server into a private address.
 * The whole chain shares one deadline, so a page cannot buy extra time by
 * redirecting.
 *
 * Returns why it gave up rather than throwing, because the caller counts the
 * reasons and a thrown `Error` would have to be identified by its message.
 */
async function downloadDocument(rawUrl: string): Promise<DownloadResult> {
  let target = rawUrl;
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await resolvePublicUrl(target);
    } catch {
      return { outcome: "blocked" };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: REQUEST_HEADERS,
        redirect: "manual",
        signal: deadline,
      });
    } catch (error) {
      return { outcome: isTimeout(error) ? "timedOut" : "failed" };
    }

    const location = response.headers.get("location");
    if (isRedirect(response.status) && location) {
      await response.body?.cancel().catch(() => {});
      try {
        target = new URL(location, url).toString();
      } catch {
        return { outcome: "failed" };
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { outcome: "httpError" };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!READABLE_CONTENT_TYPES.test(contentType.trim())) {
      await response.body?.cancel().catch(() => {});
      return { outcome: "notADocument" };
    }

    try {
      const { bytes, truncated } = await readCappedBytes(
        response,
        MAX_RESPONSE_BYTES,
      );
      return {
        outcome: "ok",
        html: decodeDocument(bytes, contentType),
        bodyTruncated: truncated,
      };
    } catch (error) {
      return { outcome: isTimeout(error) ? "timedOut" : "failed" };
    }
  }

  return { outcome: "redirectLimit" };
}

/**
 * Converts a document to plain text, preferring the innermost article-like
 * container so that sidebars and site chrome never reach the prompt.
 */
export function extractReadableText(html: string): string {
  return convertHtmlToPlainText(html, {
    wordwrap: false,
    baseElements: { selectors: ["article", "main", '[role="main"]', "body"] },
    limits: { maxBaseElements: 1 },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      ...SKIPPED_SELECTORS.map((selector) => ({
        selector,
        format: "skip" as const,
      })),
    ],
  });
}

function sliceEvery(text: string, size: number): string[] {
  if (text.length <= size) return [text];

  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    pieces.push(text.slice(start, start + size));
  }
  return pieces;
}

function computeOverlap(text: string): string {
  // Carry the tail of the last sentence into the next piece so a statement
  // split across the cut is complete in at least one of them. Untrimmed so
  // the seam preserves the original spacing.
  const segments = [...sentenceSegmenter.segment(text)];
  const last = segments[segments.length - 1]?.segment ?? text;
  return last.length > OVERLAP_CHARS ? last.slice(-OVERLAP_CHARS) : last;
}

export function splitLongPassage(passage: string): string[] {
  if (passage.length <= MAX_PASSAGE_CHARS) return [passage];

  const chunks: string[] = [];
  let current = "";
  let overlap = "";

  for (const { segment } of sentenceSegmenter.segment(passage)) {
    for (const piece of sliceEvery(
      segment,
      MAX_PASSAGE_CHARS - OVERLAP_CHARS,
    )) {
      if (
        current.length + piece.length > MAX_PASSAGE_CHARS &&
        current.length > 0
      ) {
        chunks.push(current.trim());
        overlap = computeOverlap(current);
        current = "";
      }
      current += overlap + piece;
      overlap = "";
    }
  }

  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

/**
 * Splits extracted text into passages small enough to rank individually and
 * large enough to stand on their own once quoted in a prompt.
 */
export function splitIntoPassages(text: string): string[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0);

  const passages: string[] = [];
  for (const block of blocks) {
    const previous = passages[passages.length - 1];
    // A heading or a one-line list item only means something glued to the
    // block that follows it.
    if (previous !== undefined && previous.length < MIN_PASSAGE_CHARS) {
      passages[passages.length - 1] = `${previous} ${block}`;
      continue;
    }
    passages.push(block);
  }

  return passages.flatMap(splitLongPassage);
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    // Single characters are kept: they are whole words in Chinese, Japanese and
    // Korean. The weighting below is what discounts the ones that carry no
    // signal, in any language.
    if (isWordLike) tokens.push(segment.toLowerCase());
  }
  return tokens;
}

function recordPassage(
  index: Map<string, Set<number>>,
  key: string,
  passage: number,
): void {
  const passages = index.get(key);
  if (passages === undefined) index.set(key, new Set([passage]));
  else passages.add(passage);
}

/**
 * Indexes the words of a page by the keys a query term can reach them under,
 * applying the prefix rule once at build time: every word is stored whole, and
 * again under each of its prefixes that a shorter term could match.
 *
 * Comparing each term against every word instead is quadratic in a product the
 * page controls. 500,000 words of Han against a 2,000-character query is 7.5e8
 * comparisons, measured at 8s for a single page, and the endpoint reads six of
 * them concurrently on one event loop. Indexing is linear in the page and makes
 * a lookup a handful of map reads.
 */
function buildWordIndex(passageWords: Set<string>[]): {
  whole: Map<string, Set<number>>;
  prefixes: Map<string, Set<number>>;
} {
  const whole = new Map<string, Set<number>>();
  const prefixes = new Map<string, Set<number>>();

  for (const [passage, words] of passageWords.entries()) {
    for (const word of words) {
      recordPassage(whole, word, passage);
      for (
        let length = Math.max(
          MIN_PREFIX_MATCH_CHARS,
          word.length - MAX_INFLECTION_CHARS,
        );
        length < word.length;
        length++
      ) {
        recordPassage(prefixes, word.slice(0, length), passage);
      }
    }
  }

  return { whole, prefixes };
}

/**
 * The passages holding a word the prefix rule accepts for this term: the term
 * itself, the longer words it is a prefix of, and the shorter words that are a
 * prefix of it. A term below `MIN_PREFIX_MATCH_CHARS` reaches only the first,
 * which is what keeps a single Han character an exact match.
 */
function matchingPassages(
  term: string,
  index: ReturnType<typeof buildWordIndex>,
): Set<number> {
  const matches = new Set<number>();

  for (const passage of index.whole.get(term) ?? []) matches.add(passage);
  for (const passage of index.prefixes.get(term) ?? []) matches.add(passage);

  for (
    let length = Math.max(
      MIN_PREFIX_MATCH_CHARS,
      term.length - MAX_INFLECTION_CHARS,
    );
    length < term.length;
    length++
  ) {
    for (const passage of index.whole.get(term.slice(0, length)) ?? []) {
      matches.add(passage);
    }
  }

  return matches;
}

/**
 * Weighs each query term by inverse document frequency across the passages of
 * this one page, and returns how much weight each passage matched along with
 * the total available.
 *
 * This is what replaced a stop-word list, which could only ever cover the one
 * language it was written in: a term found in most passages of a page cannot
 * say which passage to quote, and a term confined to a few of them can, and
 * that holds whatever language the page is in.
 */
function weighTerms(
  queryTerms: string[],
  passageWords: Set<string>[],
): { matchedWeights: number[]; totalWeight: number } {
  const index = buildWordIndex(passageWords);
  const matchedWeights = passageWords.map(() => 0);
  let totalWeight = 0;

  for (const term of queryTerms) {
    const matches = matchingPassages(term, index);
    const weight = Math.log(
      1 + (passageWords.length - matches.size + 0.5) / (matches.size + 0.5),
    );

    totalWeight += weight;
    for (const passage of matches) matchedWeights[passage] += weight;
  }

  return { matchedWeights, totalWeight };
}

function scorePassage(
  matchedWeight: number,
  totalWeight: number,
  termCount: number,
  index: number,
): number {
  const position = 1 / (1 + index);
  if (termCount === 0) return position;

  // Lead passages carry the definition or summary on most pages, so they get a
  // prior worth half a matched term: enough to break ties and to float the
  // intro of a page whose body never repeats the query, never enough to
  // outrank a passage that covers more of it.
  return matchedWeight / totalWeight + (0.5 * position) / termCount;
}

/**
 * Picks the passages that best cover the query, within a character budget.
 *
 * The excerpt comes back best-first rather than in document order, because the
 * client trims it again against the model's context and keeps a prefix. Under
 * document order that prefix is whatever the page put at the top, which on an
 * article is its navigation and its infobox, so the ranking below decided only
 * what was transferred and never what the model read.
 *
 * @param passages - Candidate passages from a single page, which is the scope
 * the weighting below is relative to
 */
export function selectPassages(
  query: string,
  passages: string[],
  maxChars: number,
): string[] {
  const passageWords = passages.map((text) => new Set(tokenize(text)));
  const queryTerms = [...new Set(tokenize(query))];
  const { matchedWeights, totalWeight } = weighTerms(queryTerms, passageWords);

  const ranked = passages
    .map((text, index) => ({
      index,
      text,
      score: scorePassage(
        matchedWeights[index],
        totalWeight,
        queryTerms.length,
        index,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: string[] = [];
  let usedChars = 0;

  for (const passage of ranked) {
    // Skipping rather than stopping lets a shorter passage further down the
    // ranking still fill what is left of the budget.
    if (usedChars + passage.text.length > maxChars) continue;
    selected.push(passage.text);
    usedChars += passage.text.length + 1;
  }

  return selected;
}

async function fetchPageContent(
  query: string,
  url: string,
): Promise<PageContent | null> {
  const startedAt = performance.now();
  const since = () => performance.now() - startedAt;

  const download = await downloadDocument(url);

  if (download.outcome !== "ok") {
    recordPageRead({ outcome: download.outcome, durationMs: since() });
    return null;
  }

  const { bodyTruncated } = download;

  try {
    const passages = splitIntoPassages(extractReadableText(download.html));
    const selected = selectPassages(query, passages, MAX_PAGE_CHARS);
    const content = selected.join("\n");

    if (content.length < MIN_USEFUL_CHARS) {
      recordPageRead({
        outcome: "tooLittleText",
        durationMs: since(),
        bodyTruncated,
      });
      return null;
    }

    recordPageRead({
      outcome: "read",
      durationMs: since(),
      bodyTruncated,
      passagesKept: selected.length,
      passagesAvailable: passages.length,
    });

    return { url, content };
  } catch {
    recordPageRead({
      outcome: "failed",
      durationMs: since(),
      bodyTruncated,
    });
    return null;
  }
}

/**
 * Reads the given pages and returns the passages most relevant to the query.
 * Pages that fail, time out, or carry no readable text are left out instead of
 * failing the batch: a partial set of excerpts still grounds the answer.
 *
 * Nothing here is logged. Every read is counted instead, by outcome, in
 * `pageReadsSinceLastRestart`, since a line naming the query or the URL would
 * record what someone searched for.
 *
 * @param urls - Page URLs to read, already ranked by the search pipeline
 * @returns One entry per page that yielded usable text
 */
export async function fetchPageContents(
  query: string,
  urls: string[],
): Promise<PageContent[]> {
  const contents = await Promise.all(
    urls.map((url) => fetchPageContent(query, url)),
  );

  return contents.filter((content): content is PageContent => content !== null);
}
