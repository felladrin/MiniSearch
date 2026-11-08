import type { Wllama } from "@wllama/wllama";
import { FALLBACK_CONFIG, getConfig } from "./config";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateModelLoadingProgress,
  updateModelSizeInMegabytes,
  updateResponse,
  updateSettings,
  updateTextGenerationState,
} from "./pubSub";
import {
  ChatGenerationError,
  canStartResponding,
  defaultContextSize,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import type { ChatMessage } from "./types";
import { webGpuSupport } from "./webGpu";
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
    const response = await generateWithWllama({
      messages: async () => {
        const modelConfig = await getSelectedWllamaModel();
        return getDefaultChatMessages(
          await getFormattedSearchResults(
            modelConfig.shouldIncludeUrlsOnPrompt,
          ),
        );
      },
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
  messages: ChatMessage[] | (() => ChatMessage[] | Promise<ChatMessage[]>);
  onUpdate: (text: string) => void;
  shouldCheckCanRespond?: boolean;
}

async function generateWithWllama({
  messages: messagesOrBuilder,
  onUpdate,
  shouldCheckCanRespond = false,
}: WllamaConfig): Promise<string> {
  let loadingPercentage = 0;
  let wllamaInstance: Wllama | undefined;
  const abortController = new AbortController();

  try {
    const progressCallback: ProgressCallback | undefined = shouldCheckCanRespond
      ? ({ loaded, total }) => {
          if (total <= 0) return;
          const progressPercentage = Math.round((loaded / total) * 100);
          if (loadingPercentage !== progressPercentage) {
            loadingPercentage = progressPercentage;
            // Republished on every step so the size is never missed by a
            // subscriber that mounted after the initial estimate.
            updateModelSizeInMegabytes(total / 1024 / 1024);
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

    const messages =
      typeof messagesOrBuilder === "function"
        ? await messagesOrBuilder()
        : messagesOrBuilder;

    let reasoningText = "";
    let answerText = "";
    let streamedMessage = "";

    const stream = await wllama.createChatCompletion({
      messages,
      max_tokens: defaultContextSize,
      stream: true,
      abortSignal: abortController.signal,
      ...model.getSampling(),
      ...(model.chatTemplateKwargs
        ? { chat_template_kwargs: model.chatTemplateKwargs }
        : {}),
    });

    for await (const chunk of stream) {
      if (shouldCheckCanRespond) {
        if (getTextGenerationState() === "interrupted") {
          abortController.abort();
          throw new ChatGenerationError("Chat generation interrupted");
        }
      }

      const delta = chunk.choices[0]?.delta?.content ?? "";
      // wllama splits a thinking model's chain of thought into its own
      // channel; the type does not declare it yet.
      const reasoningDelta =
        (chunk.choices[0]?.delta as { reasoning_content?: string } | undefined)
          ?.reasoning_content ?? "";
      if (!delta && !reasoningDelta) continue;

      if (shouldCheckCanRespond && getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      if (reasoningDelta) reasoningText += reasoningDelta;
      if (delta) answerText += delta;

      streamedMessage = handleWllamaCompletion(
        model,
        composeStreamedText(reasoningText, answerText),
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

/**
 * The model the settings point at, or the default when that model has left
 * the catalog. Without this, removing a model from the catalog would break
 * every answer for whoever had picked it.
 */
async function getSelectedWllamaModel(): Promise<WllamaModel> {
  const { wllamaModelId } = getSettings();
  const model = wllamaModels[wllamaModelId];
  if (model) return model;

  // Safe without the server: the fallback is only a model to switch to.
  const config = await getConfig().catch(() => FALLBACK_CONFIG);
  const defaultId = (await webGpuSupport)
    ? config.wllamaDefaultGpuModelId
    : config.wllamaDefaultModelId;
  const defaultModel = wllamaModels[defaultId];
  if (!defaultModel) {
    throw new Error(
      `Neither the selected model "${wllamaModelId}" nor the default "${defaultId}" is in the catalog`,
    );
  }

  addLogEntry(
    `Model "${wllamaModelId}" is no longer available; switched to "${defaultId}"`,
  );
  updateSettings({ ...getSettings(), wllamaModelId: defaultId });
  return defaultModel;
}

async function initializeWllamaInstance(progressCallback?: ProgressCallback) {
  const { initializeWllama } = await import("./wllama");
  const model = await getSelectedWllamaModel();

  updateModelSizeInMegabytes(model.fileSizeInMegabytes);

  const wllama = await initializeWllama(model.hfRepoId, model.hfFilePath, {
    wllama: {
      suppressNativeLog: true,
      allowOffline: true,
    },
    chatTemplateKwargs: model.chatTemplateKwargs,
    model: {
      n_threads: getSettings().cpuThreads,
      n_ctx: model.contextSize,
      n_batch: 512,
      cache_type_k: model.cacheTypeK,
      cache_type_v: model.cacheTypeV,
      flash_attn: model.flash_attn,
      embeddings: false,
      n_gpu_layers: (await webGpuSupport) ? 99999 : 0,
      ...(model.reasoningBudgetTokens
        ? { reasoning_budget_tokens: model.reasoningBudgetTokens }
        : {}),
      progressCallback,
    },
  });

  return { wllama, model };
}

/**
 * Joins the reasoning and answer channels into one stream so the existing
 * reasoning-marker parsing in the UI shows the chain of thought while the
 * model thinks. The end marker only appears once the answer has started,
 * which keeps the UI in its "still thinking" state until then.
 */
export function composeStreamedText(reasoning: string, answer: string): string {
  if (!reasoning) return answer;
  const { reasoningStartMarker, reasoningEndMarker } = getSettings();
  return `${reasoningStartMarker}${reasoning}${
    answer ? `${reasoningEndMarker}${answer}` : ""
  }`;
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
