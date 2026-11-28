import type { TextSearchResults } from "./types";

interface AnswerExportParts {
  /** The answer's Markdown, as it was written. */
  answer: string;
  /** The results the answer was grounded on, in the order they were read. */
  sources: TextSearchResults;
  /** What was typed in the search field. */
  query: string;
  /** When the file is exported. */
  exportedAt: Date;
}

const maxFileNameBaseLength = 60;
const windowsReservedFileNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Marks are allowed so scripts that write vowels as combining marks (Devanagari,
// Thai) keep whole words instead of getting a dash inside each one.
const unsupportedFileNameCharacters = /[^\p{L}\p{M}\p{N} ._-]/gu;

/**
 * Renders an answer as a standalone Markdown document: the answer, then the
 * results it was grounded on, then one line saying what was searched and when.
 *
 * An answer cites its sources with inline Markdown links, so the source list
 * only lists what was read: no `[1]` marker is added to the answer, and the
 * answer's own text and links are never rewritten. Nothing but the query, the
 * answer, the source titles and URLs and the date goes into the file.
 */
export function buildAnswerMarkdown({
  answer,
  sources,
  query,
  exportedAt,
}: AnswerExportParts): string {
  const sections: string[] = [];
  const body = answer.trim();
  if (body) {
    sections.push(body);
  }

  const items: string[] = [];
  for (const [title, , url] of sources) {
    const link = buildMarkdownLink(title, url);
    if (link) {
      items.push(`${items.length + 1}. ${link}`);
    }
  }
  if (items.length) {
    sections.push(`## Sources\n\n${items.join("\n")}`);
  }

  // The export date, not the search date: an answer restored from history is
  // exported long after its search ran.
  const searchedFor = escapeInlineMarkdown(singleLine(query));
  sections.push(
    `Searched${searchedFor ? ` for "${searchedFor}"` : ""} with MiniSearch, exported on ${formatDate(exportedAt)}`,
  );

  return `${sections.join("\n\n")}\n`;
}

/** A file name that survives every file system, bounded in length, ending in `.md`. */
export function buildAnswerFileName(query: string): string {
  const cleaned = singleLine(query.normalize("NFC"))
    .replace(unsupportedFileNameCharacters, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  // Counted in code points, so the cut never splits a surrogate pair.
  const base = Array.from(cleaned)
    .slice(0, maxFileNameBaseLength)
    .join("")
    .replace(/[-. ]+$/g, "");
  // Windows reserves a device name whatever follows its first dot, so
  // `con.txt.md` fails as surely as `con.md`.
  const stem = windowsReservedFileNames.test(base.split(".")[0] ?? "")
    ? `_${base}`
    : base;

  return `${stem || "answer"}.md`;
}

/** Saves text as a file through an object URL, which is released afterwards. */
export function downloadAnswerMarkdown(
  markdown: string,
  fileName: string,
): void {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Released a moment later rather than at once: some browsers, Safari among
  // them, have failed downloads whose URL was revoked right after the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildMarkdownLink(title: string, url: string): string {
  const destination = url.trim();
  // Only web links: a source URL comes from a third-party page.
  if (!/^https?:\/\//i.test(destination)) {
    return "";
  }

  const text =
    escapeInlineMarkdown(singleLine(title)) ||
    escapeInlineMarkdown(destination);
  // Percent-encoded rather than wrapped in `<…>`, so the URL keeps every
  // character and nothing in it can end the link early.
  const encodedDestination = destination.replace(
    /[\s()<>\\`]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );

  return `[${text}](${encodedDestination})`;
}

/**
 * Escapes what Markdown reads inside a line: emphasis, code spans, links,
 * images, raw HTML, entities, strikethrough and table pipes. A source title
 * comes from a third-party page, so a `<img onerror>` in it must stay text.
 */
function escapeInlineMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>!&~|]/g, "\\$&");
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}
