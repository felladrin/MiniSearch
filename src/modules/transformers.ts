import {
  pipeline,
  env,
  AutoTokenizer,
  TextGenerationOutput,
  AutoModelForSequenceClassification,
} from "@xenova/transformers";
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
  tokenizer.chat_template =
    "{% for message in messages %}{{'<|im_start|>' + message['role'] + '\\n' + message['content'] + '<|im_end|>' + '\\n'}}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>assistant\\n' }}{% endif %}";
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
    return (responses as TextGenerationOutput[]).map(
      ([response]) => response.generated_text,
    ) as T;
  }

  const [response] = responses as TextGenerationOutput;
  return response.generated_text as T;
}

/**
 * Performs ranking with the CrossEncoder on the given query and documents.
 * Returns a sorted list with the document indices and scores.
 */
export async function rank(
  /** A single query */
  query: string,
  /** A list of documents */
  documents: string[],
  {
    /** Return the top-k documents. If undefined, all documents are returned. */
    top_k = undefined,
    /** If true, also returns the documents. If false, only returns the indices and scores. */
    return_documents = false,
  }: { top_k?: number; return_documents?: boolean } = {},
) {
  const model_id = "mixedbread-ai/mxbai-rerank-xsmall-v1";

  const model =
    await AutoModelForSequenceClassification.from_pretrained(model_id);

  const tokenizer = await AutoTokenizer.from_pretrained(model_id);

  const inputs = tokenizer(new Array(documents.length).fill(query), {
    text_pair: documents,
    padding: true,
    truncation: true,
  });

  const { logits } = await model(inputs);

  model.dispose();

  return logits
    .sigmoid()
    .tolist()
    .map(([score]: number[], i: number) => ({
      corpus_id: i,
      score,
      ...(return_documents ? { text: documents[i] } : {}),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .slice(0, top_k) as {
    corpus_id: number;
    score: number;
    text?: string;
  }[];
}
