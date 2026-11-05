import gptTokenizer from "gpt-tokenizer";

/**
 * Trims page excerpts to fit a shared token budget.
 *
 * Pages are served shortest-first, each taking at most an equal share of what
 * is left, so a single long article cannot crowd out the others and whatever
 * short pages leave unused rolls over to the ones that need it.
 *
 * This is a leaf module that imports nothing but the tokenizer: the worker and
 * the synchronous fallback both run this same function, and neither drags
 * the PubSub state - which reads `localStorage` at import time, absent in a
 * worker - into the other's context.
 */
export function allocatePageExcerpts(
  contents: string[],
  tokenBudget: number,
): string[] {
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
          : `${gptTokenizer.decode(tokens.slice(0, taken)).trimEnd()}…`;
    }

    remainingBudget -= taken;
    remainingPages--;
  }

  return excerpts;
}
