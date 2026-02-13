import { appName, appRepository, appVersion } from "./appInfo";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { sleep } from "./sleep";
import {
  ChatGenerationError,
  canStartResponding,
  defaultContextSize,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

/**
 * Response from AI Horde API
 */
interface HordeResponse {
  /** Request ID */
  id: string;
  /** Kudos cost for the request */
  kudos: number;
}

/**
 * Status response from AI Horde API
 */
interface HordeStatusResponse {
  /** Generated text results */
  generations?: { text: string; model: string }[];
  /** Whether generation is complete */
  done?: boolean;
  /** Whether generation failed */
  faulted?: boolean;
  /** Whether generation is still possible */
  is_possible?: boolean;
}

/**
 * Model information from AI Horde
 */
interface HordeModelInfo {
  /** Model performance rating */
  performance: number;
  /** Number of queued requests */
  queued: number;
  /** Number of active jobs */
  jobs: number;
  /** Estimated time to completion */
  eta: number;
  /** Model type */
  type: string;
  /** Model name */
  name: string;
  /** Number of available instances */
  count: number;
}

/**
 * User information from AI Horde
 */
interface HordeUserInfo {
  /** Username */
  username: string;
  /** Available kudos */
  kudos: number;
}

/**
 * Base URL for the public AI Horde API (browser-safe)
 */
const AI_HORDE_BASE_URL = "https://aihorde.net/api/v2";

/**
 * Client agent identifier for AI Horde API
 */
const aiHordeClientAgent = `${appName}:${appVersion}:${appRepository}`;
/**
 * Marker for user messages in chat history */
const userMarker = "**USER**:";
/**
 * Marker for assistant messages in chat history */
const assistantMarker = "**ASSISTANT**:";

// HTTP header constants for consistency
const HTTP_HEADERS = {
  CONTENT_TYPE: "Content-Type",
  CLIENT_AGENT: "Client-Agent",
  ACCEPT: "accept",
  API_KEY: "apikey",
} as const;

function buildHordeUrl(path: string) {
  return `${AI_HORDE_BASE_URL}${path}`;
}

export const aiHordeDefaultApiKey = "0000000000";

function getEffectiveHordeApiKey(
  settings: ReturnType<typeof getSettings> = getSettings(),
) {
  return settings.hordeApiKey || aiHordeDefaultApiKey;
}

async function startGeneration(messages: ChatMessage[], signal?: AbortSignal) {
  const settings = getSettings();
  const aiHordeApiKey = getEffectiveHordeApiKey(settings);
  const aiHordeMaxResponseLengthInTokens =
    aiHordeApiKey === aiHordeDefaultApiKey ? 512 : 1024;
  const response = await fetch(buildHordeUrl("/generate/text/async"), {
    method: "POST",
    signal,
    headers: {
      [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
      [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
      [HTTP_HEADERS.API_KEY]: aiHordeApiKey,
    },
    body: JSON.stringify({
      prompt: formatPrompt(messages),
      params: {
        max_context_length: defaultContextSize,
        max_length: aiHordeMaxResponseLengthInTokens,
        singleline: false,
        temperature: settings.inferenceTemperature,
        top_p: settings.inferenceTopP,
        min_p: settings.minP,
        top_k: 0,
        rep_pen: 1,
        stop_sequence: [userMarker, assistantMarker],
        validated_backends: false,
      },
      models: settings.hordeModel ? [settings.hordeModel] : undefined,
    }),
  });

  const data = (await response.json()) as HordeResponse;
  if (!data.id) {
    throw new Error("Failed to start generation");
  }

  return data;
}

async function handleGenerationStatus(
  generationId: string,
  onUpdate: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const aiHordeApiKey = getEffectiveHordeApiKey();
  let lastText = "";

  try {
    let status: HordeStatusResponse;

    do {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }

      const response = await fetch(
        buildHordeUrl(`/generate/text/status/${generationId}`),
        {
          method: "GET",
          signal,
          headers: {
            [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
            [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
            [HTTP_HEADERS.API_KEY]: aiHordeApiKey,
          },
        },
      );

      status = await response.json();

      if (
        status.generations?.[0]?.text &&
        status.generations[0].text !== lastText
      ) {
        lastText = status.generations[0].text;
        if (status.generations[0].model) {
          addLogEntry(
            `AI Horde completed the generation using the model "${status.generations[0].model}"`,
          );
        }
        onUpdate(lastText.split(userMarker)[0]);
      }

      if (!status.done && !status.faulted && status.is_possible) {
        await sleep(1000);
      }

      if (getTextGenerationState() === "interrupted") {
        throw new ChatGenerationError("Generation interrupted");
      }
    } while (
      !status.done &&
      !status.faulted &&
      status.is_possible &&
      !signal?.aborted
    );

    if (signal?.aborted) {
      throw new Error("Request was aborted");
    }

    if (status.faulted) {
      throw new ChatGenerationError("Generation failed");
    }

    if (!status.is_possible) {
      throw new ChatGenerationError(
        "Generation not possible with the selected model",
      );
    }

    const generatedText = status.generations?.[0].text;

    if (!generatedText) {
      throw new Error("No text generated");
    }

    return generatedText.split(userMarker)[0];
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("Request was aborted");
    }
    if (error instanceof ChatGenerationError) {
      throw error;
    }
    throw new Error(`Error while checking generation status: ${error}`);
  }
}

async function cancelGeneration(generationId: string): Promise<void> {
  const aiHordeApiKey = getEffectiveHordeApiKey();
  try {
    const response = await fetch(
      buildHordeUrl(`/generate/text/status/${generationId}`),
      {
        method: "DELETE",
        headers: {
          [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
          [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
          [HTTP_HEADERS.API_KEY]: aiHordeApiKey,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Cancel request failed: ${response.status} ${response.statusText}`,
      );
    }

    addLogEntry(`Successfully cancelled generation ${generationId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    addLogEntry(`Failed to cancel generation ${generationId}: ${errorMessage}`);
    throw new Error(`Failed to cancel generation: ${errorMessage}`);
  }
}

export async function fetchHordeModels(): Promise<HordeModelInfo[]> {
  const response = await fetch(
    buildHordeUrl("/status/models?type=text&model_state=all"),
    {
      method: "GET",
      headers: {
        [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
        [HTTP_HEADERS.ACCEPT]: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch AI Horde models");
  }

  return response.json();
}

export async function fetchHordeUserInfo(
  apiKey: string,
): Promise<HordeUserInfo> {
  const response = await fetch(buildHordeUrl("/find_user"), {
    headers: {
      [HTTP_HEADERS.API_KEY]: apiKey,
      [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    username: data.username,
    kudos: data.kudos,
  };
}

export async function generateTextWithHorde() {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");
  const messages = getDefaultChatMessages(getFormattedSearchResults(true));
  await executeHordeGeneration(messages, (text) => {
    updateResponse(text);
  });
}

export async function generateChatWithHorde(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  return await executeHordeGeneration(messages, onUpdate);
}

async function executeHordeGeneration(
  messages: ChatMessage[],
  onUpdate: (text: string) => void,
): Promise<string> {
  const settings = getSettings();

  if (settings.hordeModel) {
    const generation = await startGeneration(messages);
    return await handleGenerationStatus(generation.id, onUpdate);
  }

  const controllers: AbortController[] = [
    new AbortController(),
    new AbortController(),
  ];
  try {
    const startPromises = controllers.map(async (ctrl) => {
      const generation = await startGeneration(messages, ctrl.signal);
      return { id: generation.id, ctrl };
    });

    const startResults = await Promise.allSettled(startPromises);
    const generations: Array<{ id: string; ctrl: AbortController }> =
      startResults
        .map((generationPromise) =>
          generationPromise.status === "fulfilled"
            ? generationPromise.value
            : null,
        )
        .filter(
          (generation): generation is { id: string; ctrl: AbortController } =>
            generation !== null,
        );

    if (generations.length === 0) {
      throw new Error("Failed to start any AI Horde generation");
    }

    const raceState = { winnerId: null as string | null, hasWinner: false };
    const statusPromises = generations.map((generation) =>
      handleGenerationStatus(
        generation.id,
        (text: string) => {
          // Atomic check and set to prevent race conditions
          if (!raceState.hasWinner) {
            raceState.winnerId = generation.id;
            raceState.hasWinner = true;
          }
          // Only update if this generation is the winner
          if (raceState.winnerId === generation.id) {
            onUpdate(text);
          }
        },
        generation.ctrl.signal,
      ).then((result: string) => ({ result, generationId: generation.id })),
    );

    const winner = await Promise.race(statusPromises);

    await Promise.all(
      generations.map(async (generation) => {
        if (generation.id !== winner.generationId) {
          try {
            generation.ctrl.abort();
          } catch (abortError) {
            addLogEntry(
              `Failed to abort generation ${generation.id}: ${abortError}`,
            );
          }
          try {
            await cancelGeneration(generation.id);
          } catch (cancelError) {
            addLogEntry(
              `Failed to cancel generation ${generation.id}: ${cancelError}`,
            );
          }
        }
      }),
    );

    return winner.result;
  } catch (error) {
    controllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (abortError) {
        addLogEntry(`Failed to abort controller: ${abortError}`);
      }
    });
    throw error;
  }
}

function formatPrompt(messages: ChatMessage[]): string {
  return `${messages
    .map((msg) => `**${msg.role?.toUpperCase()}**:\n${msg.content}`)
    .join("\n\n")}\n\n${assistantMarker}\n`;
}
