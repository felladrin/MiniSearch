import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
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

interface HordeResponse {
  id: string;
  kudos: number;
}

interface HordeStatusResponse {
  generations?: { text: string; model: string }[];
  done?: boolean;
  faulted?: boolean;
  is_possible?: boolean;
}

interface HordeModelInfo {
  performance: number;
  queued: number;
  jobs: number;
  eta: number;
  type: string;
  name: string;
  count: number;
}

interface HordeUserInfo {
  username: string;
  kudos: number;
}

const aiHordeApiBaseUrl = "https://aihorde.net/api/v2";
const aiHordeClientAgent = `${appName}:${appVersion}:${appRepository}`;
const userMarker = "**USER**:";
const assistantMarker = "**ASSISTANT**:";

export const aiHordeDefaultApiKey = "0000000000";

async function startGeneration(messages: ChatMessage[], signal?: AbortSignal) {
  const settings = getSettings();
  const aiHordeApiKey = settings.hordeApiKey || aiHordeDefaultApiKey;
  const aiHordeMaxResponseLengthInTokens =
    aiHordeApiKey === aiHordeDefaultApiKey ? 512 : 1024;
  const response = await fetch(`${aiHordeApiBaseUrl}/generate/text/async`, {
    method: "POST",
    signal,
    headers: {
      apikey: aiHordeApiKey,
      "client-agent": aiHordeClientAgent,
      "content-type": "application/json",
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
        top_k: 30,
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
  let lastText = "";

  try {
    let status: HordeStatusResponse;

    do {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }

      const response = await fetch(
        `${aiHordeApiBaseUrl}/generate/text/status/${generationId}`,
        {
          method: "GET",
          signal,
          headers: {
            "client-agent": aiHordeClientAgent,
            "content-type": "application/json",
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
  try {
    await fetch(`${aiHordeApiBaseUrl}/generate/text/status/${generationId}`, {
      method: "DELETE",
      headers: {
        "client-agent": aiHordeClientAgent,
        "content-type": "application/json",
      },
    });
  } catch (error) {
    addLogEntry(`Failed to cancel generation ${generationId}: ${error}`);
  }
}

export async function fetchHordeModels(): Promise<HordeModelInfo[]> {
  const response = await fetch(
    `${aiHordeApiBaseUrl}/status/models?type=text&model_state=all`,
    {
      method: "GET",
      headers: {
        "client-agent": aiHordeClientAgent,
        accept: "application/json",
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
  const response = await fetch(`${aiHordeApiBaseUrl}/find_user`, {
    headers: {
      apikey: apiKey,
      "Client-Agent": aiHordeClientAgent,
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
    streamTextInChunks(text, updateResponse);
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

    const raceState = { winnerId: null as string | null };
    const statusPromises = generations.map((generation) =>
      handleGenerationStatus(
        generation.id,
        (text: string) => {
          if (raceState.winnerId === null) {
            raceState.winnerId = generation.id;
          }
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
          } catch {}
          try {
            await cancelGeneration(generation.id);
          } catch {}
        }
      }),
    );

    return winner.result;
  } catch (error) {
    controllers.forEach((controller) => {
      try {
        controller.abort();
      } catch {}
    });
    throw error;
  }
}

function formatPrompt(messages: ChatMessage[]): string {
  return `${messages
    .map((msg) => `**${msg.role?.toUpperCase()}**:\n${msg.content}`)
    .join("\n\n")}\n\n${assistantMarker}\n`;
}

/**
 * Streams text in small chunks with a delay between each chunk for a smooth reading experience.
 * @param text The text to stream
 * @param updateCallback Function to call with each chunk of text
 * @param chunkSize Number of words per chunk (default: 3)
 * @param delayMs Delay between chunks in milliseconds (default: 50)
 */
function streamTextInChunks(
  text: string,
  updateCallback: (text: string) => void,
  chunkSize = 3,
  delayMs = 60,
): void {
  const words = text.split(" ");
  let accumulatedText = "";
  let i = 0;

  const intervalId = setInterval(() => {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    accumulatedText += `${chunk} `;
    updateCallback(accumulatedText.trim());
    i += chunkSize;
    if (i >= words.length) {
      clearInterval(intervalId);
    }
  }, delayMs);
}
