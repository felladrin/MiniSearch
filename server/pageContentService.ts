import { convert as convertHtmlToPlainText } from "html-to-text";
import { PDFParse } from "pdf-parse";
import { repository, version } from "../package.json" with { type: "json" };
import { scorePassages } from "./biEncoderService.ts";
import {
  type PageReadHostBreaker,
  pageReadHostBreaker,
} from "./pageReadHostBreaker.ts";
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
const MAX_DENSE_PASSAGES = 256;
const RRF_K = 60;

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
 *
 * Site chrome by element name (`nav`, `header`, `footer`, `aside`, `form`) is
 * not listed here: `stripLinkHeavyBlocks` already drops those blocks, and a
 * document whose `<nav>` never closes would otherwise have everything after it
 * skipped by the converter, article included.
 */
const SKIPPED_SELECTORS = [
  "button",
  "iframe",
  "img",
  "input",
  "noscript",
  "select",
  "svg",
  "textarea",
];

/**
 * A block whose text sits mostly inside links is a navigation list — a menu, a
 * breadcrumb, a "worth reading too" rail, a tag cloud, a footer map — not
 * prose. Those blocks name the page's topic more often than the article does,
 * so under inverse document frequency they outrank the paragraph that answers
 * the query, and since the client keeps a prefix of the excerpt, what the
 * navigation covers is what the model ends up reading.
 *
 * 60% of a block's text being link text is where the line sits: a prose
 * paragraph with inline links stays far below it (the guides this was measured
 * on stayed under 20%), while a list of links runs 90-100%. Measured on the
 * Sortir à Paris Disney+ guide, this drops 228 link blocks covering 55,238 of
 * the page's 57,160 characters and leaves 2,262 characters of article text.
 */
const LINK_DENSITY_THRESHOLD = 0.6;
/** Below this, a block is a caption or a label, not a navigation worth a verdict. */
const NAV_BLOCK_MIN_CHARS = 120;
/** Site chrome by element name, dropped before any density is measured. */
const ALWAYS_DROPPED_TAGS = new Set([
  "aside",
  "footer",
  "form",
  "header",
  "nav",
]);
/** Blocks whose own text can be judged and removed as a whole. */
const TEXT_BLOCK_TAGS = new Set([
  "article",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figure",
  "figcaption",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface TextBlock {
  tag: string;
  start: number;
  /** Collapsed text length the block holds, after its own dropped children. */
  textChars: number;
  linkChars: number;
  /** Link depth on entry, restored when the block closes over an unclosed `<a>`. */
  linkDepthAtStart: number;
  /** A descendant block holds prose, so this container is not a navigation. */
  proseChild: boolean;
  /** Site chrome is removed on its closing tag, whatever its density. */
  alwaysDrop: boolean;
}

/** `>` inside a quoted attribute value does not end the tag. */
function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < html.length; index++) {
    const character = html[index];
    if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

/** Finds `</tag` without copying or lowercasing the document per script tag. */
function indexOfClosingTag(html: string, from: number, tag: string): number {
  const needle = `</${tag}`;
  for (
    let at = html.indexOf("<", from);
    at !== -1;
    at = html.indexOf("<", at + 1)
  ) {
    if (html.slice(at, at + needle.length).toLowerCase() === needle) return at;
  }
  return -1;
}

/**
 * Removes blocks that are navigation rather than content, before conversion.
 *
 * html-to-text already skips `<nav>`, `<header>`, `<footer>` and `<aside>`, but
 * sites built out of `<div>`s — the one this was measured on has no `<article>`
 * or `<main>` at all — put the same chrome in plain divs, where only the text
 * itself can tell it apart from an article. This pass walks the document once,
 * keeping a stack of the blocks it is inside, and measures each block as it
 * closes: how much of its text is link text, and how much is left once the
 * blocks it already dropped are gone. That inner-first order is what keeps a
 * page wrapper alive — it still holds the article's prose — while the rails
 * inside it go.
 *
 * The scan is deliberately forgiving rather than a parser: an unclosed block
 * is simply not dropped, because dropping on a guess would delete article text,
 * and that costs more here than leaving a rail in place.
 */
function stripLinkHeavyBlocks(html: string): string {
  const blocks: TextBlock[] = [];
  const removals: [start: number, end: number][] = [];
  let linkDepth = 0;
  let index = 0;

  const addText = (raw: string) => {
    const chars = raw.replace(/\s+/g, " ").trim().length;
    if (chars === 0) return;
    const block = blocks[blocks.length - 1];
    if (block === undefined) return;
    block.textChars += chars;
    if (linkDepth > 0) block.linkChars += chars;
  };

  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) {
      addText(html.slice(index));
      break;
    }
    if (tagStart > index) addText(html.slice(index, tagStart));

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      index = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) {
      addText(html.slice(tagStart));
      break;
    }
    const raw = html.slice(tagStart + 1, tagEnd);
    index = tagEnd + 1;

    if (raw.startsWith("!") || raw.startsWith("?")) continue;

    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw);
    if (nameMatch === null) continue;
    const tag = nameMatch[1].toLowerCase();
    const closing = raw.startsWith("/");
    const selfClosing = !closing && raw.trimEnd().endsWith("/");

    // A script's contents are not text; counting them would read as prose.
    if (tag === "script" || tag === "style" || tag === "noscript") {
      if (!closing) {
        const close = indexOfClosingTag(html, index, tag);
        if (close !== -1) {
          const closeEnd = findTagEnd(html, close);
          index = closeEnd === -1 ? html.length : closeEnd + 1;
        }
      }
      continue;
    }

    if (closing) {
      if (tag === "a") linkDepth = Math.max(0, linkDepth - 1);
      let at = -1;
      for (let scan = blocks.length - 1; scan >= 0; scan--) {
        if (blocks[scan].tag === tag) {
          at = scan;
          break;
        }
      }
      if (at === -1) continue;

      // Empty elements such as `<p>` and `<li>` may omit their closing tag. The
      // only end marker this scan has belongs to the ancestor that is closing
      // now, so a removal taken from it would delete the ancestor's remaining
      // text. Fold such a block into the block that closed instead: its text is
      // still counted, and nothing is dropped on a guess.
      while (blocks.length - 1 > at) {
        const unclosed = blocks.pop();
        if (unclosed === undefined) break;
        const matched = blocks[at];
        matched.textChars += unclosed.textChars;
        matched.linkChars += unclosed.linkChars;
        matched.proseChild ||= unclosed.proseChild;
      }

      const block = blocks.pop();
      if (block === undefined) {
        linkDepth = 0;
        continue;
      }
      linkDepth = block.linkDepthAtStart;

      // A container is removed only when the whole subtree reads as links: a
      // page-wide wrapper that also holds the article must not take it down.
      const drop =
        block.alwaysDrop ||
        (!block.proseChild &&
          block.textChars >= NAV_BLOCK_MIN_CHARS &&
          block.linkChars / block.textChars >= LINK_DENSITY_THRESHOLD);
      if (drop) {
        removals.push([block.start, tagEnd + 1]);
      } else if (blocks.length > 0) {
        const parent = blocks[blocks.length - 1];
        parent.textChars += block.textChars;
        parent.linkChars += block.linkChars;
        const prose =
          block.proseChild ||
          (block.textChars > 0 &&
            block.linkChars / block.textChars < LINK_DENSITY_THRESHOLD);
        parent.proseChild ||= prose;
      }
      continue;
    }

    if (selfClosing || VOID_TAGS.has(tag)) continue;
    if (tag === "a") linkDepth++;
    if (TEXT_BLOCK_TAGS.has(tag) || ALWAYS_DROPPED_TAGS.has(tag)) {
      blocks.push({
        tag,
        start: tagStart,
        textChars: 0,
        linkChars: 0,
        linkDepthAtStart: linkDepth,
        proseChild: false,
        alwaysDrop: ALWAYS_DROPPED_TAGS.has(tag),
      });
    }
  }

  if (removals.length === 0) return html;

  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of removals.sort((a, b) => a[0] - b[0])) {
    // A removal nested inside one already taken out is already gone.
    if (start < cursor) continue;
    parts.push(html.slice(cursor, start));
    cursor = end;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}

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

interface RankedPassage {
  url: string;
  text: string;
  score: number;
  index: number;
  tokens: Set<string>;
}

interface FetchedPage {
  url: string;
  passages: string[];
  /** Headline words of the page, scored as a prior over its own passages. */
  contextTerms: string[];
  durationMs: number;
  bodyTruncated: boolean;
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

function classifyHttpError(
  status: number,
): "httpForbidden" | "httpNotFound" | "httpOtherError" {
  if (status === 401 || status === 403 || status === 429) {
    return "httpForbidden";
  }
  if (status === 404 || status === 410) {
    return "httpNotFound";
  }
  return "httpOtherError";
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
  | { outcome: "ok"; html?: string; text?: string; bodyTruncated: boolean }
  | { outcome: Exclude<PageReadOutcome, "read" | "tooLittleText"> };

type HopResult = DownloadResult | { outcome: "redirect"; target: string };

/**
 * One request of a redirect chain: the fetch, and the body unless the host
 * answered with a redirect. Everything it can fail on comes back as an outcome
 * rather than an exception, so its caller can settle the host's circuit on it.
 */
async function readHop(url: URL, deadline: AbortSignal): Promise<HopResult> {
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
      return { outcome: "redirect", target: new URL(location, url).toString() };
    } catch {
      return { outcome: "failed" };
    }
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { outcome: classifyHttpError(response.status) };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!READABLE_CONTENT_TYPES.test(contentType.trim())) {
    // PDF is not in READABLE_CONTENT_TYPES but we still want to read it.
    if (!contentType.trim().toLowerCase().startsWith("application/pdf")) {
      await response.body?.cancel().catch(() => {});
      return { outcome: "notADocument" };
    }
  }

  try {
    const { bytes, truncated } = await readCappedBytes(
      response,
      MAX_RESPONSE_BYTES,
    );
    if (contentType.trim().toLowerCase().startsWith("application/pdf")) {
      return {
        outcome: "ok",
        text: await extractPdfText(bytes),
        bodyTruncated: truncated,
      };
    }
    return {
      outcome: "ok",
      html: decodeDocument(bytes, contentType),
      bodyTruncated: truncated,
    };
  } catch (error) {
    return { outcome: isTimeout(error) ? "timedOut" : "failed" };
  }
}

/**
 * Follows redirects by hand so that every hop is validated: `redirect:
 * "follow"` would let a public URL bounce the server into a private address.
 * The whole chain shares one deadline, so a page cannot buy extra time by
 * redirecting.
 *
 * Each hop runs under the circuit of the host it is about to reach, keyed on
 * `url.host` once `resolvePublicUrl` has cleared it, so a chain that lands on
 * a boxed host stops there and a redirect counts for the host that sent it.
 *
 * Returns why it gave up rather than throwing, because the caller counts the
 * reasons and a thrown `Error` would have to be identified by its message.
 */
async function downloadDocument(
  rawUrl: string,
  breaker: PageReadHostBreaker,
): Promise<DownloadResult> {
  let target = rawUrl;
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await resolvePublicUrl(target);
    } catch {
      return { outcome: "blocked" };
    }

    if (!breaker.admit(url.host)) return { outcome: "skippedByBreaker" };

    // Settled whatever happens, or a half-open host would wait forever for a
    // probe that never reported back.
    let result: HopResult = { outcome: "failed" };
    try {
      result = await readHop(url, deadline);
    } finally {
      breaker.settle(url.host, result.outcome);
    }

    if (result.outcome !== "redirect") return result;
    target = result.target;
  }

  return { outcome: "redirectLimit" };
}

/**
 * A parser holds an open pdf.js document behind it, so it has to be destroyed
 * even when reading throws, or its worker outlives the request. `bytes` is
 * transferred to that worker rather than copied, so it comes back empty and
 * must not be read after this.
 */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });

  try {
    const { text } = await parser.getText();
    return text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Converts a document to plain text, preferring the innermost article-like
 * container so that sidebars and site chrome never reach the prompt.
 *
 * Navigation that lives in plain divs is removed first, because the conversion
 * has no way to tell a rail of links from a paragraph — see
 * `stripLinkHeavyBlocks`.
 */
/** Site chrome the density pass drops by element name, listed for the fallback. */
const CHROME_SELECTORS = ["aside", "footer", "form", "header", "nav"];

function conversionOptions(skippedSelectors: string[]) {
  return {
    wordwrap: false as const,
    baseElements: { selectors: ["article", "main", '[role="main"]', "body"] },
    limits: { maxBaseElements: 1 },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      ...skippedSelectors.map((selector) => ({
        selector,
        format: "skip" as const,
      })),
    ],
  };
}

export function extractReadableText(html: string): string {
  const stripped = stripLinkHeavyBlocks(html);
  const text = convertHtmlToPlainText(
    stripped,
    conversionOptions(SKIPPED_SELECTORS),
  );

  // A page that is nothing but a link table loses every block to the density
  // rule and reads as empty. That page still answers "where is the list", so
  // fall back to its unstripped text rather than drop the result; chrome is
  // skipped by element name there, since the density pass did not run.
  if (stripped === html || text.trim().length >= MIN_USEFUL_CHARS) return text;

  const fallback = convertHtmlToPlainText(
    html,
    conversionOptions([...SKIPPED_SELECTORS, ...CHROME_SELECTORS]),
  );
  return fallback.trim().length > text.trim().length ? fallback : text;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, body: string) => {
    if (!body.startsWith("#")) {
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    }
    const code =
      body[1]?.toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
    return String.fromCodePoint(code);
  });
}

/**
 * Words that name what the page itself is about: its `<title>` plus the `h1`
 * and `h2` text around the article.
 *
 * The headline is the publisher's own one-line summary of the subject, and it
 * is usually phrased in the query's vocabulary even when the body paraphrases
 * it or buries it below a promotional rail. Scoring these words as *context*
 * rather than as extra query terms keeps them from inventing evidence: a
 * passage gains only by repeating the page's own headline, which a rail of
 * unrelated teasers does not do.
 *
 * Only the top two heading levels are read: `h3`-down is section furniture on
 * most sites ("Share", "Comments", "More from"), and on the pages this was
 * measured against it added vocabulary that the body already carried.
 */
const CONTEXT_TERM_WEIGHT = 0.15;
const TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const HEADING_PATTERN = /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/gi;

function extractPageContext(html: string): string[] {
  const parts: string[] = [];

  const title = TITLE_PATTERN.exec(html)?.[1];
  if (title !== undefined) parts.push(title);

  for (const heading of html.matchAll(HEADING_PATTERN)) {
    if (heading[1] !== undefined) parts.push(heading[1]);
  }

  const text = decodeEntities(parts.join(" ")).replace(/<[^>]*>/g, " ");
  return [...new Set(tokenize(text))];
}

/**
 * How much of the page's own headline vocabulary a passage carries, as a
 * fraction of the distinct context words. Exact tokens only: the context is
 * small, and the prefix rule the query uses would let a generic heading word
 * ("Disney") reach a passage about Disneyland.
 */
function contextCoverage(words: Set<string>, contextTerms: string[]): number {
  if (contextTerms.length === 0) return 0;

  let matched = 0;
  for (const term of contextTerms) {
    if (words.has(term)) matched++;
  }
  return matched / contextTerms.length;
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
 * the current pool, and returns how much weight each passage matched along
 * with the total available.
 *
 * This is what replaced a stop-word list, which could only ever cover the one
 * language it was written in: a term found in most passages of a pool cannot
 * say which passage to quote, and a term confined to a few of them can, and
 * that holds whatever language the pool is in.
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
  positionInPage: number,
  contextCoverage: number,
): number {
  const position = 1 / (1 + positionInPage);
  if (termCount === 0) return position;

  // Lead passages carry the definition or summary on most pages, so they get a
  // prior worth half a matched term: enough to break ties and to float the
  // intro of a page whose body never repeats the query, never enough to
  // outrank a passage that covers more of it.
  //
  // The page's own headline is worth a fraction of a matched term on top: it
  // says the page is about the query even where the body says it in other
  // words, and it costs a passage nothing to ignore, since only a passage that
  // repeats the headline collects it.
  return (
    matchedWeight / totalWeight +
    (0.5 * position) / termCount +
    CONTEXT_TERM_WEIGHT * contextCoverage
  );
}

/**
 * Ranks passages by how well they cover the query, using IDF weighting over
 * the whole pool.
 *
 * @param passages - Candidate passages with their source URLs. The ranking is
 * relative to this global pool, so term statistics are computed across all
 * pages, not per page. `contextTerms` are the headline words of the page the
 * passage came from, if any.
 */
function rankPassages(
  query: string,
  passages: {
    url: string;
    text: string;
    positionInPage: number;
    contextTerms?: string[];
  }[],
): RankedPassage[] {
  const passageWords = passages.map((p) => new Set(tokenize(p.text)));
  const queryTerms = [...new Set(tokenize(query))];
  const { matchedWeights, totalWeight } = weighTerms(queryTerms, passageWords);

  return passages
    .map((p, index) => ({
      url: p.url,
      text: p.text,
      score: scorePassage(
        matchedWeights[index],
        totalWeight,
        queryTerms.length,
        p.positionInPage,
        contextCoverage(passageWords[index], p.contextTerms ?? []),
      ),
      index,
      tokens: passageWords[index],
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

async function rankPassagesWithDenseScores(
  query: string,
  passages: {
    url: string;
    text: string;
    positionInPage: number;
    contextTerms?: string[];
  }[],
): Promise<RankedPassage[]> {
  const lexicalRanked = rankPassages(query, passages);
  if (passages.length === 0 || passages.length > MAX_DENSE_PASSAGES) {
    return lexicalRanked;
  }

  let denseScores: number[];
  try {
    denseScores = await scorePassages(
      query,
      passages.map((p) => p.text),
    );
  } catch {
    console.warn("Dense passage scoring failed; using lexical ranking.");
    return lexicalRanked;
  }
  if (denseScores.length === 0) return lexicalRanked;

  const denseRanks: number[] = [];
  denseScores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .forEach(({ index }, rank) => {
      denseRanks[index] = rank + 1;
    });

  return lexicalRanked
    .map((passage, rank) => ({
      ...passage,
      score: 1 / (RRF_K + rank + 1) + 1 / (RRF_K + denseRanks[passage.index]),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

const JACCARD_THRESHOLD = 0.9;

/**
 * Selects passages from a globally ranked pool, applying a per-URL character
 * cap and suppressing near-duplicates via token-set Jaccard similarity.
 *
 * The same paragraph that appears on several pages reaches the prompt once.
 * Passages that are near-duplicates of already-selected ones from a *different*
 * URL are skipped, so a page whose passages all overlap with earlier picks
 * keeps its snippet-only line with no empty excerpt block.
 */
function selectPassagesAcrossPages(
  ranked: RankedPassage[],
  maxChars: number,
  maxCharsPerUrl: number,
): Map<string, string[]> {
  const selectedByUrl = new Map<string, string[]>();
  // Track every selected passage's tokens for cross-URL dedup.
  // Passages from the same page are allowed to coexist; dedup is only for
  // syndicated paragraphs that appear on different pages.
  const selectedTokens: { url: string; tokens: Set<string> }[] = [];
  let usedChars = 0;
  const usedPerUrl = new Map<string, number>();

  for (const passage of ranked) {
    if (usedChars + passage.text.length > maxChars) continue;
    if (
      (usedPerUrl.get(passage.url) ?? 0) + passage.text.length >
      maxCharsPerUrl
    )
      continue;

    // Check against all selected passages from other URLs.
    // Size prefilter: Jaccard ≥ 0.9 requires sizes within 10×, so skip
    // comparisons where the ratio is too small.
    let isDuplicate = false;
    for (const { url: otherUrl, tokens: otherTokens } of selectedTokens) {
      if (otherUrl === passage.url) continue;
      const minSize = Math.min(passage.tokens.size, otherTokens.size);
      const maxSize = Math.max(passage.tokens.size, otherTokens.size);
      if (minSize * 10 < maxSize * 9) continue;
      const intersection = [...passage.tokens].filter((t) =>
        otherTokens.has(t),
      ).length;
      // union = a.size + b.size - intersection; avoids allocating a Set.
      const union = passage.tokens.size + otherTokens.size - intersection;
      if (union > 0 && intersection / union >= JACCARD_THRESHOLD) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) continue;

    const existing = selectedByUrl.get(passage.url);
    if (existing === undefined) {
      selectedByUrl.set(passage.url, [passage.text]);
    } else {
      existing.push(passage.text);
    }
    selectedTokens.push({ url: passage.url, tokens: passage.tokens });
    usedChars += passage.text.length + 1;
    usedPerUrl.set(
      passage.url,
      (usedPerUrl.get(passage.url) ?? 0) + passage.text.length + 1,
    );
  }

  return selectedByUrl;
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
 * Lexical and dense (bi-encoder) scores are fused with reciprocal rank fusion;
 * unavailable or failed scoring and pools above 256 passages keep lexical order.
 *
 * @param passages - Candidate passages from a single page; the wrapper feeds
 * them through the production selector so tests exercise the real code path.
 */
export async function selectPassages(
  query: string,
  passages: string[],
  maxChars: number,
): Promise<string[]> {
  // Single-page wrapper over the production selector so tests exercise the
  // real code path.
  const input = passages.map((text, index) => ({
    url: "",
    text,
    positionInPage: index,
  }));

  const fused = await rankPassagesWithDenseScores(query, input);

  return selectPassagesAcrossPages(fused, maxChars, maxChars).get("") ?? [];
}

async function fetchPageContent(
  url: string,
  breaker: PageReadHostBreaker,
): Promise<{
  url: string;
  passages: string[];
  durationMs: number;
  bodyTruncated: boolean;
  contextTerms: string[];
} | null> {
  const startedAt = performance.now();
  const since = () => performance.now() - startedAt;

  const download = await downloadDocument(url, breaker);

  if (download.outcome !== "ok") {
    recordPageRead({ outcome: download.outcome, durationMs: since() });
    return null;
  }

  const { bodyTruncated } = download;

  try {
    const html = download.text ?? extractReadableText(download.html ?? "");
    const passages = splitIntoPassages(html);
    const content = passages.join("\n");
    // A PDF has no markup to read a headline out of, so it ranks on the query
    // alone.
    const contextTerms =
      download.html === undefined ? [] : extractPageContext(download.html);

    if (content.length < MIN_USEFUL_CHARS) {
      recordPageRead({
        outcome: "tooLittleText",
        durationMs: since(),
        bodyTruncated,
      });
      return null;
    }

    // Don't record passage stats here — selection happens globally in
    // fetchPageContents, and we need to report how many passages actually
    // survived the global budget, not how many the page yielded.
    return {
      url,
      passages,
      durationMs: since(),
      bodyTruncated,
      contextTerms,
    };
  } catch {
    recordPageRead({
      outcome: "failed",
      durationMs: performance.now() - startedAt,
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
 * Passages from all pages are ranked together, then selected with a per-URL
 * character cap and near-duplicate suppression, so syndicated paragraphs that
 * appear on several pages reach the prompt once.
 *
 * A host that refused enough recent reads is skipped without a request, under
 * `breaker`, and that skip is counted like any other outcome.
 *
 * Nothing here is logged. Every read is counted instead, by outcome, in
 * `pageReadsSinceLastRestart`, since a line naming the query or the URL would
 * record what someone searched for.
 *
 * @param urls - Page URLs to read, already ranked by the search pipeline
 * @param breaker - The per-host circuits to read under; injectable for tests
 * @returns One entry per page that yielded usable text
 */
export async function fetchPageContents(
  query: string,
  urls: string[],
  breaker: PageReadHostBreaker = pageReadHostBreaker,
): Promise<PageContent[]> {
  const results = await Promise.all(
    urls.map((url) => fetchPageContent(url, breaker)),
  );

  const pages = results.filter((r): r is FetchedPage => r !== null);

  if (pages.length === 0) return [];

  const allPassages = pages.flatMap((p) =>
    p.passages.map((text, passageIndex) => ({
      url: p.url,
      text,
      positionInPage: passageIndex,
      contextTerms: p.contextTerms,
    })),
  );

  const ranked = await rankPassagesWithDenseScores(query, allPassages);
  const selectedByUrl = selectPassagesAcrossPages(
    ranked,
    MAX_PAGE_CHARS * pages.length,
    MAX_PAGE_CHARS,
  );

  // Record page-read stats now that we know how many passages were kept.
  for (const page of pages) {
    const selected = selectedByUrl.get(page.url) ?? [];
    recordPageRead({
      outcome: "read",
      durationMs: page.durationMs,
      bodyTruncated: page.bodyTruncated,
      passagesKept: selected.length,
      passagesAvailable: page.passages.length,
    });
  }

  return pages
    .map((p) => {
      const selected = selectedByUrl.get(p.url) ?? [];
      return { url: p.url, content: selected.join("\n") };
    })
    .filter((c) => c.content.length > 0);
}
