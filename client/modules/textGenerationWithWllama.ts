import type { Wllama } from "@wllama/wllama";
import { FALLBACK_CONFIG, getConfig } from "./config";
import { GenerationRateMeter } from "./generationRate";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  updateGenerationRate,
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

export async function generateTextWithWllama(
  signal?: AbortSignal,
): Promise<string> {
  if (!getSettings().enableAiResponse) return "";

  try {
    const rateMeter = new GenerationRateMeter();
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
      rateMeter,
      signal,
    });
    // An abort while the session exits still returns the whole answer.
    if (signal?.aborted)
      throw new ChatGenerationError("Generation interrupted");
    updateResponse(response);
    updateGenerationRate(rateMeter.rate());
    return response;
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
  signal?: AbortSignal,
): Promise<string> {
  if (messages.length === 0) {
    throw new Error("No messages provided for chat generation");
  }

  return generateWithWllama({
    messages,
    onUpdate,
    shouldCheckCanRespond: false,
    signal,
  });
}

interface WllamaConfig {
  messages: ChatMessage[] | (() => ChatMessage[] | Promise<ChatMessage[]>);
  onUpdate: (text: string) => void;
  shouldCheckCanRespond?: boolean;
  signal?: AbortSignal;
  /**
   * Times the answer for the speed line. Only the main answer carries one:
   * a chat reply shows no rate, and it shares this generation code.
   */
  rateMeter?: GenerationRateMeter;
}

/**
 * The tail of the chain of browser-model sessions: each caller appends itself,
 * so only one session is open at a time. Two at once load the model into wasm
 * memory twice, and while it is not cached yet the second load fails on the
 * browser's exclusive file lock. Not a single-flight promise around the
 * instance: two callers would share one instance, and each calls `exit()` in
 * its finally, so whichever finished first would kill the other's answer.
 */
let modelSessionQueue: Promise<unknown> = Promise.resolve();

/** Runs `session` once every session already queued has finished. */
function withModelSession<T>(session: () => Promise<T>): Promise<T> {
  const queued = modelSessionQueue.then(session);
  // Settle the chain copy, so a failed session neither skips the next caller
  // nor replaces its error with the previous one.
  modelSessionQueue = queued.catch(() => {});
  return queued;
}

async function generateWithWllama(config: WllamaConfig): Promise<string> {
  return withModelSession(() => runWllamaGeneration(config));
}

async function runWllamaGeneration({
  messages: messagesOrBuilder,
  onUpdate,
  shouldCheckCanRespond = false,
  rateMeter,
  signal,
}: WllamaConfig): Promise<string> {
  let loadingPercentage = 0;
  let wllamaInstance: Wllama | undefined;
  const abortController = new AbortController();
  const interrupt = () => abortController.abort();
  signal?.addEventListener("abort", interrupt, { once: true });
  const throwIfInterrupted = () => {
    if (signal?.aborted) {
      throw new ChatGenerationError("Chat generation interrupted");
    }
  };

  try {
    throwIfInterrupted();

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
    // The load cannot be cancelled, so a run aborted meanwhile stops here.
    throwIfInterrupted();

    if (shouldCheckCanRespond) {
      await canStartResponding(signal);
      updateTextGenerationState("preparingToGenerate");
    }

    const messages =
      typeof messagesOrBuilder === "function"
        ? await messagesOrBuilder()
        : messagesOrBuilder;

    throwIfInterrupted();

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

    let generating = false;

    for await (const chunk of stream) {
      throwIfInterrupted();

      const delta = chunk.choices[0]?.delta?.content ?? "";
      // wllama splits a thinking model's chain of thought into its own
      // channel; the type does not declare it yet.
      const reasoningDelta =
        (chunk.choices[0]?.delta as { reasoning_content?: string } | undefined)
          ?.reasoning_content ?? "";
      // The last chunk carries llama.cpp's own decode speed, with no text, so
      // it is read before the skip below. A chunk is not always one token, so
      // nothing is counted here.
      rateMeter?.setMeasuredRate(
        chunk.timings?.predicted_per_second ?? undefined,
      );
      if (!delta && !reasoningDelta) continue;

      if (shouldCheckCanRespond && !generating) {
        generating = true;
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

    throwIfInterrupted();

    return streamedMessage;
  } catch (error) {
    addLogEntry(
      `Wllama generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  } finally {
    signal?.removeEventListener("abort", interrupt);
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

  const serverConfig = await getConfig().catch(() => undefined);
  const config = serverConfig ?? FALLBACK_CONFIG;
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
  // The shipped default serves this answer only: saved, it would stand in for
  // the server's own default on every later load.
  if (serverConfig) {
    updateSettings({ ...getSettings(), wllamaModelId: defaultId });
  }
  return defaultModel;
}

async function initializeWllamaInstance(progressCallback?: ProgressCallback) {
  const { initializeWllama } = await import("./wllama");
  const model = await getSelectedWllamaModel();

  updateModelSizeInMegabytes(model.fileSizeInMegabytes);

  const wllama = await initializeWllama(model.hfRepoId, model.hfFilePath, {
    wllama: {
      suppressNativeLog: true,
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

  for (const stopString of model.stopStrings) {
    const windowStart = Math.max(0, currentText.length - stopString.length * 2);
    const stopPosition = currentText.indexOf(stopString, windowStart);

    if (stopPosition !== -1) {
      abortSignal();
      const cleanedText = currentText.slice(0, stopPosition);
      onUpdate(cleanedText);
      return cleanedText;
    }
  }

  onUpdate(currentText);
  return currentText;
}
