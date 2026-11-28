import type { TextSearchResults } from "./types";

interface AnswerExportParts {
  /** The answer's Markdown, as it was written. */
  answer: string;
  /** The results the answer was grounded on, in the order they were read. */
  sources: TextSearchResults;
  /** What was typed in the search field. */
  query: string;
  /** When the search ran. */
  date: Date;
}

const maxFileNameBaseLength = 60;
const windowsReservedFileNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const unsupportedFileNameCharacters = /[^\p{L}\p{N} ._-]/gu;

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
  date,
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

  const searchedFor = singleLine(query);
  sections.push(
    `Searched${searchedFor ? ` for "${searchedFor}"` : ""} on ${formatDate(date)} with MiniSearch`,
  );

  return `${sections.join("\n\n")}\n`;
}

/** A file name that survives every file system, bounded in length, ending in `.md`. */
export function buildAnswerFileName(query: string): string {
  const base = singleLine(query)
    .replace(unsupportedFileNameCharacters, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, maxFileNameBaseLength)
    .replace(/[-. ]+$/g, "");
  const stem = windowsReservedFileNames.test(base) ? `_${base}` : base;

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
  URL.revokeObjectURL(url);
}

function buildMarkdownLink(title: string, url: string): string {
  const destination = url.trim();
  if (!destination) {
    return "";
  }

  const text = escapeLinkText(title) || escapeLinkText(destination);
  const wrappedDestination = /[\s()<>]/.test(destination)
    ? `<${destination.replace(/[<>]/g, "")}>`
    : destination;

  return `[${text}](${wrappedDestination})`;
}

function escapeLinkText(text: string): string {
  return singleLine(text)
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}
