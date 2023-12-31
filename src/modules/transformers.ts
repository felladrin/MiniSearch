import { pipeline, env, AutoTokenizer } from "@xenova/transformers";
import ortWasmUrl from "@xenova/transformers/dist/ort-wasm.wasm?url";
import ortWasmThreadedUrl from "@xenova/transformers/dist/ort-wasm-threaded.wasm?url";
import ortWasmSimdUrl from "@xenova/transformers/dist/ort-wasm-simd.wasm?url";
import ortWasmSimdThreadedUrl from "@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url";

env.allowLocalModels = false;
(
  env.backends.onnx as {
    wasm: { wasmPaths: Record<string, string> };
  }
).wasm.wasmPaths = {
  "ort-wasm.wasm": ortWasmUrl,
  "ort-wasm-threaded.wasm": ortWasmThreadedUrl,
  "ort-wasm-simd.wasm": ortWasmSimdUrl,
  "ort-wasm-simd-threaded.wasm": ortWasmSimdThreadedUrl,
};

export async function applyChatTemplate(parameters: {
  modelNameOrPath: string;
  chat: { role: string; content: string }[];
  addGenerationPrompt?: boolean;
}) {
  const tokenizer = await AutoTokenizer.from_pretrained(
    parameters.modelNameOrPath,
  );
  return tokenizer.apply_chat_template(parameters.chat, {
    tokenize: false,
    add_generation_prompt: parameters.addGenerationPrompt,
  }) as string;
}

export async function runTextToTextGenerationPipeline<
  T extends string | string[],
>(parameters: {
  handleModelLoadingProgress?: (event: {
    file: string;
    progress: number;
  }) => void;
  model: string;
  quantized: boolean;
  input: T;
  pipelineArguments?: Record<string, unknown>;
}): Promise<T> {
  const generator = await pipeline("text-generation", parameters.model, {
    quantized: parameters.quantized,
    progress_callback:
      parameters.handleModelLoadingProgress ??
      ((event: { file: string; progress: number }) => {
        self.postMessage({
          type: "model-loading-progress",
          payload: event,
        });
      }),
  });

  const responses = await generator(
    parameters.input,
    parameters.pipelineArguments,
  );

  await generator.dispose();

  if (Array.isArray(parameters.input)) {
    return responses.map(
      ([response]: { generated_text: string }[]) => response.generated_text,
    );
  }

  const [response] = responses;
  return response.generated_text;
}
