import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
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

interface ModelData {
  id: string;
}

function selectRandomModel(
  models: ModelData[],
  excludeIds: Set<string> = new Set(),
): string | null {
  if (!models || models.length === 0) return null;
  const availableModels = models.filter((m) => !excludeIds.has(m.id));
  if (availableModels.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * availableModels.length);
  return availableModels[randomIndex].id;
}

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
  let availableModels: ModelData[] = [];

  if (!effectiveModel) {
    const response = await fetch(`${settings.openAiApiBaseUrl}/models`, {
      headers: {
        ...(settings.openAiApiKey
          ? { Authorization: `Bearer ${settings.openAiApiKey}` }
          : {}),
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const json = await response.json();
      availableModels = json?.data || [];
      const selectedModel = selectRandomModel(availableModels);

      if (selectedModel) effectiveModel = selectedModel;
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
