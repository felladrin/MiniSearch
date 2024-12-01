import type {
  ChatCompletionMessageParam,
  ChatOptions,
  InitProgressCallback,
  MLCEngineConfig,
} from "@mlc-ai/web-llm";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  updateModelLoadingProgress,
  updateModelSizeInMegabytes,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import {
  canStartResponding,
  defaultContextSize,
  getDefaultChatCompletionCreateParamsStreaming,
  getDefaultChatMessages,
  getFormattedSearchResults,
  handleStreamingResponse,
} from "./textGenerationUtilities";

export async function generateTextWithWebLlm() {
  const engine = await initializeWebLlmEngine();

  if (getSettings().enableAiResponse) {
    await canStartResponding();
    updateTextGenerationState("preparingToGenerate");

    const completion = await engine.chat.completions.create({
      ...getDefaultChatCompletionCreateParamsStreaming(),
      messages: getDefaultChatMessages(
        getFormattedSearchResults(true),
      ) as ChatCompletionMessageParam[],
    });

    await handleStreamingResponse(completion, updateResponse, {
      shouldUpdateGeneratingState: true,
    });
  }

  addLogEntry(
    `WebLLM finished generating the response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();
}

export async function generateChatWithWebLlm(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const engine = await initializeWebLlmEngine();

  const completion = await engine.chat.completions.create({
    ...getDefaultChatCompletionCreateParamsStreaming(),
    messages: messages as ChatCompletionMessageParam[],
  });

  const response = await handleStreamingResponse(completion, onUpdate);

  addLogEntry(
    `WebLLM finished generating the chat response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();
  return response;
}

async function initializeWebLlmEngine() {
  const {
    CreateWebWorkerMLCEngine,
    CreateMLCEngine,
    hasModelInCache,
    prebuiltAppConfig,
  } = await import("@mlc-ai/web-llm");

  const selectedModelId = getSettings().webLlmModelId;

  updateModelSizeInMegabytes(
    prebuiltAppConfig.model_list.find((m) => m.model_id === selectedModelId)
      ?.vram_required_MB || 0,
  );

  addLogEntry(`Selected WebLLM model: ${selectedModelId}`);

  const isModelCached = await hasModelInCache(selectedModelId);
  let initProgressCallback: InitProgressCallback | undefined;

  if (!isModelCached) {
    initProgressCallback = (report) => {
      updateModelLoadingProgress(Math.round(report.progress * 100));
    };
  }

  const engineConfig: MLCEngineConfig = {
    initProgressCallback,
    logLevel: "SILENT",
  };

  const chatOptions: ChatOptions = {
    context_window_size: defaultContextSize,
    sliding_window_size: -1,
    attention_sink_size: -1,
  };

  return Worker
    ? await CreateWebWorkerMLCEngine(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
        selectedModelId,
        engineConfig,
        chatOptions,
      )
    : await CreateMLCEngine(selectedModelId, engineConfig, chatOptions);
}
