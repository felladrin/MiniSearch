import gptTokenizer from "gpt-tokenizer";
import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import prettyMilliseconds from "pretty-ms";
import { addLogEntry } from "./logEntries";
import {
  getQuery,
  getSettings,
  getTextGenerationState,
  listenToSettingsChanges,
  updateImageSearchResults,
  updateImageSearchState,
  updateLlmTextSearchResults,
  updateResponse,
  updateSearchPromise,
  updateTextGenerationState,
  updateTextSearchResults,
  updateTextSearchState,
} from "./pubSub";
import { searchImages, searchText } from "./search";
import { getSystemPrompt } from "./systemPrompt";
import {
  ChatGenerationError,
  defaultContextSize,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import type { ImageSearchResults, TextSearchResults } from "./types";
import { isWebGPUAvailable } from "./webGpu";

export async function searchAndRespond() {
  if (getQuery() === "") return;

  document.title = getQuery();

  updateResponse("");

  updateTextSearchResults([]);

  updateImageSearchResults([]);

  updateSearchPromise(startTextSearch(getQuery()));

  if (!getSettings().enableAiResponse) return;

  const responseGenerationStartTime = Date.now();

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
    } else if (settings.inferenceType === "horde") {
      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      await generateTextWithHorde();
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
      Date.now() - responseGenerationStartTime,
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
    const systemPrompt: ChatMessage = {
      role: "user",
      content: getSystemPrompt(getFormattedSearchResults(true)),
    };
    const initialResponse: ChatMessage = { role: "assistant", content: "Ok!" };
    const systemPromptTokens = gptTokenizer.encode(systemPrompt.content).length;
    const initialResponseTokens = gptTokenizer.encode(
      initialResponse.content,
    ).length;
    const reservedTokens = systemPromptTokens + initialResponseTokens;
    const availableTokenBudget = defaultContextSize * 0.85 - reservedTokens;
    const processedMessages: ChatMessage[] = [];
    const reversedMessages = [...newMessages].reverse();

    let currentTokenCount = 0;

    for (let i = 0; i < reversedMessages.length; i++) {
      const message = reversedMessages[i];
      const messageTokens = gptTokenizer.encode(message.content).length;

      if (currentTokenCount + messageTokens > availableTokenBudget) {
        break;
      }

      processedMessages.unshift(message);
      currentTokenCount += messageTokens;
    }

    if (processedMessages.length > 0) {
      const expectedFirstRole = "user";

      if (processedMessages[0].role !== expectedFirstRole) {
        processedMessages.shift();
      }
    }

    const lastMessages = [systemPrompt, initialResponse, ...processedMessages];

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
    } else if (settings.inferenceType === "horde") {
      const { generateChatWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      response = await generateChatWithHorde(lastMessages, onUpdate);
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

async function startTextSearch(query: string) {
  const results = {
    textResults: [] as TextSearchResults,
    imageResults: [] as ImageSearchResults,
  };

  const searchQuery =
    query.length > 2000 ? (await getKeywords(query, 20)).join(" ") : query;

  if (getSettings().enableImageSearch) {
    updateImageSearchState("running");
  }

  if (getSettings().enableTextSearch) {
    updateTextSearchState("running");

    let textResults = await searchText(
      searchQuery,
      getSettings().searchResultsLimit,
    );

    if (textResults.length === 0) {
      const queryKeywords = await getKeywords(query, 10);
      const keywordResults = await searchText(
        queryKeywords.join(" "),
        getSettings().searchResultsLimit,
      );
      textResults = keywordResults;
    }

    results.textResults = textResults;

    updateTextSearchState(
      results.textResults.length === 0 ? "failed" : "completed",
    );
    updateTextSearchResults(textResults);
    updateLlmTextSearchResults(
      textResults.slice(0, getSettings().searchResultsToConsider),
    );
  }

  if (getSettings().enableImageSearch) {
    startImageSearch(searchQuery, results);
  }

  return results;
}

async function startImageSearch(
  searchQuery: string,
  results: { textResults: TextSearchResults; imageResults: ImageSearchResults },
) {
  const imageResults = await searchImages(
    searchQuery,
    getSettings().searchResultsLimit,
  );
  results.imageResults = imageResults;
  updateImageSearchState(
    results.imageResults.length === 0 ? "failed" : "completed",
  );
  updateImageSearchResults(imageResults);
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
