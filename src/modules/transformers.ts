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

export async function runTextToTextGenerationPipeline<
  T extends string | string[],
>(params: {
  handleModelLoadingProgress?: (event: {
    file: string;
    progress: number;
  }) => void;
  textToTextGenerationModel: string;
  quantized: boolean;
  input: T;
}): Promise<T> {
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

  const responses = await generator(params.input, {
    min_length: 32,
    max_new_tokens: 512,
    do_sample: true,
    no_repeat_ngram_size: 2,
    num_beams: 3,
  });

  await generator.dispose();

  if (Array.isArray(params.input)) {
    return responses.map(
      ({ generated_text }: { generated_text: string }) => generated_text,
    );
  }

  const [response] = responses;
  return response.generated_text;
}
