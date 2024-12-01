import type { LoadModelConfig } from "@wllama/wllama/esm";
import {
  getQuery,
  getSettings,
  getTextGenerationState,
  updateModelLoadingProgress,
  updateModelSizeInMegabytes,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import {
  ChatGenerationError,
  canStartResponding,
  defaultContextSize,
  getFormattedSearchResults,
} from "./textGenerationUtilities";

export async function generateTextWithWllama() {
  if (!getSettings().enableAiResponse) return;

  const response = await generateWithWllama(getQuery(), updateResponse, true);

  updateResponse(response);
}

export async function generateChatWithWllama(
  messages: import("gpt-tokenizer/GptEncoding").ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  return generateWithWllama(
    messages[messages.length - 1].content,
    onUpdate,
    false,
  );
}

async function initializeWllamaInstance(
  progressCallback?: ({
    loaded,
    total,
  }: {
    loaded: number;
    total: number;
  }) => void,
) {
  const { initializeWllama, wllamaModels } = await import("./wllama");
  const model = wllamaModels[getSettings().wllamaModelId];

  updateModelSizeInMegabytes(model.fileSizeInMegabytes);

  const wllama = await initializeWllama(model.url, {
    wllama: {
      suppressNativeLog: true,
    },
    model: {
      n_threads: getSettings().cpuThreads,
      n_ctx: model.contextSize,
      cache_type_k: model.cacheTypeK as LoadModelConfig["cache_type_k"],
      cache_type_v: model.cacheTypeV as LoadModelConfig["cache_type_v"],
      embeddings: false,
      allowOffline: true,
      progressCallback,
    },
  });

  return { wllama, model };
}

async function generateWithWllama(
  input: string,
  onUpdate: (partialResponse: string) => void,
  shouldCheckCanRespond = false,
) {
  let loadingPercentage = 0;

  const { wllama, model } = await initializeWllamaInstance(
    shouldCheckCanRespond
      ? ({ loaded, total }) => {
          const progressPercentage = Math.round((loaded / total) * 100);
          if (loadingPercentage !== progressPercentage) {
            loadingPercentage = progressPercentage;
            updateModelLoadingProgress(progressPercentage);
          }
        }
      : undefined,
  );

  if (shouldCheckCanRespond) {
    await canStartResponding();
    updateTextGenerationState("preparingToGenerate");
  }

  const prompt = await model.buildPrompt(
    wllama,
    input,
    getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
  );

  let streamedMessage = "";

  await wllama.createCompletion(prompt, {
    nPredict: defaultContextSize / 2,
    stopTokens: model.stopTokens,
    sampling: model.getSampling(),
    onNewToken: (_token, _piece, currentText, { abortSignal }) => {
      if (shouldCheckCanRespond && getTextGenerationState() === "interrupted") {
        abortSignal();
        throw new ChatGenerationError("Chat generation interrupted");
      }

      if (shouldCheckCanRespond && getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      streamedMessage = handleWllamaCompletion(
        model,
        currentText,
        abortSignal,
        onUpdate,
      );
    },
  });

  await wllama.exit();
  return streamedMessage;
}

function handleWllamaCompletion(
  model: import("./wllama").WllamaModel,
  currentText: string,
  abortSignal: () => void,
  onUpdate: (text: string) => void,
) {
  let text = currentText;

  if (model.stopStrings) {
    for (const stopString of model.stopStrings) {
      if (text.slice(-(stopString.length * 2)).includes(stopString)) {
        abortSignal();
        text = text.slice(0, -stopString.length);
        break;
      }
    }
  }

  onUpdate(text);
  return text;
}
