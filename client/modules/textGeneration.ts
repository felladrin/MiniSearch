import gptTokenizer from "gpt-tokenizer";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import prettyMilliseconds from "pretty-ms";
import { addLogEntry } from "./logEntries";
import {
  getQuery,
  getSettings,
  getTextGenerationState,
  listenToSettingsChanges,
  updateResponse,
  updateSearchPromise,
  updateSearchResults,
  updateSearchState,
  updateTextGenerationState,
} from "./pubSub";
import { search } from "./search";
import { getSystemPrompt } from "./systemPrompt";
import {
  ChatGenerationError,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import { isWebGPUAvailable } from "./webGpu";

export async function searchAndRespond() {
  if (getQuery() === "") return;

  document.title = getQuery();

  updateResponse("");

  updateSearchResults({ textResults: [], imageResults: [] });

  updateSearchPromise(startSearch(getQuery()));

  if (!getSettings().enableAiResponse) return;

  const responseGenerationStartTime = new Date().getTime();

  updateTextGenerationState("loadingModel");

  try {
    const settings = getSettings();
    if (settings.inferenceType === "openai") {
      const { generateTextWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );
      await generateTextWithOpenAi();
    } else if (settings.inferenceType === "internal") {
      const { generateTextWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      await generateTextWithInternalApi();
    } else {
      await canDownloadModels();
      updateTextGenerationState("loadingModel");

      if (isWebGPUAvailable && settings.enableWebGpu) {
        const { generateTextWithWebLlm } = await import(
          "./textGenerationWithWebLlm"
        );
        await generateTextWithWebLlm();
      } else {
        const { generateTextWithWllama } = await import(
          "./textGenerationWithWllama"
        );
        await generateTextWithWllama();
      }
    }

    updateTextGenerationState("completed");
  } catch (error) {
    if (getTextGenerationState() !== "interrupted") {
      addLogEntry(`Error generating text: ${error}`);
      updateTextGenerationState("failed");
    }
  }

  addLogEntry(
    `Response generation took ${prettyMilliseconds(
      new Date().getTime() - responseGenerationStartTime,
      { verbose: true },
    )}`,
  );
}

export async function generateChatResponse(
  newMessages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const settings = getSettings();
  let response = "";

  try {
    const allMessages: ChatMessage[] = [
      {
        role: "user",
        content: getSystemPrompt(getFormattedSearchResults(true)),
      },
      { role: "assistant", content: "Ok!" },
      ...newMessages,
    ];

    const lastMessagesReversed: ChatMessage[] = [];

    let totalTokens = 0;

    for (const message of allMessages.reverse()) {
      const newTotalTokens =
        totalTokens + gptTokenizer.encode(message.content).length;

      if (newTotalTokens > 1280) break;

      totalTokens = newTotalTokens;
      lastMessagesReversed.push(message);
    }

    const lastMessages = lastMessagesReversed.reverse();

    if (settings.inferenceType === "openai") {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );
      response = await generateChatWithOpenAi(lastMessages, onUpdate);
    } else if (settings.inferenceType === "internal") {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      response = await generateChatWithInternalApi(lastMessages, onUpdate);
    } else {
      if (isWebGPUAvailable && settings.enableWebGpu) {
        const { generateChatWithWebLlm } = await import(
          "./textGenerationWithWebLlm"
        );
        response = await generateChatWithWebLlm(lastMessages, onUpdate);
      } else {
        const { generateChatWithWllama } = await import(
          "./textGenerationWithWllama"
        );
        response = await generateChatWithWllama(lastMessages, onUpdate);
      }
    }
  } catch (error) {
    if (error instanceof ChatGenerationError) {
      addLogEntry(`Chat generation interrupted: ${error.message}`);
    } else {
      addLogEntry(`Error generating chat response: ${error}`);
    }
    throw error;
  }

  return response;
}

async function getKeywords(text: string, limit?: number) {
  return (await import("keyword-extractor")).default
    .extract(text, { language: "english" })
    .slice(0, limit);
}

async function startSearch(query: string) {
  updateSearchState("running");

  const searchResultsLimit = 30;

  let searchResults = await search(
    query.length > 2000 ? (await getKeywords(query, 20)).join(" ") : query,
    searchResultsLimit,
  );

  if (searchResults.textResults.length === 0) {
    const queryKeywords = await getKeywords(query, 10);

    searchResults = await search(queryKeywords.join(" "), searchResultsLimit);
  }

  updateSearchState(
    searchResults.textResults.length === 0 ? "failed" : "completed",
  );

  updateSearchResults(searchResults);

  return searchResults;
}

function canDownloadModels(): Promise<void> {
  return new Promise((resolve) => {
    if (getSettings().allowAiModelDownload) {
      resolve();
    } else {
      updateTextGenerationState("awaitingModelDownloadAllowance");
      listenToSettingsChanges((settings) => {
        if (settings.allowAiModelDownload) {
          resolve();
        }
      });
    }
  });
}
