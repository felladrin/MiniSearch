/** A line with nothing but whitespace on it. */
const BLANK_LINE_RE = /^[ \t\r]*$/;

/** A code fence delimiter: 3+ backticks or tildes at up to 3 spaces of indent. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** A top-level list item marker: `-`/`*`/`+` bullet or `1.`/`1)` ordered. */
const LIST_MARKER_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** A line that continues the block it follows instead of starting a new one. */
const INDENTED_RE = /^[ \t]/;

/**
 * Splits a markdown string into top-level blocks at blank lines the markdown
 * parser treats as block boundaries, so each block can be rendered and
 * memoized independently.
 *
 * The rules, in the order they are applied to a blank line whose block is
 * still open:
 *
 * - **Fenced code wins.** Inside a ``` / ~~~ fence a blank line is code,
 *   never a boundary. A fence closes only on a line of the same character,
 *   at least as long as the opener, with nothing after it. An unterminated
 *   fence (mid-stream) keeps everything after its opener in one block,
 *   matching how the parser treats it.
 * - **An indented next line continues the block.** Indented content —
 *   list-item bodies, indented code, lazy continuations — belongs to the
 *   block it follows, so a blank line before an indented line does not
 *   split.
 * - **List items separated by blank lines stay one block.** `- a\n\n- b`
 *   is a single loose list; splitting it would render two lists.
 * - **Everything else splits.** A heading, paragraph, table or thematic
 *   break after a blank line is a new top-level block. A `>` line after a
 *   blank line starts a *new* blockquote in CommonMark, so blockquotes
 *   separated by a blank line do split.
 *
 * Merging is always render-safe — the same string reaches the same parser
 * either way — while a wrong split changes the DOM. So when in doubt the
 * rules keep lines together; the cost is a coarser memo, never a
 * different render.
 *
 * Leading and trailing blank lines are dropped; whitespace-only input
 * yields no blocks.
 */
export function splitMarkdownBlocks(content: string): string[] {
  const lines = content.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let blockHasList = false;
  let openFence: { char: string; length: number } | null = null;

  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
      blockHasList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (openFence) {
      current.push(line);
      const fenceMatch = FENCE_RE.exec(line);
      if (
        fenceMatch &&
        fenceMatch[1][0] === openFence.char &&
        fenceMatch[1].length >= openFence.length &&
        line.slice(fenceMatch[0].length).trim() === ""
      ) {
        openFence = null;
      }
      continue;
    }

    if (BLANK_LINE_RE.test(line)) {
      // Leading blank lines are dropped, not kept inside a block.
      if (current.length === 0) continue;

      // Look past the run of blank lines to the next content line.
      let next = i + 1;
      while (next < lines.length && BLANK_LINE_RE.test(lines[next])) next++;
      if (next >= lines.length) break; // trailing blank lines are dropped

      const nextLine = lines[next];
      const continuesBlock =
        INDENTED_RE.test(nextLine) ||
        (blockHasList && LIST_MARKER_RE.test(nextLine));

      if (continuesBlock) {
        // The blank lines belong inside the block (loose list, indented
        // continuation); keep them so the parser sees the same input.
        for (let k = i; k < next; k++) current.push(lines[k]);
      } else {
        flush();
      }
      i = next - 1;
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      openFence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      current.push(line);
      continue;
    }

    if (LIST_MARKER_RE.test(line)) blockHasList = true;
    current.push(line);
  }

  flush();
  return blocks;
}
