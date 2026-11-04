import gptTokenizer from "gpt-tokenizer";

/**
 * Shortest query term worth searching a page for, counting characters for a
 * CJK term and letters for a Latin one. Two-letter Latin words ("on", "in",
 * "of") occur on nearly every line, so they would drag the window to whatever
 * happens to come first; two-character CJK runs are already meaningful.
 */
const minLatinTermLength = 3;
const minCjkTermLength = 2;

/**
 * Share of the window spent on context before the first match, so a cut does
 * not start mid-sentence.
 */
const leadingContextRatio = 0.15;

/** How far a cut may slide to land on a word boundary. */
const boundaryTolerance = 40;

/**
 * Weight of a CJK bigram relative to the term it came from. Chinese queries
 * arrive without spaces, so treating them as one long term would only match
 * pages that repeat it verbatim; bigrams let partial matches rank.
 */
const cjkBigramWeight = 0.5;

const boundaryPattern = /[\s\u3000-\u303f\uff00-\uffef.,!?;:()[\]{}"'«»]/u;

interface WeightedTerm {
  term: string;
  weight: number;
}

interface Occurrence {
  index: number;
  weight: number;
}

export interface ExcerptAllocationOptions {
  /**
   * The query the search ran. When present, a page that has to be trimmed
   * keeps the window where the query's words actually occur, instead of its
   * opening lines, which are usually navigation and infoboxes.
   */
  query?: string;
}

function isAllCjk(text: string) {
  return /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+$/u.test(text);
}

/** Splits a query into searchable terms, adding CJK bigrams as fallbacks. */
function toWeightedTerms(query: string): WeightedTerm[] {
  const weights = new Map<string, number>();

  for (const part of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const cjk = isAllCjk(part);
    if (part.length < (cjk ? minCjkTermLength : minLatinTermLength)) continue;
    weights.set(part, 1);
    if (cjk && part.length > minCjkTermLength) {
      for (let index = 0; index + 2 <= part.length; index++) {
        const bigram = part.slice(index, index + 2);
        if (!weights.has(bigram)) weights.set(bigram, cjkBigramWeight);
      }
    }
  }

  return [...weights].map(([term, weight]) => ({ term, weight }));
}

/**
 * Finds every place the terms occur, damping each term by how often the page
 * repeats it: a word on every line ("the", "disney" on the brand's own site)
 * locates little, while a rare one locates the answer. Without the damping the
 * window gravitates to the most repetitive part of the page.
 */
function findOccurrences(
  lowerContent: string,
  terms: WeightedTerm[],
): Occurrence[] {
  const occurrences: Occurrence[] = [];

  for (const { term, weight } of terms) {
    const found: number[] = [];
    let index = lowerContent.indexOf(term);
    while (index !== -1) {
      found.push(index);
      index = lowerContent.indexOf(term, index + term.length);
    }

    const dampedWeight = weight / Math.sqrt(found.length || 1);
    for (const position of found) {
      occurrences.push({ index: position, weight: dampedWeight });
    }
  }

  return occurrences.sort((a, b) => a.index - b.index);
}

/**
 * Start of the window that covers the most query weight. The first window wins
 * ties, and a page without any occurrence keeps its opening.
 */
function findBestWindowStart(
  occurrences: Occurrence[],
  windowCharacters: number,
) {
  let bestStart = occurrences[0].index;
  let bestWeight = 0;
  let weightInWindow = 0;
  let right = 0;

  for (let left = 0; left < occurrences.length; left++) {
    const start = occurrences[left].index;

    while (
      right < occurrences.length &&
      occurrences[right].index < start + windowCharacters
    ) {
      weightInWindow += occurrences[right].weight;
      right++;
    }

    if (weightInWindow > bestWeight) {
      bestWeight = weightInWindow;
      bestStart = start;
    }

    weightInWindow -= occurrences[left].weight;
  }

  return bestStart;
}

function snapToStartOfWord(content: string, start: number) {
  let index = start;

  for (let step = 0; step < boundaryTolerance && index > 0; step++) {
    if (boundaryPattern.test(content[index - 1])) return index;
    index--;
  }

  return start;
}

function snapToEndOfWord(content: string, end: number) {
  let index = end;

  for (
    let step = 0;
    step < boundaryTolerance && index < content.length;
    step++
  ) {
    if (boundaryPattern.test(content[index])) return index;
    index++;
  }

  return end;
}

/** Keeps the window of a page that covers the query, trimmed to `taken` tokens. */
function trimToQueryWindow(
  content: string,
  tokens: number[],
  taken: number,
  terms: WeightedTerm[],
) {
  const windowCharacters = Math.max(
    1,
    Math.floor((taken * content.length) / tokens.length),
  );
  const occurrences =
    terms.length > 0 ? findOccurrences(content.toLowerCase(), terms) : [];

  const start =
    occurrences.length === 0
      ? 0
      : Math.max(
          0,
          findBestWindowStart(occurrences, windowCharacters) -
            Math.floor(windowCharacters * leadingContextRatio),
        );

  const from = snapToStartOfWord(content, start);
  const to = snapToEndOfWord(
    content,
    Math.max(Math.min(content.length, start + windowCharacters), from + 1),
  );

  const window = content.slice(from, to);
  const windowTokens = gptTokenizer.encode(window);
  const trimmed =
    windowTokens.length > taken
      ? gptTokenizer.decode(windowTokens.slice(0, taken))
      : window;

  return `${from > 0 ? "…" : ""}${trimmed.trimEnd()}${
    to < content.length ? "…" : ""
  }`;
}

/**
 * Trims page excerpts to fit a shared token budget.
 *
 * Pages are served shortest-first, each taking at most an equal share of what
 * is left, so a single long article cannot crowd out the others and whatever
 * short pages leave unused rolls over to the ones that need it.
 *
 * When the query is known, a page that has to be trimmed keeps the part of
 * itself that answers the query instead of its opening lines. Search results
 * arrive with the page's navigation in front, and handing the model that
 * prefix made questions like "what's new on Disney+ next month" answer that the
 * excerpt does not say, even though the page listed the titles further down.
 *
 * This is a leaf module that imports nothing but the tokenizer: the worker and
 * the synchronous fallback both run this same function, and neither drags
 * the PubSub state - which reads `localStorage` at import time, absent in a
 * worker - into the other's context.
 */
export function allocatePageExcerpts(
  contents: string[],
  tokenBudget: number,
  options: ExcerptAllocationOptions = {},
): string[] {
  const terms = options.query ? toWeightedTerms(options.query) : [];
  const excerpts = contents.map(() => "");
  const pending = contents
    .map((content, index) => ({
      index,
      tokens: content.length > 0 ? gptTokenizer.encode(content) : [],
    }))
    .filter(({ tokens }) => tokens.length > 0)
    .sort((a, b) => a.tokens.length - b.tokens.length);

  let remainingBudget = Math.max(0, tokenBudget);
  let remainingPages = pending.length;

  for (const { index, tokens } of pending) {
    const taken = Math.min(
      tokens.length,
      Math.floor(remainingBudget / remainingPages),
    );

    if (taken > 0) {
      excerpts[index] =
        taken === tokens.length
          ? contents[index]
          : trimToQueryWindow(contents[index], tokens, taken, terms);
    }

    remainingBudget -= taken;
    remainingPages--;
  }

  return excerpts;
}
