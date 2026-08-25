import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "@shared/openaiModels";
import { streamText } from "ai";
import { addLogEntry } from "@/modules/logEntries";
import {
  getSettings,
  getTextGenerationState,
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

let currentAbortController: AbortController | null = null;

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface StreamOptions {
  messages: ChatMessage[];
  onUpdate: (text: string, reasoningContent?: string) => void;
}

interface StreamResult {
  text: string;
  reasoningContent?: string;
}

async function createOpenAiStream({
  messages,
  onUpdate,
}: StreamOptions): Promise<StreamResult> {
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

    currentAbortController = new AbortController();

    try {
      const result = streamText({
        model: openaiProvider.chatModel(effectiveModel),
        messages,
        maxOutputTokens: params.max_tokens,
        temperature: params.temperature,
        topP: params.top_p,
        abortSignal: currentAbortController.signal,
        maxRetries: 0,
      });

      let text = "";
      let reasoning = "";
      let streamError: unknown;

      for await (const part of result.stream) {
        if (getTextGenerationState() === "interrupted") {
          currentAbortController.abort();
          throw new Error("Chat generation interrupted");
        }

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
        getTextGenerationState() === "interrupted" ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new Error("Chat generation interrupted");
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
  const settings = getSettings();

  await createOpenAiStream({
    messages,
    onUpdate: (text, reasoningContent) => {
      if (
        getTextGenerationState() !== "generating" &&
        (text.length > 0 || (reasoningContent?.length ?? 0) > 0)
      ) {
        updateTextGenerationState("generating");
      }

      if (reasoningContent && reasoningContent.length > 0) {
        if (text && text.length > 0) {
          updateResponse(
            `${settings.reasoningStartMarker}${reasoningContent}${settings.reasoningEndMarker}\n\n${text}`,
          );
        } else {
          updateResponse(`${settings.reasoningStartMarker}${reasoningContent}`);
        }
      } else {
        updateResponse(text);
      }
    },
  });
}

export async function generateChatWithOpenAi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const settings = getSettings();
  const result = await createOpenAiStream({
    messages,
    onUpdate: (text, reasoningContent) => {
      if (reasoningContent && reasoningContent.length > 0) {
        if (text && text.length > 0) {
          onUpdate(
            `${settings.reasoningStartMarker}${reasoningContent}${settings.reasoningEndMarker}\n\n${text}`,
          );
        } else {
          onUpdate(`${settings.reasoningStartMarker}${reasoningContent}`);
        }
      } else {
        onUpdate(text);
      }
    },
  });

  if (result.reasoningContent && result.reasoningContent.length > 0) {
    return `${settings.reasoningStartMarker}${result.reasoningContent}${settings.reasoningEndMarker}\n\n${result.text}`;
  }

  return result.text;
}
