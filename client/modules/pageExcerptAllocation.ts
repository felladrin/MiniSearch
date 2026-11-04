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

const cjkRunExpression = /([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+)/u;
const wordCharacterExpression = /[\p{L}\p{N}]/u;

/** Splits a query into searchable terms, adding CJK bigrams as fallbacks. */
function toWeightedTerms(query: string): WeightedTerm[] {
  const weights = new Map<string, number>();

  const addTerm = (term: string, weight: number) => {
    if ((weights.get(term) ?? 0) < weight) weights.set(term, weight);
  };

  const addCjkRun = (run: string) => {
    if (run.length < minCjkTermLength) return;
    addTerm(run, 1);
    for (let index = 0; index + 2 <= run.length; index++) {
      addTerm(run.slice(index, index + 2), cjkBigramWeight);
    }
  };

  for (const part of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (part.length === 0) continue;
    if (isAllCjk(part)) {
      addCjkRun(part);
      continue;
    }
    // A query can mix scripts without a space ("迪士尼plus片单"). Kept as one
    // token it is neither a CJK run nor a Latin word, so nothing on the page
    // matches it; split it into runs and read each one as its own script.
    for (const run of part.split(cjkRunExpression)) {
      if (run.length === 0) continue;
      if (isAllCjk(run)) addCjkRun(run);
      else if (run.length >= minLatinTermLength) addTerm(run, 1);
    }
  }

  return [...weights].map(([term, weight]) => ({ term, weight }));
}

/** How far a word may continue past the term as an inflection ("cat"/"cats"). */
const maxInflectionChars = 3;

function isWordBoundary(content: string, index: number) {
  if (index < 0 || index >= content.length) return true;
  return !wordCharacterExpression.test(content[index]);
}

/**
 * A Latin term counts only where it starts a word and ends one, or is the stem
 * of a short inflection: a substring hit is how "cat" lands on "catalogue" a
 * thousand times and drags the window there.
 */
function matchesWord(content: string, index: number, length: number) {
  if (!isWordBoundary(content, index - 1)) return false;

  let suffix = 0;
  for (
    let cursor = index + length;
    cursor < content.length && wordCharacterExpression.test(content[cursor]);
    cursor++
  ) {
    suffix++;
    if (suffix > maxInflectionChars) return false;
  }

  return true;
}

/**
 * Finds every place the terms occur, damping each term so that a page's
 * repeated words do not outweigh the one that answers the query. A term counts
 * at most its own weight however often it repeats, or a navigation menu echoing
 * the query wins the window over the paragraph that holds the answer.
 */
function findOccurrences(
  lowerContent: string,
  terms: WeightedTerm[],
): Occurrence[] {
  const occurrences: Occurrence[] = [];

  for (const { term, weight } of terms) {
    const cjkOnly = isAllCjk(term);
    const found: number[] = [];
    let index = lowerContent.indexOf(term);
    while (index !== -1) {
      if (cjkOnly || matchesWord(lowerContent, index, term.length)) {
        found.push(index);
      }
      index = lowerContent.indexOf(term, index + term.length);
    }
    if (found.length === 0) continue;

    const dampedWeight = weight / found.length;
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
/**
 * The occurrence the window was chosen for, and how much of the share is spent
 * in front of it. A window longer than the share is cut around this point
 * rather than from a fixed side: the rare word that locates the answer sits at
 * the end of the densest stretch as often as at its start.
 */
function anchorIndex(occurrences: Occurrence[], from: number, to: number) {
  if (occurrences.length === 0) return from;

  let anchor = occurrences[0].index;
  let weight = 0;
  for (const occurrence of occurrences) {
    if (occurrence.index < from) continue;
    if (occurrence.index >= to) break;
    if (occurrence.weight > weight) {
      weight = occurrence.weight;
      anchor = occurrence.index;
    }
  }
  return anchor;
}

/** Token range that keeps `anchor` inside the share, with context before it. */
function keeperRange(
  window: string,
  from: number,
  anchor: number,
  taken: number,
): [number, number] {
  const anchorTokens = gptTokenizer.encode(
    window.slice(0, Math.max(0, anchor - from)),
  ).length;
  const start = Math.max(
    0,
    Math.min(anchorTokens - Math.floor(taken * 0.2), anchorTokens),
  );
  return [start, start + taken];
}

/**
 * Fits a window plus its ellipses into the page's share of the budget.
 *
 * A window is chosen in characters and cut in tokens, so the two ellipses that
 * mark the cuts can push the result one or two tokens over the share. The share
 * is what keeps a long page from crowding out the others, so the body gives up
 * the tokens the ellipses need.
 */
function fitWindow(
  leading: string,
  body: string,
  trailing: string,
  taken: number,
): string {
  let kept = body;
  while (
    kept.length > 0 &&
    gptTokenizer.encode(`${leading}${kept}${trailing}`).length > taken
  ) {
    const keptTokens = gptTokenizer.encode(kept);
    keptTokens.pop();
    kept = gptTokenizer.decode(keptTokens).trimEnd();
  }
  const marker = `${leading}${kept}${trailing}`;
  if (gptTokenizer.encode(marker).length <= taken) {
    return marker;
  }
  // The cuts alone eat the share: spend it on the marker that still says the
  // excerpt was cut, rather than on a word of body with no marker.
  return taken >= 1 ? "…" : "";
}

function trimToQueryWindow(
  content: string,
  tokens: number[],
  taken: number,
  terms: WeightedTerm[],
) {
  // Without a query there is nothing to centre on, so the opening of the page
  // is kept exactly as it was before windowed trimming existed.
  if (terms.length === 0) {
    return `${gptTokenizer.decode(tokens.slice(0, taken)).trimEnd()}…`;
  }

  const windowCharacters = Math.max(
    1,
    Math.floor((taken * content.length) / tokens.length),
  );
  const occurrences = findOccurrences(content.toLowerCase(), terms);

  // The window keeps its right edge on the densest stretch of matches: the
  // context in front of it is the part that gets dropped when the share is
  // tight, because a match at the end of the stretch is the one the window was
  // chosen for.
  const bestStart =
    occurrences.length === 0
      ? 0
      : findBestWindowStart(occurrences, windowCharacters);
  const start = Math.max(
    0,
    bestStart - Math.floor(windowCharacters * leadingContextRatio),
  );

  const from = snapToStartOfWord(content, start);
  const to = snapToEndOfWord(
    content,
    Math.max(Math.min(content.length, bestStart + windowCharacters), from + 1),
  );
  const anchor = anchorIndex(occurrences, from, to);

  const window = content.slice(from, to);
  const windowTokens = gptTokenizer.encode(window);
  const leading = from > 0 ? "…" : "";
  const trailing = to < content.length ? "…" : "";
  const bodyBudget = Math.max(0, taken - leading.length - trailing.length);
  const trimmed =
    windowTokens.length > bodyBudget
      ? gptTokenizer.decode(
          windowTokens.slice(...keeperRange(window, from, anchor, bodyBudget)),
        )
      : window;

  return fitWindow(leading, trimmed.trimEnd(), trailing, taken);
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
