import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { repository } from "../../package.json";
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

const aiHordeApiBaseUrl = "https://aihorde.net/api/v2";
const aiHordeMaxResponseLengthInTokens = 512;
const clientAgent = repository.url.split("/").pop() ?? "";

async function startGeneration(messages: ChatMessage[]) {
  const response = await fetch(`${aiHordeApiBaseUrl}/generate/text/async`, {
    method: "POST",
    headers: {
      apikey: getSettings().hordeApiKey || "0000000000",
      "client-agent": clientAgent,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: formatPrompt(messages),
      params: {
        max_context_length: defaultContextSize,
        max_length: aiHordeMaxResponseLengthInTokens,
      },
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
            "client-agent": clientAgent,
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
        onUpdate(lastText.split("<|im_end|>")[0]);
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

    return generatedText.split("<|im_end|>")[0];
  } catch (error) {
    if (error instanceof ChatGenerationError) {
      throw error;
    }
    throw new Error(`Error while checking generation status: ${error}`);
  }
}

export async function generateTextWithHorde() {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");

  const messages = getDefaultChatMessages(getFormattedSearchResults(true));
  const generatedText = await executeHordeGeneration(messages, (text) => {
    updateResponse(text);
  });

  updateResponse(generatedText);
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
    .map((msg) => `<|im_start|>${msg.role}\n${msg.content}<|im_end|>`)
    .join("\n")}\n<|im_start|>assistant\n`;
}
