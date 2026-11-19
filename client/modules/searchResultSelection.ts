import type { TextSearchResults } from "./types";

/**
 * Picks the results the answer is grounded on, out of the results the user is
 * shown.
 *
 * The list and the evidence set are not the same thing: the server pins the
 * engine's first result to the top so the user sees it first, but a pinned
 * result is not always a relevant one, and taking the first N blindly spends
 * one of N evidence slots on it. When the reranker scored the batch, the
 * highest scores are the better evidence, wherever the pin placed them.
 *
 * Without scores the engine order is all there is, so it is preserved.
 */
export function selectLlmSearchResults(
  results: TextSearchResults,
  limit: number,
): TextSearchResults {
  if (!results.some(([, , , score]) => typeof score === "number")) {
    return results.slice(0, limit);
  }

  return [...results]
    .sort((left, right) => (right[3] ?? 0) - (left[3] ?? 0))
    .slice(0, limit);
}
