import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../../shared/openaiModels";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { sleep } from "./sleep";
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

  let effectiveModel = settings.openAiApiModel;
  let availableModels: { id: string }[] = [];

  if (!effectiveModel) {
    try {
      availableModels = await listOpenAiCompatibleModels(
        settings.openAiApiBaseUrl,
        settings.openAiApiKey,
      );
      const selectedModel = selectRandomModel(availableModels);
      if (selectedModel) effectiveModel = selectedModel;
    } catch (err) {
      addLogEntry(
        `Failed to list OpenAI models: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const maxRetries = 5;
  const attemptedModels = new Set<string>();
  let currentAttempt = 0;

  const tryNextModel = async (): Promise<string> => {
    if (currentAttempt >= maxRetries) {
      throw new Error(
        `Failed to generate text after ${maxRetries} retries with different models`,
      );
    }

    if (effectiveModel) {
      attemptedModels.add(effectiveModel);
    }

    currentAttempt++;

    currentAbortController = new AbortController();
    let shouldRetry = false;

    try {
      const stream = streamText({
        model: openaiProvider.chatModel(effectiveModel),
        messages: messages.map((msg) => ({
          role: msg.role || "user",
          content: msg.content,
        })),
        maxOutputTokens: params.max_tokens,
        temperature: params.temperature,
        topP: params.top_p,
        frequencyPenalty: params.frequency_penalty,
        presencePenalty: params.presence_penalty,
        abortSignal: currentAbortController.signal,
        maxRetries: 0,
        onError: async (error) => {
          if (
            getTextGenerationState() === "interrupted" ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            throw new Error("Chat generation interrupted");
          }

          if (availableModels.length > 0 && currentAttempt < maxRetries) {
            const nextModel = selectRandomModel(
              availableModels,
              attemptedModels,
            );
            if (nextModel) {
              addLogEntry(
                `Model "${effectiveModel}" failed, retrying with "${nextModel}" (Attempt ${currentAttempt}/${maxRetries})`,
              );
              effectiveModel = nextModel;
              shouldRetry = true;
              await sleep(100 * currentAttempt);
              throw error;
            }
          }

          throw error;
        },
      });

      let text = "";
      for await (const part of stream.fullStream) {
        if (getTextGenerationState() === "interrupted") {
          currentAbortController.abort();
          throw new Error("Chat generation interrupted");
        }

        if (part.type === "text-delta") {
          text += part.text;
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

      if (shouldRetry) {
        return tryNextModel();
      }

      throw error;
    } finally {
      currentAbortController = null;
    }
  };

  return tryNextModel();
}

export async function generateTextWithOpenAi() {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");

  const messages = getDefaultChatMessages(getFormattedSearchResults(true));

  await createOpenAiStream({
    messages,
    onUpdate: (text) => {
      if (getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      updateResponse(text);
    },
  });
}

export async function generateChatWithOpenAi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  return createOpenAiStream({ messages, onUpdate });
}
