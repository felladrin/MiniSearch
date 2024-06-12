import { fileURLToPath } from "url";
import path from "node:path";
import { getLlama } from "node-llama-cpp";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository";

const loadModelPromise = loadModel();

export async function rankSearchResults(
  query: string,
  searchResults: [title: string, content: string, url: string][],
) {
  const model = await loadModelPromise;

  const embeddingContext = await model.createEmbeddingContext();

  const queryEmbedding = (
    await embeddingContext.getEmbeddingFor(query.toLocaleLowerCase())
  ).vector;

  const documentsEmbeddings: number[][] = [];

  const documents = searchResults.map(([title, snippet, url]) =>
    `${title}\n${url}\n${snippet}`.toLocaleLowerCase(),
  );

  for (const document of documents) {
    const embedding = await embeddingContext.getEmbeddingFor(document);
    documentsEmbeddings.push(embedding.vector);
  }

  const scores = documentsEmbeddings.map((documentEmbedding) =>
    calculateDotProduct(queryEmbedding, documentEmbedding),
  );

  const highestScore = Math.max(...scores);

  const scoreThreshold = highestScore / 3;

  const searchResultToScoreMap: Map<(typeof searchResults)[0], number> =
    new Map();

  scores.forEach((score, index) => {
    if (score > scoreThreshold) {
      searchResultToScoreMap.set(searchResults[index], score);
    }
  });

  return Array.from(searchResultToScoreMap.keys()).sort((a, b) => {
    return searchResultToScoreMap.get(b) - searchResultToScoreMap.get(a);
  });
}

function calculateDotProduct(firstArray: number[], secondArray: number[]) {
  let result = 0;

  for (let index = 0; index < firstArray.length; index++) {
    result += firstArray[index] * secondArray[index];
  }

  return result;
}

async function loadModel() {
  const hfRepo = "Felladrin/gguf-multi-qa-MiniLM-L6-cos-v1";

  const hfRepoFile = "multi-qa-MiniLM-L6-cos-v1.Q8_0.gguf";

  const localFilePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "models",
    hfRepo,
    hfRepoFile,
  );

  const llama = await getLlama();

  await downloadFileFromHuggingFaceRepository(
    hfRepo,
    hfRepoFile,
    localFilePath,
  );

  return llama.loadModel({ modelPath: localFilePath });
}
