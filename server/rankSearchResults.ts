import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLlama } from "node-llama-cpp";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository";

const loadModelPromise = loadModel();

export async function rankSearchResults(
  query: string,
  searchResults: [title: string, content: string, url: string][],
) {
  const model = await loadModelPromise;

  const embeddingContext = await model.createEmbeddingContext({
    threads: Math.max(1, os.cpus().length - 2),
  });

  const queryEmbedding = (
    await embeddingContext.getEmbeddingFor(query.toLocaleLowerCase())
  ).vector;

  const documentsEmbeddings: (readonly number[])[] = [];

  const documents = searchResults.map(([title, snippet, url]) =>
    `[${title}](${url} "${snippet.replaceAll('"', "'")}")`.toLocaleLowerCase(),
  );

  for (const document of documents) {
    const embedding = await embeddingContext.getEmbeddingFor(document);
    documentsEmbeddings.push(embedding.vector);
  }

  const scores = documentsEmbeddings.map((documentEmbedding) =>
    calculateDotProduct(queryEmbedding, documentEmbedding),
  );

  const highestScore = Math.max(...scores);

  const scoreThreshold = highestScore / 2;

  const [firstResult, ...nextResults] = searchResults
    .map((result, index) => ({ result, score: scores[index] }))
    .filter(({ score }) => score > scoreThreshold);

  const nextTopResultsCount = 5;

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

function calculateDotProduct(
  firstArray: readonly number[],
  secondArray: readonly number[],
) {
  let result = 0;

  for (let index = 0; index < firstArray.length; index++) {
    result += firstArray[index] * secondArray[index];
  }

  return result;
}

async function loadModel() {
  const hfRepo = "Felladrin/gguf-Q8_0-all-MiniLM-L6-v2";

  const hfRepoFile = "all-minilm-l6-v2-q8_0.gguf";

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
