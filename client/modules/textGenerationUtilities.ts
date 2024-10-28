import type { ChatCompletionChunk as WebLlmChatCompletionChunk } from "@mlc-ai/web-llm";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import type { Stream } from "openai/streaming.mjs";
import {
  getQuery,
  getSearchPromise,
  getSearchResults,
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { defaultSettings } from "./settings";
import { getSystemPrompt } from "./systemPrompt";

export class ChatGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGenerationError";
  }
}

export function getFormattedSearchResults(shouldIncludeUrl: boolean) {
  const searchResults = getSearchResults().textResults.slice(
    0,
    getSettings().searchResultsToConsider,
  );

  if (searchResults.length === 0) return "None.";

  if (shouldIncludeUrl) {
    return searchResults
      .map(
        ([title, snippet, url], index) =>
          `${index + 1}. [${title}](${url}) | ${snippet}`,
      )
      .join("\n");
  }

  return searchResults
    .map(([title, snippet]) => `- ${title} | ${snippet}`)
    .join("\n");
}

export async function canStartResponding() {
  if (getSettings().searchResultsToConsider > 0) {
    updateTextGenerationState("awaitingSearchResults");
    await getSearchPromise();
  }
}

export function updateResponseRateLimited(text: string) {
  const currentTime = Date.now();

  if (
    currentTime - updateResponseRateLimited.lastUpdateTime >=
    updateResponseRateLimited.updateInterval
  ) {
    updateResponse(text);
    updateResponseRateLimited.lastUpdateTime = currentTime;
  }
}
updateResponseRateLimited.lastUpdateTime = 0;
updateResponseRateLimited.updateInterval = 1000 / 12;

export function getDefaultChatCompletionCreateParamsStreaming() {
  return {
    stream: true,
    max_tokens: 2048,
    temperature: defaultSettings.inferenceTemperature,
    top_p: defaultSettings.inferenceTopP,
    frequency_penalty: defaultSettings.inferenceFrequencyPenalty,
    presence_penalty: defaultSettings.inferencePresencePenalty,
  } as const;
}

export async function handleStreamingResponse(
  completion:
    | Stream<ChatCompletionChunk>
    | AsyncIterable<WebLlmChatCompletionChunk>,
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
