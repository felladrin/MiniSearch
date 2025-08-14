import type { Wllama } from "@wllama/wllama";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { addLogEntry } from "./logEntries";
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
import type { WllamaModel } from "./wllama";

type ProgressCallback = ({
  loaded,
  total,
}: {
  loaded: number;
  total: number;
}) => void;

export async function generateTextWithWllama(): Promise<void> {
  if (!getSettings().enableAiResponse) return;

  try {
    const response = await generateWithWllama({
      input: getQuery(),
      onUpdate: updateResponse,
      shouldCheckCanRespond: true,
    });
    updateResponse(response);
  } catch (error) {
    addLogEntry(
      `Text generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
}

export async function generateChatWithWllama(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
): Promise<string> {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) throw new Error("No messages provided for chat generation");

  return generateWithWllama({
    input: lastMessage.content,
    onUpdate,
    shouldCheckCanRespond: false,
  });
}

interface WllamaConfig {
  input: string;
  onUpdate: (text: string) => void;
  shouldCheckCanRespond?: boolean;
}

async function generateWithWllama({
  input,
  onUpdate,
  shouldCheckCanRespond = false,
}: WllamaConfig): Promise<string> {
  let loadingPercentage = 0;
  let wllamaInstance: Wllama | undefined;
  const abortController = new AbortController();

  try {
    const progressCallback: ProgressCallback | undefined = shouldCheckCanRespond
      ? ({ loaded, total }) => {
          const progressPercentage = Math.round((loaded / total) * 100);
          if (loadingPercentage !== progressPercentage) {
            loadingPercentage = progressPercentage;
            updateModelLoadingProgress(progressPercentage);
          }
        }
      : undefined;

    const { wllama, model } = await initializeWllamaInstance(progressCallback);
    wllamaInstance = wllama;

    if (shouldCheckCanRespond) {
      await canStartResponding();
      updateTextGenerationState("preparingToGenerate");
    }

    let streamedMessage = "";

    const stream = await wllama.createChatCompletion(
      model.getMessages(
        input,
        getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
      ),
      {
        nPredict: defaultContextSize,
        stopTokens: model.stopTokens,
        sampling: model.getSampling(),
        stream: true,
        abortSignal: abortController.signal,
      },
    );

    for await (const chunk of stream) {
      if (shouldCheckCanRespond) {
        if (getTextGenerationState() === "interrupted") {
          abortController.abort();
          throw new ChatGenerationError("Chat generation interrupted");
        }

        if (getTextGenerationState() !== "generating") {
          updateTextGenerationState("generating");
        }
      }

      streamedMessage = handleWllamaCompletion(
        model,
        chunk.currentText,
        () => abortController.abort(),
        onUpdate,
      );
    }

    return streamedMessage;
  } catch (error) {
    addLogEntry(
      `Wllama generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  } finally {
    if (wllamaInstance) {
      await wllamaInstance.exit().catch((error) => {
        addLogEntry(
          `Failed to cleanup Wllama instance: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      });
    }
  }
}

async function initializeWllamaInstance(progressCallback?: ProgressCallback) {
  const { initializeWllama, wllamaModels } = await import("./wllama");
  const model = wllamaModels[getSettings().wllamaModelId];

  updateModelSizeInMegabytes(model.fileSizeInMegabytes);

  const wllama = await initializeWllama(model.hfRepoId, model.hfFilePath, {
    wllama: {
      suppressNativeLog: true,
      allowOffline: true,
    },
    model: {
      n_threads: getSettings().cpuThreads,
      n_ctx: model.contextSize,
      n_batch: 512,
      cache_type_k: model.cacheTypeK,
      cache_type_v: model.cacheTypeV,
      flash_attn: model.flash_attn,
      embeddings: false,
      progressCallback,
    },
  });

  return { wllama, model };
}

function handleWllamaCompletion(
  model: WllamaModel,
  currentText: string,
  abortSignal: () => void,
  onUpdate: (text: string) => void,
): string {
  if (!model.stopStrings?.length) {
    onUpdate(currentText);
    return currentText;
  }

  const stopIndex = model.stopStrings.findIndex((stopString) =>
    currentText.slice(-(stopString.length * 2)).includes(stopString),
  );

  if (stopIndex !== -1) {
    abortSignal();
    const cleanedText = currentText.slice(
      0,
      -model.stopStrings[stopIndex].length,
    );
    onUpdate(cleanedText);
    return cleanedText;
  }

  onUpdate(currentText);
  return currentText;
}
