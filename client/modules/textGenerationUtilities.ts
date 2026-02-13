import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import {
  getLlmTextSearchResults,
  getQuery,
  getSearchPromise,
  getSettings,
  getTextGenerationState,
  updateTextGenerationState,
} from "./pubSub";
import { getSystemPrompt } from "./systemPrompt";
import type { ChatMessage } from "./types";

/**
 * Default context size for text generation in tokens
 */
export const defaultContextSize = 4096;

/**
 * Custom error class for chat generation failures
 */
export class ChatGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGenerationError";
  }
}

/**
 * Formats search results for inclusion in chat prompts
 * @param shouldIncludeUrl - Whether to include URLs in the formatted output
 * @returns Formatted search results string
 */
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

/**
 * Waits for search results if they are required before starting response generation
 */
export async function canStartResponding() {
  if (getSettings().searchResultsToConsider > 0) {
    updateTextGenerationState("awaitingSearchResults");
    await getSearchPromise();
  }
}

/**
 * Gets default parameters for streaming chat completion requests
 * @returns Default chat completion parameters
 */
export function getDefaultChatCompletionCreateParamsStreaming() {
  const settings = getSettings();
  return {
    stream: true,
    max_tokens: settings.openAiContextLength ?? defaultContextSize,
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
