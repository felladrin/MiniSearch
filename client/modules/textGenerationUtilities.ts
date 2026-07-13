import {
  getLlmTextSearchResults,
  getQuery,
  getSearchPromise,
  getSettings,
  updateTextGenerationState,
} from "./pubSub";
import { getSystemPrompt } from "./systemPrompt";
import type { ChatMessage } from "./types";

/**
 * Default context size for text generation in tokens
 */
export const defaultContextSize = 4096;

/**
 * Number of top text search results included in the AI context
 */
export const searchResultsToConsider = 6;

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
  updateTextGenerationState("awaitingSearchResults");
  await getSearchPromise();
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
    temperature: 0.35,
    top_p: 1.0,
    min_p: 0.0,
    top_k: 40,
  } as const;
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
