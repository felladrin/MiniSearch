import { pipeline, env } from "@xenova/transformers";
import ortWasmUrl from "@xenova/transformers/dist/ort-wasm.wasm?url";
import ortWasmThreadedUrl from "@xenova/transformers/dist/ort-wasm-threaded.wasm?url";
import ortWasmSimdUrl from "@xenova/transformers/dist/ort-wasm-simd.wasm?url";
import ortWasmSimdThreadedUrl from "@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url";

env.backends.onnx.wasm.wasmPaths = {
  "ort-wasm.wasm": ortWasmUrl,
  "ort-wasm-threaded.wasm": ortWasmThreadedUrl,
  "ort-wasm-simd.wasm": ortWasmSimdUrl,
  "ort-wasm-simd-threaded.wasm": ortWasmSimdThreadedUrl,
};

export async function preloadModels(params: {
  handleModelLoadingProgress?: (event: {
    file: string;
    progress: number;
  }) => void;
  textToTextGenerationModel: string;
  quantized: boolean;
}) {
  try {
    const generator = await pipeline(
      "text2text-generation",
      params.textToTextGenerationModel,
      {
        quantized: params.quantized,
        progress_callback:
          params.handleModelLoadingProgress ??
          ((event: { file: string; progress: number }) => {
            self.postMessage({
              type: "model-loading-progress",
              payload: event,
            });
          }),
      },
    );

    await generator.dispose();

    return true;
  } catch (error) {
    return false;
  }
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
