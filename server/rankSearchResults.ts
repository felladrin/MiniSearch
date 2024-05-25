import {
  initModel,
  distance as calculateSimilarity,
  EmbeddingsModel,
} from "@energetic-ai/embeddings";
import { modelSource as embeddingModel } from "@energetic-ai/model-embeddings-en";

let embeddingModelInstance: EmbeddingsModel | undefined;

async function getSimilarityScores(query: string, documents: string[]) {
  if (!embeddingModelInstance) {
    embeddingModelInstance = await initModel(embeddingModel);
  }

  const [queryEmbedding] = await embeddingModelInstance.embed([query]);

  const documentsEmbeddings = await embeddingModelInstance.embed(documents);

  return documentsEmbeddings.map((documentEmbedding) =>
    calculateSimilarity(queryEmbedding, documentEmbedding),
  );
}

export async function rankSearchResults(
  query: string,
  searchResults: [title: string, content: string, url: string][],
) {
  const searchResultToScoreMap: Map<(typeof searchResults)[0], number> =
    new Map();

  (
    await getSimilarityScores(
      query.toLocaleLowerCase(),
      searchResults.map(([title, snippet, url]) =>
        `${title}\n${url}\n${snippet}`.toLocaleLowerCase(),
      ),
    )
  ).forEach((score, index) => {
    searchResultToScoreMap.set(searchResults[index], score);
  });

  return searchResults
    .slice()
    .sort(
      (a, b) => searchResultToScoreMap.get(b) - searchResultToScoreMap.get(a),
    );
}
