import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import {
  getLlmTextSearchResults,
  getQuery,
  getSearchPromise,
  getSettings,
  getTextGenerationState,
  updateTextGenerationState,
} from "./pubSub";
import { getSystemPrompt } from "./systemPrompt";

export const defaultContextSize = 4096;

export class ChatGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGenerationError";
  }
}

export function getFormattedSearchResults(shouldIncludeUrl: boolean) {
  const searchResults = getLlmTextSearchResults();

  if (searchResults.length === 0) return "None.";

  if (shouldIncludeUrl) {
    return searchResults
      .map(([title, snippet, url]) => `• [${title}](${url}) | ${snippet}`)
      .join("\n");
  }

  return searchResults
    .map(([title, snippet]) => `• ${title} | ${snippet}`)
    .join("\n");
}

export async function canStartResponding() {
  if (getSettings().searchResultsToConsider > 0) {
    updateTextGenerationState("awaitingSearchResults");
    await getSearchPromise();
  }
}

export function getDefaultChatCompletionCreateParamsStreaming() {
  const settings = getSettings();
  return {
    stream: true,
    max_tokens: defaultContextSize,
    temperature: settings.inferenceTemperature,
    top_p: settings.inferenceTopP,
    min_p: settings.minP,
    frequency_penalty: settings.inferenceFrequencyPenalty,
    presence_penalty: settings.inferencePresencePenalty,
  } as const;
}

export async function handleStreamingResponse(
  completion: AsyncIterable<ChatCompletionChunk>,
  onChunk: (streamedMessage: string) => void,
  options?: {
    abortController?: { abort: () => void };
    shouldUpdateGeneratingState?: boolean;
  },
) {
  let streamedMessage = "";

  for await (const chunk of completion) {
    const deltaContent = chunk.choices[0].delta.content;

    if (deltaContent) {
      streamedMessage += deltaContent;
      onChunk(streamedMessage);
    }

    if (getTextGenerationState() === "interrupted") {
      if (options?.abortController) {
        options.abortController.abort();
      }
      throw new ChatGenerationError("Chat generation interrupted");
    }

    if (
      options?.shouldUpdateGeneratingState &&
      getTextGenerationState() !== "generating"
    ) {
      updateTextGenerationState("generating");
    }
  }

  return streamedMessage;
}

export function getDefaultChatMessages(searchResults: string): ChatMessage[] {
  return [
    {
      role: "user",
      content: getSystemPrompt(searchResults),
    },
    { role: "assistant", content: "Ok!" },
    { role: "user", content: getQuery() },
  ];
}
