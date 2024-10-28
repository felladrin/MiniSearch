import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import { getOpenAiClient } from "./openai";
import { getSettings, updateTextGenerationState } from "./pubSub";
import {
  canStartResponding,
  getDefaultChatCompletionCreateParamsStreaming,
  getDefaultChatMessages,
  getFormattedSearchResults,
  handleStreamingResponse,
  updateResponseRateLimited,
} from "./textGenerationUtilities";

export async function generateTextWithOpenAi() {
  const settings = getSettings();
  const openai = getOpenAiClient({
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
  });

  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");

  const completion = await openai.chat.completions.create({
    ...getDefaultChatCompletionCreateParamsStreaming(),
    model: settings.openAiApiModel,
    messages: getDefaultChatMessages(
      getFormattedSearchResults(true),
    ) as ChatCompletionMessageParam[],
  });

  await handleStreamingResponse(completion, updateResponseRateLimited, {
    abortController: completion.controller,
    shouldUpdateGeneratingState: true,
  });
}

export async function generateChatWithOpenAi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const settings = getSettings();
  const openai = getOpenAiClient({
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
  });

  const completion = await openai.chat.completions.create({
    ...getDefaultChatCompletionCreateParamsStreaming(),
    model: settings.openAiApiModel,
    messages: messages as ChatCompletionMessageParam[],
  });

  return handleStreamingResponse(completion, onUpdate, {
    abortController: completion.controller,
  });
}
