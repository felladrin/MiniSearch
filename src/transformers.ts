import { pipeline } from "@xenova/transformers";

const textGenerationConfig = {
  min_length: 32,
  max_new_tokens: 256,
  no_repeat_ngram_size: 2,
  num_beams: 3,
};

export async function preloadModels(params: {
  handleModelLoadingProgress: (event: {
    file: string;
    progress: number;
  }) => void;
  textToTextGenerationModel: string;
}) {
  const generator = await pipeline(
    "text2text-generation",
    params.textToTextGenerationModel,
    { progress_callback: params.handleModelLoadingProgress },
  );

  await generator.dispose();
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

  await generator.dispose();

  return response as string;
}
