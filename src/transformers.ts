import { pipeline } from "@xenova/transformers";

export async function preloadModels(params: {
  handleModelLoadingProgress: (event: {
    file: string;
    progress: number;
  }) => void;
  textToTextGenerationModel: string;
  quantized: boolean;
}) {
  const generator = await pipeline(
    "text2text-generation",
    params.textToTextGenerationModel,
    {
      quantized: params.quantized,
      progress_callback: params.handleModelLoadingProgress,
    },
  );

  await generator.dispose();
}

export async function runTextToTextGenerationPipeline(params: {
  textToTextGenerationModel: string;
  input: string;
  quantized: boolean;
}) {
  const generator = await pipeline(
    "text2text-generation",
    params.textToTextGenerationModel,
    { quantized: params.quantized },
  );

  const [response] = await generator(params.input, {
    min_length: 32,
    max_new_tokens: 512,
    do_sample: true,
    no_repeat_ngram_size: 2,
    num_beams: 3,
  });

  await generator.dispose();

  return response as string;
}
