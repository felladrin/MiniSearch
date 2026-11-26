import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "@shared/openaiModels";
import { streamText } from "ai";
import { addLogEntry } from "@/modules/logEntries";
import {
  getSettings,
  updateResponse,
  updateTextGenerationState,
} from "@/modules/pubSub";
import { sleep } from "@/modules/sleep";
import {
  canStartResponding,
  getDefaultChatCompletionCreateParamsStreaming,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "@/modules/textGenerationUtilities";
import type { ChatMessage } from "@/modules/types";

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface StreamOptions {
  messages: ChatMessage[];
  onUpdate: (text: string, reasoningContent?: string) => void;
  signal?: AbortSignal;
}

interface StreamResult {
  text: string;
  reasoningContent?: string;
}

/**
 * The text the response channel carries for a streamed answer: the reasoning
 * block wrapped in its markers, followed by the answer once it arrives.
 */
function composeResponseText(
  text: string,
  reasoningContent: string | undefined,
  settings: { reasoningStartMarker: string; reasoningEndMarker: string },
) {
  if (!reasoningContent) return text;

  const reasoning = `${settings.reasoningStartMarker}${reasoningContent}`;

  if (!text) return reasoning;

  return `${reasoning}${settings.reasoningEndMarker}\n\n${text}`;
}

async function createOpenAiStream({
  messages,
  onUpdate,
  signal,
}: StreamOptions): Promise<StreamResult> {
  const settings = getSettings();
  const openaiProvider = createOpenAICompatible({
    name: settings.openAiApiBaseUrl,
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
  });

  const params = await getDefaultChatCompletionCreateParamsStreaming(messages);

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

  const tryNextModel = async (): Promise<StreamResult> => {
    if (currentAttempt >= maxRetries) {
      throw new Error(
        `Failed to generate text after ${maxRetries} retries with different models`,
      );
    }

    if (effectiveModel) {
      attemptedModels.add(effectiveModel);
    }

    currentAttempt++;

    try {
      if (signal?.aborted) throw new Error("Chat generation interrupted");

      const result = streamText({
        model: openaiProvider.chatModel(effectiveModel),
        messages,
        maxOutputTokens: params.max_tokens,
        temperature: params.temperature,
        topP: params.top_p,
        abortSignal: signal,
        maxRetries: 0,
      });

      let text = "";
      let reasoning = "";
      let streamError: unknown;

      for await (const part of result.stream) {
        if (part.type === "reasoning-delta") {
          reasoning += part.text;
          onUpdate(text, reasoning);
        } else if (part.type === "text-delta") {
          text += part.text;
          onUpdate(text, reasoning);
        } else if (part.type === "error") {
          streamError = part.error;
        }
      }

      if (signal?.aborted) throw new Error("Chat generation interrupted");

      // A failing stream reports the problem as a part instead of rejecting,
      // and the SDK swallows whatever `onError` throws, so the retry decision
      // belongs here, once the stream is drained.
      if (streamError !== undefined) {
        if (text.length > 0 || reasoning.length > 0) {
          addLogEntry(
            `Model "${effectiveModel}" errored after streaming some content, keeping what arrived: ${describeError(streamError)}`,
          );
        } else {
          const nextModel =
            availableModels.length > 0 && currentAttempt < maxRetries
              ? selectRandomModel(availableModels, attemptedModels)
              : undefined;

          if (!nextModel) throw streamError;

          addLogEntry(
            `Model "${effectiveModel}" failed, retrying with "${nextModel}" (Attempt ${currentAttempt}/${maxRetries})`,
          );
          effectiveModel = nextModel;
          await sleep(100 * currentAttempt);
          return tryNextModel();
        }
      }

      return { text, reasoningContent: reasoning };
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new Error("Chat generation interrupted");
      }

      throw error;
    }
  };

  return tryNextModel();
}

export async function generateTextWithOpenAi(
  signal?: AbortSignal,
): Promise<string> {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");

  const messages = getDefaultChatMessages(
    await getFormattedSearchResults(true),
  );
  const settings = getSettings();

  let generating = false;

  const result = await createOpenAiStream({
    messages,
    signal,
    onUpdate: (text, reasoningContent) => {
      if (
        !generating &&
        (text.length > 0 || (reasoningContent?.length ?? 0) > 0)
      ) {
        generating = true;
        updateTextGenerationState("generating");
      }

      updateResponse(composeResponseText(text, reasoningContent, settings));
    },
  });

  return composeResponseText(result.text, result.reasoningContent, settings);
}

export async function generateChatWithOpenAi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
  signal?: AbortSignal,
) {
  const settings = getSettings();
  const result = await createOpenAiStream({
    messages,
    signal,
    onUpdate: (text, reasoningContent) => {
      onUpdate(composeResponseText(text, reasoningContent, settings));
    },
  });

  return composeResponseText(result.text, result.reasoningContent, settings);
}
