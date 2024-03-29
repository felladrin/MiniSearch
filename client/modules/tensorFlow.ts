import "@tensorflow/tfjs";
import { load } from "@tensorflow-models/universal-sentence-encoder";

export async function rank(query: string, documents: string[]) {
  const model = await load({
    modelUrl: "/tensorflow-models/universal-sentence-encoder/model.json",
    vocabUrl: "/tensorflow-models/universal-sentence-encoder/vocab.json",
  });

  const calculateDotProduct = (firstArray: number[], secondArray: number[]) => {
    let result = 0;

    for (let index = 0; index < firstArray.length; index++) {
      result += firstArray[index] * secondArray[index];
    }

    return result;
  };

  const queryEmbedding = await model.embed(query);

  const searchResultsEmbeddings = await model.embed(documents);

  const queryEmbeddingArray = queryEmbedding.arraySync()[0];

  const searchResultsEmbeddingsArray = searchResultsEmbeddings.arraySync();

  return searchResultsEmbeddingsArray.map((documentEmbedding) =>
    calculateDotProduct(queryEmbeddingArray, documentEmbedding),
  );
}
