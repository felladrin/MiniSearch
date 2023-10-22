import { pipeline } from "@xenova/transformers";

const textGenerationConfig = {
  min_length: 32,
  max_new_tokens: 256,
  no_repeat_ngram_size: 2,
  num_beams: 2,
};

export async function preloadModels(params: {
  handleModelLoadingProgress: (event: {
    file: string;
    progress: number;
  }) => void;
  textToTextGenerationModel: string;
}) {
  const answererPromise = pipeline(
    "question-answering",
    "Xenova/distilbert-base-cased-distilled-squad",
    { progress_callback: params.handleModelLoadingProgress },
  ).then((answerer) => answerer.dispose());

  const generatorPromise = pipeline(
    "text2text-generation",
    params.textToTextGenerationModel,
    { progress_callback: params.handleModelLoadingProgress },
  ).then((generator) => generator.dispose());

  await Promise.allSettled([answererPromise, generatorPromise]);
}

export async function runQuestionAnsweringPipeline(params: {
  question: string;
  context: string;
}) {
  const answerer = await pipeline(
    "question-answering",
    "Xenova/distilbert-base-cased-distilled-squad",
  );

  const { answer } = await answerer(
    params.question,
    params.context,
    textGenerationConfig,
  );

  answerer.dispose();

  return answer as string;
}

export async function runTextToTextGenerationPipeline(params: {
  textToTextGenerationModel: string;
  input: string;
}) {
  const generator = await pipeline(
    "text2text-generation",
    params.textToTextGenerationModel,
  );

  const [response] = await generator(params.input, textGenerationConfig);

  generator.dispose();

  return response as string;
}
