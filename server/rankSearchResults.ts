import { rerank } from "./rerankerService.ts";
import { recordRerank } from "./rerankingSinceLastRestart.ts";

export async function rankSearchResults(
  query: string,
  searchResults: [title: string, content: string, url: string][],
  preserveTopResults = false,
): Promise<ScoredSearchResultTuple[]> {
  const documents = searchResults.map(
    ([title, snippet]) => `${title}\n${snippet}`,
  );

  const startedAt = performance.now();
  let usedPercentageFallback = false;
  const filterResults = (items: ScoredResultItem[]) => {
    const filtered = filterResultsByScore(items);
    if (filtered.fellBackToPercentage) usedPercentageFallback = true;
    return filtered.items;
  };
  // A search with no results still reaches here, and reranking nothing is not
  // a rerank: counting it would drag the average toward zero on exactly the
  // instances where searches are coming back empty.
  const report = (considered: number, kept: number) => {
    if (considered === 0) return;
    recordRerank({
      considered,
      kept,
      durationMs: performance.now() - startedAt,
      usedPercentageFallback,
    });
  };

  const results = await rerank(query, documents);

  const scoredResults = results.map(({ index, relevance_score }) => ({
    result: searchResults[index],
    score: relevance_score,
  }));

  if (scoredResults.length === 0) {
    return [];
  }

  if (!preserveTopResults) {
    const ranked = filterResults(scoredResults)
      .sort((a, b) => b.score - a.score)
      .map(({ result, score }): ScoredSearchResultTuple => [...result, score]);
    report(scoredResults.length, ranked.length);
    return ranked;
  }

  const [firstResult, ...nextResults] = scoredResults;

  const filteredNextResults = filterResults(nextResults);

  const nextTopResultsCount = 9;

  const nextTopResults = filteredNextResults
    .slice(0, nextTopResultsCount)
    .sort((a, b) => b.score - a.score);

  const remainingResults = filteredNextResults
    .slice(nextTopResultsCount)
    .sort((a, b) => b.score - a.score);

  const ranked = [firstResult, ...nextTopResults, ...remainingResults].map(
    ({ result, score }): ScoredSearchResultTuple => [...result, score],
  );
  report(scoredResults.length, ranked.length);
  return ranked;
}

type SearchResultTuple = [title: string, content: string, url: string];
type ScoredSearchResultTuple = [...SearchResultTuple, score: number];
type ScoredResultItem = { result: SearchResultTuple; score: number };
type ScoredResultItemWithNormalizedScore = ScoredResultItem & {
  normalizedScore: number;
};

/**
 * Returns the surviving results and whether the percentage fallback had to
 * rescue them, which is the signal that `kStandardDeviationFactor` emptied a
 * batch it should not have.
 */
function filterResultsByScore(
  inputResults: ScoredResultItem[],
  kStandardDeviationFactor = 0.3,
  minPercentageFallback = 0.4,
): {
  items: ScoredResultItemWithNormalizedScore[];
  fellBackToPercentage: boolean;
} {
  if (inputResults.length === 0)
    return { items: [], fellBackToPercentage: false };

  const originalScores = inputResults.map(({ score }) => score);
  const minScore = Math.min(...originalScores);

  const itemsWithNormalizedScore = inputResults.map((item) => ({
    ...item,
    normalizedScore: item.score + Math.abs(minScore),
  }));

  const normalizedScores = itemsWithNormalizedScore.map(
    ({ normalizedScore }) => normalizedScore,
  );

  const mean =
    normalizedScores.reduce((sum, score) => sum + score, 0) /
    normalizedScores.length;
  const variance =
    normalizedScores.reduce((sum, score) => sum + (score - mean) ** 2, 0) /
    normalizedScores.length;
  const standardDeviation = Math.sqrt(variance);

  const threshold = Math.max(
    0,
    mean - kStandardDeviationFactor * standardDeviation,
  );

  let filteredItems = itemsWithNormalizedScore.filter(
    ({ normalizedScore }) => normalizedScore >= threshold,
  );

  let fellBackToPercentage = false;

  if (
    filteredItems.length <
      Math.ceil(itemsWithNormalizedScore.length * minPercentageFallback) &&
    itemsWithNormalizedScore.length > 0
  ) {
    const highestNormalizedScore = Math.max(...normalizedScores);
    filteredItems = itemsWithNormalizedScore.filter(
      ({ normalizedScore }) =>
        normalizedScore >= highestNormalizedScore * minPercentageFallback,
    );
    fellBackToPercentage = true;
  }

  return { items: filteredItems, fellBackToPercentage };
}
