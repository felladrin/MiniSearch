import { rerank } from "./rerankerService";

export async function rankSearchResults(
  query: string,
  searchResults: [title: string, content: string, url: string][],
  preserveTopResults = false,
) {
  const documents = searchResults.map(([title, snippet, url]) =>
    `[${title}](${url} "${snippet.replaceAll('"', "'")}")`.toLocaleLowerCase(),
  );

  const results = await rerank(query.toLocaleLowerCase(), documents);

  const scoredResults = results.map(({ index, relevance_score }) => ({
    result: searchResults[index],
    score: relevance_score,
  }));

  if (scoredResults.length === 0) {
    return [];
  }

  if (!preserveTopResults) {
    return filterResultsByScore(scoredResults)
      .sort((a, b) => b.score - a.score)
      .map(({ result }) => result);
  }

  const [firstResult, ...nextResults] = scoredResults;

  const filteredNextResults = filterResultsByScore(nextResults);

  const nextTopResultsCount = 9;

  const nextTopResults = filteredNextResults
    .slice(0, nextTopResultsCount)
    .sort((a, b) => b.score - a.score);

  const remainingResults = filteredNextResults
    .slice(nextTopResultsCount)
    .sort((a, b) => b.score - a.score);

  return [firstResult, ...nextTopResults, ...remainingResults].map(
    ({ result }) => result,
  );
}

type SearchResultTuple = [title: string, content: string, url: string];
type ScoredResultItem = { result: SearchResultTuple; score: number };
type ScoredResultItemWithNormalizedScore = ScoredResultItem & {
  normalizedScore: number;
};

function filterResultsByScore(
  inputResults: ScoredResultItem[],
  kStandardDeviationFactor = 0.3,
  minPercentageFallback = 0.4,
): ScoredResultItemWithNormalizedScore[] {
  if (inputResults.length === 0) return [];

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
  }

  return filteredItems;
}
