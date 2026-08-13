import { basename } from "node:path";
import debug from "debug";
import { convert as convertHtmlToPlainText } from "html-to-text";
import { resolvePublicUrl } from "./utils/publicUrl.ts";

const fileName = basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const REQUEST_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_500_000;
/** Extracted text kept per page, before the client applies its token budget. */
const MAX_PAGE_CHARS = 6000;
/** Below this, a page yielded a cookie wall or an empty shell, not an article. */
const MIN_USEFUL_CHARS = 200;
const MIN_PASSAGE_CHARS = 180;
const MAX_PASSAGE_CHARS = 1200;

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
  "Accept-Language": "en;q=0.9,*;q=0.5",
  "User-Agent":
    "Mozilla/5.0 (compatible; MiniSearch/1.0; +https://github.com/felladrin/MiniSearch)",
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

const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "its",
  "not",
  "the",
  "that",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

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

/**
 * Reads at most `MAX_RESPONSE_BYTES` of the body. A hostile or merely huge
 * page must not be able to pin the server's memory, and the extractor gains
 * nothing from the tail of a document it will trim to a few passages anyway.
 */
async function readCappedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  while (bytesRead < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    chunks.push(value);
  }

  await reader.cancel().catch(() => {});

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Follows redirects by hand so that every hop is validated: `redirect:
 * "follow"` would let a public URL bounce the server into a private address.
 * The whole chain shares one deadline, so a page cannot buy extra time by
 * redirecting.
 */
async function downloadDocument(rawUrl: string): Promise<string | null> {
  let target = rawUrl;
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await resolvePublicUrl(target);
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      redirect: "manual",
      signal: deadline,
    });

    const location = response.headers.get("location");
    if (isRedirect(response.status) && location) {
      await response.body?.cancel().catch(() => {});
      target = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!READABLE_CONTENT_TYPES.test(contentType.trim())) {
      await response.body?.cancel().catch(() => {});
      return null;
    }

    return decodeDocument(await readCappedBytes(response), contentType);
  }

  throw new Error(`Exceeded ${MAX_REDIRECTS} redirects`);
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

function splitLongPassage(passage: string): string[] {
  if (passage.length <= MAX_PASSAGE_CHARS) return [passage];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of passage.match(/[^.!?]+[.!?]*\s*/g) ?? [passage]) {
    for (const piece of sliceEvery(sentence, MAX_PASSAGE_CHARS)) {
      if (
        current.length + piece.length > MAX_PASSAGE_CHARS &&
        current.length > 0
      ) {
        chunks.push(current.trim());
        current = "";
      }
      current += piece;
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

/**
 * Trims the inflections that would otherwise make a passage about "cats
 * sleeping" look unrelated to a query about how long a cat sleeps. Both sides
 * are trimmed the same way, so the stem only has to be consistent, not correct.
 */
function stem(token: string): string {
  for (const suffix of ["ing", "ies", "ed", "es", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return suffix === "ies"
        ? `${token.slice(0, -suffix.length)}y`
        : token.slice(0, -suffix.length);
    }
  }
  return token;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

function scorePassage(
  passage: string,
  queryTerms: Set<string>,
  index: number,
): number {
  const position = 1 / (1 + index);
  if (queryTerms.size === 0) return position;

  const words = new Set(tokenize(passage));
  let matched = 0;
  for (const term of queryTerms) {
    if (words.has(term)) matched++;
  }

  // Lead passages carry the definition or summary on most pages, so they get a
  // prior worth half a matched term: enough to break ties and to float the
  // intro of a page whose body never repeats the query, never enough to
  // outrank a passage that covers more of it.
  return (matched + 0.5 * position) / queryTerms.size;
}

/**
 * Picks the passages that best cover the query, within a character budget,
 * and restores their original order so the excerpt still reads as prose.
 *
 * @param query - The user's search query
 * @param passages - Candidate passages from a single page
 * @param maxChars - Character budget for the page's excerpt
 * @returns The selected passages, in document order
 */
export function selectPassages(
  query: string,
  passages: string[],
  maxChars: number,
): string[] {
  const queryTerms = new Set(tokenize(query));
  const ranked = passages
    .map((text, index) => ({
      index,
      text,
      score: scorePassage(text, queryTerms, index),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof ranked = [];
  let usedChars = 0;

  for (const passage of ranked) {
    // Skipping rather than stopping lets a shorter passage further down the
    // ranking still fill what is left of the budget.
    if (usedChars + passage.text.length > maxChars) continue;
    selected.push(passage);
    usedChars += passage.text.length + 1;
  }

  return selected.sort((a, b) => a.index - b.index).map(({ text }) => text);
}

async function fetchPageContent(
  query: string,
  url: string,
): Promise<PageContent | null> {
  try {
    const html = await downloadDocument(url);
    if (html === null) return null;

    const passages = splitIntoPassages(extractReadableText(html));
    const content = selectPassages(query, passages, MAX_PAGE_CHARS).join("\n");

    if (content.length < MIN_USEFUL_CHARS) {
      printMessage(`Skipped ${url}: too little readable text`);
      return null;
    }

    return { url, content };
  } catch (error) {
    printMessage(
      `Could not read ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Reads the given pages and returns the passages most relevant to the query.
 * Pages that fail, time out, or carry no readable text are left out instead of
 * failing the batch: a partial set of excerpts still grounds the answer.
 *
 * @param query - The user's search query, used to rank passages
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

  const readable = contents.filter(
    (content): content is PageContent => content !== null,
  );

  printMessage(
    `Read ${readable.length} of ${urls.length} page(s) for: ${query}`,
  );

  return readable;
}
