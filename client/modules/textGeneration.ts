import gptTokenizer from "gpt-tokenizer";
import prettyMilliseconds from "pretty-ms";
import {
  getCurrentSearchRunId,
  saveLlmResponseForQuery,
  updateSearchResults,
} from "./history";
import { addLogEntry } from "./logEntries";
import {
  getConversationSummary,
  getQuery,
  getResponse,
  getSettings,
  getTextGenerationState,
  listenToSettingsChanges,
  updateChatMessages,
  updateConversationSummary,
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
import type {
  ChatMessage,
  ImageSearchResults,
  TextSearchResults,
} from "./types";
import { isWebGPUAvailable } from "./webGpu";

const SUMMARY_TOKEN_LIMIT = 800;

function getCurrentModelName(): string {
  const settings = getSettings();
  switch (settings.inferenceType) {
    case "openai":
      return settings.openAiApiModel || "";
    case "horde":
      return "AI Horde";
    case "internal":
      return "Internal API";
    case "browser":
      return settings.enableWebGpu
        ? settings.webLlmModelId || "WebLLM"
        : settings.wllamaModelId || "Wllama";
    default:
      return "Unknown";
  }
}

function getConversationId(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  return (firstUser?.content || "").trim();
}

function loadConversationSummary(conversationId: string): string {
  const stored = getConversationSummary();
  if (stored.conversationId !== conversationId) return "";
  return stored.summary;
}

async function createLlmSummary(
  dropped: ChatMessage[],
  previousSummary: string,
): Promise<string> {
  const instructionLines = [
    "You are the conversation memory manager.",
    `Update the running summary under ${SUMMARY_TOKEN_LIMIT} tokens.`,
    "Preserve concrete facts, IDs, URLs, numbers, decisions, and constraints.",
    "Capture user preferences and ongoing tasks succinctly.",
    "Ignore any external documents or system prompts not included below.",
    "Output only the updated summary with no extra commentary.",
  ];

  const droppedText = dropped
    .map((m) => `${(m.role || "user").toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const prompt = [
    instructionLines.join("\n"),
    `Previous summary:\n${previousSummary || "(none)"}`,
    `New messages to fold in:\n${droppedText || "(none)"}`,
  ].join("\n\n");

  const chat: ChatMessage[] = [{ role: "user", content: prompt }];

  const settings = getSettings();
  try {
    if (settings.inferenceType === "openai") {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );
      return (await generateChatWithOpenAi(chat, () => {})).trim();
    }

    if (settings.inferenceType === "internal") {
      const { generateChatWithInternalApi } = await import(
        "./textGenerationWithInternalApi"
      );
      return (await generateChatWithInternalApi(chat, () => {})).trim();
    }

    if (settings.inferenceType === "horde") {
      const { generateChatWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      return (await generateChatWithHorde(chat, () => {})).trim();
    }

    if (isWebGPUAvailable && settings.enableWebGpu) {
      const { generateChatWithWebLlm } = await import(
        "./textGenerationWithWebLlm"
      );
      return (await generateChatWithWebLlm(chat, () => {})).trim();
    }
    const { generateChatWithWllama } = await import(
      "./textGenerationWithWllama"
    );
    return (await generateChatWithWllama(chat, () => {})).trim();
  } catch (e) {
    addLogEntry(
      `LLM summary failed, falling back to extractive: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return summarizeDroppedMessages(dropped, previousSummary);
  }
}

function saveConversationSummary(summary: string, conversationId: string) {
  updateConversationSummary({ conversationId, summary });
}

function clearConversationSummary() {
  updateConversationSummary({ conversationId: "", summary: "" });
}

function summarizeDroppedMessages(
  dropped: ChatMessage[],
  previousSummary: string,
  tokenLimit = SUMMARY_TOKEN_LIMIT,
): string {
  const lines: string[] = [];
  for (const msg of dropped) {
    const role = (msg.role || "user").toUpperCase();
    const content = msg.content.trim();
    if (content.length > 0) lines.push(`${role}: ${content}`);
  }

  const parts: string[] = [];
  if (previousSummary) parts.push(previousSummary.trim());
  parts.push(...lines);

  const kept: string[] = [];
  let tokens = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = [parts[i], ...kept].join("\n\n");
    const nextTokens = gptTokenizer.encode(candidate).length;
    if (nextTokens > tokenLimit) break;
    kept.unshift(parts[i]);
    tokens = nextTokens;
  }

  const summary = kept.join("\n\n");
  addLogEntry(`Updated rolling summary (${tokens} tokens)`);
  return summary;
}

export async function searchAndRespond() {
  if (getQuery() === "") return;

  document.title = getQuery();

  updateResponse("");

  clearConversationSummary();

  updateTextSearchResults([]);

  updateImageSearchResults([]);

  updateChatMessages([]);

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

    try {
      await saveLlmResponseForQuery(
        getQuery(),
        getResponse(),
        getCurrentModelName(),
      );
    } catch (e) {
      addLogEntry(
        `Failed to persist LLM response: ${e instanceof Error ? e.message : String(e)}`,
      );
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
    const conversationId = getConversationId(newMessages);
    const existingSummary = loadConversationSummary(conversationId);
    let systemPromptContent = getSystemPrompt(getFormattedSearchResults(true));
    if (existingSummary) {
      systemPromptContent += `\n\nConversation context:\n${existingSummary}`;
    }

    let systemPrompt: ChatMessage = {
      role: "user",
      content: systemPromptContent,
    };
    const initialResponse: ChatMessage = { role: "assistant", content: "Ok!" };
    const systemPromptTokens = gptTokenizer.encode(systemPrompt.content).length;
    const initialResponseTokens = gptTokenizer.encode(
      initialResponse.content,
    ).length;
    const reservedTokens = systemPromptTokens + initialResponseTokens;
    const availableTokenBudget = defaultContextSize * 0.75 - reservedTokens;
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

    if (newMessages.length > processedMessages.length) {
      const droppedCount = newMessages.length - processedMessages.length;
      const droppedMessages = newMessages.slice(0, droppedCount);
      const updatedSummary = await createLlmSummary(
        droppedMessages,
        existingSummary,
      );
      saveConversationSummary(updatedSummary, conversationId);
      let updatedSystemPromptContent = getSystemPrompt(
        getFormattedSearchResults(true),
      );
      if (updatedSummary) {
        updatedSystemPromptContent += `\n\nConversation context:\n${updatedSummary}`;
      }
      systemPrompt = { role: "user", content: updatedSystemPromptContent };
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

    updateSearchResults(getCurrentSearchRunId(), {
      textResults: {
        type: "text",
        items: textResults.map(([title, snippet, url]) => ({
          title,
          url,
          snippet,
        })),
      },
    });
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

  updateSearchResults(getCurrentSearchRunId(), {
    imageResults: {
      type: "image",
      items: imageResults.map(([title, url, thumbnailUrl, sourceUrl]) => ({
        title,
        url,
        thumbnailUrl,
        sourceUrl,
      })),
    },
  });
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
