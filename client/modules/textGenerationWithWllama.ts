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
import { getSystemPrompt } from "./systemPrompt";
import {
  ChatGenerationError,
  canStartResponding,
  defaultContextSize,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import { type WllamaModel, wllamaModels } from "./wllama";

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
    const settings = getSettings();
    const modelConfig = wllamaModels[settings.wllamaModelId];
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: getSystemPrompt(
          getFormattedSearchResults(modelConfig.shouldIncludeUrlsOnPrompt),
        ),
      },
      { role: "assistant", content: "Ok!" },
      { role: "user", content: getQuery() },
    ];
    const response = await generateWithWllama({
      messages,
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
  if (messages.length === 0) {
    throw new Error("No messages provided for chat generation");
  }

  return generateWithWllama({
    messages,
    onUpdate,
    shouldCheckCanRespond: false,
  });
}

interface WllamaConfig {
  messages: ChatMessage[];
  onUpdate: (text: string) => void;
  shouldCheckCanRespond?: boolean;
}

async function generateWithWllama({
  messages,
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

    const chatMessages = messages.map((msg) => {
      const role = msg.role || "user";
      const wllamaRole =
        role === "developer"
          ? "system"
          : role === "system" || role === "user" || role === "assistant"
            ? role
            : "user";
      return {
        role: wllamaRole as "system" | "user" | "assistant",
        content: msg.content,
      };
    });

    const stream = await wllama.createChatCompletion(chatMessages, {
      nPredict: defaultContextSize,
      stopTokens: model.stopTokens,
      sampling: model.getSampling(),
      stream: true,
      abortSignal: abortController.signal,
    });

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
