import { pipeline, env } from "@xenova/transformers";
import ortWasmUrl from "@xenova/transformers/dist/ort-wasm.wasm?url";
import ortWasmThreadedUrl from "@xenova/transformers/dist/ort-wasm-threaded.wasm?url";
import ortWasmSimdUrl from "@xenova/transformers/dist/ort-wasm-simd.wasm?url";
import ortWasmSimdThreadedUrl from "@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url";

const cacheName = "transformers-cache";
env.useBrowserCache = false;
// @ts-expect-error wrong useCustomCache type.
env.useCustomCache = true;
// @ts-expect-error wrong customCache type.
env.customCache = {
  match: async (request: Request | string) => {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    if (!cachedResponse) return;
    const cachedResponseBody = await cachedResponse.arrayBuffer();
    return new Response(cachedResponseBody, {
      headers: cachedResponse.headers,
    });
  },
  put: async (request: Request | string, response: Response) => {
    const cache = await caches.open(cacheName);
    await cache.put(
      request,
      new Response(response.body, {
        headers: response.headers,
      }),
    );
  },
};
env.backends.onnx.wasm.wasmPaths = {
  "ort-wasm.wasm": ortWasmUrl,
  "ort-wasm-threaded.wasm": ortWasmThreadedUrl,
  "ort-wasm-simd.wasm": ortWasmSimdUrl,
  "ort-wasm-simd-threaded.wasm": ortWasmSimdThreadedUrl,
};

export async function runTextToTextGenerationPipeline(params: {
  handleModelLoadingProgress?: (event: {
    file: string;
    progress: number;
  }) => void;
  textToTextGenerationModel: string;
  quantized: boolean;
  input: string;
}) {
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
