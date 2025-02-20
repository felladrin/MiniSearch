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

  const highestScore = Math.max(...scoredResults.map((r) => r.score));

  const filteredResults = scoredResults.filter(
    (r) => r.score >= highestScore / 10,
  );

  if (preserveTopResults) {
    const [firstResult, ...nextResults] = filteredResults;

    const nextTopResultsCount = 9;

    const nextTopResults = nextResults
      .slice(0, nextTopResultsCount)
      .sort((a, b) => b.score - a.score);

    const remainingResults = nextResults
      .slice(nextTopResultsCount)
      .sort((a, b) => b.score - a.score);

    return [firstResult, ...nextTopResults, ...remainingResults].map(
      ({ result }) => result,
    );
  }

  return filteredResults
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);
}
