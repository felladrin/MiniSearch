import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import {
  canStartResponding,
  getDefaultChatCompletionCreateParamsStreaming,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "./textGenerationUtilities";

let currentAbortController: AbortController | null = null;

interface StreamOptions {
  messages: ChatMessage[];
  onUpdate: (text: string) => void;
}

async function createOpenAiStream({
  messages,
  onUpdate,
}: StreamOptions): Promise<string> {
  const settings = getSettings();
  const openaiProvider = createOpenAICompatible({
    name: settings.openAiApiBaseUrl,
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
  });

  const params = getDefaultChatCompletionCreateParamsStreaming();

  try {
    currentAbortController = new AbortController();

    const stream = streamText({
      model: openaiProvider.chatModel(settings.openAiApiModel),
      messages: messages.map((msg) => ({
        role: msg.role || "user",
        content: msg.content,
      })),
      maxTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p,
      frequencyPenalty: params.frequency_penalty,
      presencePenalty: params.presence_penalty,
      abortSignal: currentAbortController.signal,
    });

    let text = "";
    for await (const part of stream.fullStream) {
      if (getTextGenerationState() === "interrupted") {
        currentAbortController.abort();
        throw new Error("Chat generation interrupted");
      }

      if (part.type === "text-delta") {
        text += part.textDelta;
        onUpdate(text);
      }
    }

    return text;
  } catch (error) {
    if (
      getTextGenerationState() === "interrupted" ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new Error("Chat generation interrupted");
    }
    throw error;
  } finally {
    currentAbortController = null;
  }
}

export async function generateTextWithOpenAi() {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");

  const messages = getDefaultChatMessages(getFormattedSearchResults(true));
  updateTextGenerationState("generating");

  await createOpenAiStream({
    messages,
    onUpdate: updateResponse,
  });
}

export async function generateChatWithOpenAi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  return createOpenAiStream({ messages, onUpdate });
}
