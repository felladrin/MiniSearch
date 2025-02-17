import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { appName, appRepository, appVersion } from "./appInfo";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
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

async function startGeneration(messages: ChatMessage[]) {
  const settings = getSettings();
  const aiHordeApiKey = settings.hordeApiKey || aiHordeDefaultApiKey;
  const aiHordeMaxResponseLengthInTokens =
    aiHordeApiKey === aiHordeDefaultApiKey ? 512 : 1024;
  const response = await fetch(`${aiHordeApiBaseUrl}/generate/text/async`, {
    method: "POST",
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
        min_p: 0.1,
        top_k: 0,
        typical: 0.2,
        rep_pen: 1.05,
        stop_sequence: [userMarker, assistantMarker],
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
): Promise<string> {
  let lastText = "";

  try {
    let status: HordeStatusResponse;

    do {
      const response = await fetch(
        `${aiHordeApiBaseUrl}/generate/text/status/${generationId}`,
        {
          method: "GET",
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

      if (!status.done && !status.faulted) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (getTextGenerationState() === "interrupted") {
        throw new ChatGenerationError("Generation interrupted");
      }
    } while (!status.done && !status.faulted);

    if (status.faulted) {
      throw new Error("Generation failed");
    }

    const generatedText = status.generations?.[0].text;
    if (!generatedText) {
      throw new Error("No text generated");
    }

    return generatedText.split(userMarker)[0];
  } catch (error) {
    if (error instanceof ChatGenerationError) {
      throw error;
    }
    throw new Error(`Error while checking generation status: ${error}`);
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
  const generation = await startGeneration(messages);
  return await handleGenerationStatus(generation.id, onUpdate);
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
