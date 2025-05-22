import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import {
  getQuery,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { getSearchTokenHash } from "./searchTokenHash";
import { getSystemPrompt } from "./systemPrompt";
import {
  ChatGenerationError,
  canStartResponding,
  getDefaultChatCompletionCreateParamsStreaming,
  getFormattedSearchResults,
} from "./textGenerationUtilities";

export async function generateTextWithInternalApi() {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: getSystemPrompt(getFormattedSearchResults(true)),
    },
    { role: "assistant", content: "Ok!" },
    { role: "user", content: getQuery() },
  ];

  const streamedMessage = await processStreamResponse(messages, (message) => {
    if (getTextGenerationState() === "interrupted") {
      throw new ChatGenerationError("Generation interrupted");
    }

    if (getTextGenerationState() !== "generating") {
      updateTextGenerationState("generating");
    }

    updateResponse(message);
  });

  updateResponse(streamedMessage);
}

export async function generateChatWithInternalApi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  return processStreamResponse(messages, (message) => {
    onUpdate(message);
    if (getTextGenerationState() === "interrupted") {
      throw new ChatGenerationError("Chat generation interrupted");
    }
  });
}

async function processStreamResponse(
  messages: ChatMessage[],
  onChunk: (message: string) => void,
): Promise<string> {
  const inferenceUrl = new URL("/inference", self.location.origin);
  const token = await getSearchTokenHash();
  inferenceUrl.searchParams.set("token", token);

  const response = await fetch(inferenceUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...getDefaultChatCompletionCreateParamsStreaming(),
      messages,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let streamedMessage = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");
    const parsedLines = lines
      .map((line) => line.replace(/^data: /, "").trim())
      .filter((line) => line !== "" && line !== "[DONE]")
      .map((line) => JSON.parse(line));

    for (const parsedLine of parsedLines) {
      const deltaContent = parsedLine.choices[0].delta.content;
      if (deltaContent) {
        streamedMessage += deltaContent;
        onChunk(streamedMessage);
      }
    }
  }

  return streamedMessage;
}
