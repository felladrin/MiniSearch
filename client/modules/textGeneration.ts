import { isWebGPUAvailable } from "./webGpu";
import {
  updateSearchResults,
  updateResponse,
  getSearchResults,
  getQuery,
  updateSearchPromise,
  getSearchPromise,
  updateTextGenerationState,
  updateSearchState,
  updateModelLoadingProgress,
  getTextGenerationState,
  getSettings,
  listenToSettingsChanges,
} from "./pubSub";
import { search } from "./search";
import { addLogEntry } from "./logEntries";
import { getSystemPrompt } from "./systemPrompt";
import prettyMilliseconds from "pretty-ms";
import { getOpenAiClient } from "./openai";
import { getSearchTokenHash } from "./searchTokenHash";
import {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.mjs";
import gptTokenizer from "gpt-tokenizer";
import { ChatOptions } from "@mlc-ai/web-llm";

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
      await generateTextWithOpenAI();
    } else if (settings.inferenceType === "internal") {
      await generateTextWithInternalApi();
    } else {
      await canDownloadModels();
      updateTextGenerationState("loadingModel");
      try {
        if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

        if (!settings.enableWebGpu) throw Error("WebGPU is disabled.");

        await generateTextWithWebLlm();
      } catch (error) {
        addLogEntry(`Skipping text generation with WebLLM: ${error}`);
        addLogEntry(`Starting text generation with Wllama`);
        await generateTextWithWllama();
      }
    }

    if (getTextGenerationState() !== "interrupted") {
      updateTextGenerationState("completed");
    }
  } catch (error) {
    addLogEntry(`Error generating text: ${error}`);
    updateTextGenerationState("failed");
  }

  addLogEntry(
    `Response generation took ${prettyMilliseconds(
      new Date().getTime() - responseGenerationStartTime,
      { verbose: true },
    )}`,
  );
}

async function generateTextWithOpenAI() {
  const settings = getSettings();
  const openai = getOpenAiClient({
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
  });

  await canStartResponding();

  updateTextGenerationState("preparingToGenerate");

  const completion = await openai.chat.completions.create({
    model: settings.openAiApiModel,
    messages: [
      {
        role: "user",
        content: getSystemPrompt(getFormattedSearchResults(true)),
      },
      { role: "assistant", content: "Ok!" },
      { role: "user", content: getQuery() },
    ],
    temperature: 0.6,
    max_tokens: 2048,
    stream: true,
  });

  let streamedMessage = "";

  for await (const chunk of completion) {
    const deltaContent = chunk.choices[0].delta.content;

    if (deltaContent) streamedMessage += deltaContent;

    if (getTextGenerationState() === "interrupted") {
      completion.controller.abort();
    } else if (getTextGenerationState() !== "generating") {
      updateTextGenerationState("generating");
    }

    updateResponseRateLimited(streamedMessage);
  }

  updateResponse(streamedMessage);
}

async function generateTextWithInternalApi() {
  await canStartResponding();

  updateTextGenerationState("preparingToGenerate");

  const inferenceUrl = new URL("/inference", self.location.origin);

  const tokenPrefix = "Bearer ";

  const token = await getSearchTokenHash();

  const response = await fetch(inferenceUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${tokenPrefix}${token}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: getSystemPrompt(getFormattedSearchResults(true)),
        },
        { role: "assistant", content: "Ok!" },
        { role: "user", content: getQuery() },
      ],
      temperature: 0.6,
      max_tokens: 2048,
      stream: true,
    } as ChatCompletionCreateParamsStreaming),
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
      if (deltaContent) streamedMessage += deltaContent;

      if (getTextGenerationState() === "interrupted") {
        reader.cancel();
      } else if (getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      updateResponseRateLimited(streamedMessage);
    }
  }

  updateResponse(streamedMessage);
}

async function generateTextWithWebLlm() {
  const { CreateWebWorkerMLCEngine, CreateMLCEngine, hasModelInCache } =
    await import("@mlc-ai/web-llm");

  type InitProgressCallback = import("@mlc-ai/web-llm").InitProgressCallback;
  type MLCEngineConfig = import("@mlc-ai/web-llm").MLCEngineConfig;
  type ChatOptions = import("@mlc-ai/web-llm").ChatOptions;

  const selectedModelId = getSettings().webLlmModelId;

  addLogEntry(`Selected WebLLM model: ${selectedModelId}`);

  const isModelCached = await hasModelInCache(selectedModelId);

  let initProgressCallback: InitProgressCallback | undefined;

  if (isModelCached) {
    updateTextGenerationState("preparingToGenerate");
  } else {
    initProgressCallback = (report) => {
      updateModelLoadingProgress(Math.round(report.progress * 100));
    };
  }

  const engineConfig: MLCEngineConfig = {
    initProgressCallback,
    logLevel: "SILENT",
  };

  const chatOptions: ChatOptions = {
    temperature: 0.6,
    repetition_penalty: 1.176,
  };

  const engine = Worker
    ? await CreateWebWorkerMLCEngine(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
        selectedModelId,
        engineConfig,
        chatOptions,
      )
    : await CreateMLCEngine(selectedModelId, engineConfig, chatOptions);

  if (getSettings().enableAiResponse) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [
        {
          role: "user",
          content: getSystemPrompt(getFormattedSearchResults(true)),
        },
        { role: "assistant", content: "Ok!" },
        { role: "user", content: getQuery() },
      ],
    });

    let streamedMessage = "";

    for await (const chunk of completion) {
      const deltaContent = chunk.choices[0].delta.content;

      if (deltaContent) streamedMessage += deltaContent;

      if (getTextGenerationState() === "interrupted") {
        await engine.interruptGenerate();
      } else if (getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      updateResponseRateLimited(streamedMessage);
    }

    updateResponse(streamedMessage);
  }

  addLogEntry(
    `WebLLM finished generating the response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();
}

async function generateTextWithWllama() {
  const { initializeWllama, wllamaModels } = await import("./wllama");

  let loadingPercentage = 0;

  const model = wllamaModels[getSettings().wllamaModelId];

  const wllama = await initializeWllama(model.url, {
    wllama: {
      suppressNativeLog: true,
    },
    model: {
      n_threads: getSettings().cpuThreads,
      n_ctx: model.contextSize,
      cache_type_k: model.cacheType,
      embeddings: false,
      allowOffline: true,
      progressCallback: ({ loaded, total }) => {
        const progressPercentage = Math.round((loaded / total) * 100);

        if (loadingPercentage !== progressPercentage) {
          loadingPercentage = progressPercentage;
          updateModelLoadingProgress(progressPercentage);
        }
      },
    },
  });

  if (getSettings().enableAiResponse) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    const prompt = await model.buildPrompt(
      wllama,
      getQuery(),
      getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
    );

    let streamedMessage = "";

    await wllama.createCompletion(prompt, {
      stopTokens: model.stopTokens,
      sampling: model.sampling,
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        if (getTextGenerationState() === "interrupted") {
          abortSignal();
        } else if (getTextGenerationState() !== "generating") {
          updateTextGenerationState("generating");
        }

        if (model.stopStrings) {
          for (const stopString of model.stopStrings) {
            if (
              currentText.slice(-(stopString.length * 2)).includes(stopString)
            ) {
              abortSignal();
              currentText = currentText.slice(0, -stopString.length);
              break;
            }
          }
        }

        streamedMessage = currentText;

        updateResponseRateLimited(streamedMessage);
      },
    });

    updateResponse(streamedMessage);
  }

  await wllama.exit();
}

function getFormattedSearchResults(shouldIncludeUrl: boolean) {
  const searchResults = getSearchResults().textResults.slice(
    0,
    getSettings().searchResultsToConsider,
  );

  if (searchResults.length === 0) return "None.";

  if (shouldIncludeUrl) {
    return searchResults
      .map(
        ([title, snippet, url], index) =>
          `${index + 1}. [${title}](${url}) | ${snippet}`,
      )
      .join("\n");
  }

  return searchResults
    .map(([title, snippet]) => `- ${title} | ${snippet}`)
    .join("\n");
}

async function getKeywords(text: string, limit?: number) {
  return (await import("keyword-extractor")).default
    .extract(text, { language: "english" })
    .slice(0, limit);
}

async function startSearch(query: string) {
  updateSearchState("running");

  let searchResults = await search(
    query.length > 2000 ? (await getKeywords(query, 20)).join(" ") : query,
    30,
  );

  if (searchResults.textResults.length === 0) {
    const queryKeywords = await getKeywords(query, 10);

    searchResults = await search(queryKeywords.join(" "), 30);
  }

  updateSearchState(
    searchResults.textResults.length === 0 ? "failed" : "completed",
  );

  updateSearchResults(searchResults);

  return searchResults;
}

async function canStartResponding() {
  if (getSettings().searchResultsToConsider > 0) {
    updateTextGenerationState("awaitingSearchResults");
    await getSearchPromise();
  }
}

function updateResponseRateLimited(text: string) {
  const currentTime = Date.now();

  if (
    currentTime - updateResponseRateLimited.lastUpdateTime >=
    updateResponseRateLimited.updateInterval
  ) {
    updateResponse(text);
    updateResponseRateLimited.lastUpdateTime = currentTime;
  }
}
updateResponseRateLimited.lastUpdateTime = 0;
updateResponseRateLimited.updateInterval = 1000 / 12;

class ChatGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGenerationError";
  }
}

async function generateChatWithOpenAI(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const settings = getSettings();
  const openai = getOpenAiClient({
    baseURL: settings.openAiApiBaseUrl,
    apiKey: settings.openAiApiKey,
  });
  const completion = await openai.chat.completions.create({
    model: settings.openAiApiModel,
    messages: messages as ChatCompletionMessageParam[],
    temperature: 0.6,
    max_tokens: 2048,
    stream: true,
  });

  let streamedMessage = "";

  for await (const chunk of completion) {
    const deltaContent = chunk.choices[0].delta.content;

    if (deltaContent) {
      streamedMessage += deltaContent;
      onUpdate(streamedMessage);
    }

    if (getTextGenerationState() === "interrupted") {
      completion.controller.abort();
      throw new ChatGenerationError("Chat generation interrupted");
    }
  }

  return streamedMessage;
}

async function generateChatWithInternalApi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const inferenceUrl = new URL("/inference", self.location.origin);
  const tokenPrefix = "Bearer ";
  const token = await getSearchTokenHash();

  const response = await fetch(inferenceUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${tokenPrefix}${token}`,
    },
    body: JSON.stringify({
      messages,
      temperature: 0.6,
      max_tokens: 2048,
      stream: true,
    } as ChatCompletionCreateParamsStreaming),
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
        onUpdate(streamedMessage);
      }

      if (getTextGenerationState() === "interrupted") {
        reader.cancel();
        throw new ChatGenerationError("Chat generation interrupted");
      }
    }
  }

  return streamedMessage;
}

async function generateChatWithWebLlm(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const { CreateWebWorkerMLCEngine, CreateMLCEngine } = await import(
    "@mlc-ai/web-llm"
  );

  type MLCEngineConfig = import("@mlc-ai/web-llm").MLCEngineConfig;
  type ChatCompletionMessageParam =
    import("@mlc-ai/web-llm").ChatCompletionMessageParam;

  const selectedModelId = getSettings().webLlmModelId;

  addLogEntry(`Selected WebLLM model for chat: ${selectedModelId}`);

  const engineConfig: MLCEngineConfig = {
    logLevel: "SILENT",
  };

  const chatOptions: ChatOptions = {
    temperature: 0.6,
    repetition_penalty: 1.176,
  };

  const engine = Worker
    ? await CreateWebWorkerMLCEngine(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
        selectedModelId,
        engineConfig,
        chatOptions,
      )
    : await CreateMLCEngine(selectedModelId, engineConfig, chatOptions);

  const completion = await engine.chat.completions.create({
    stream: true,
    messages: messages as ChatCompletionMessageParam[],
  });

  let streamedMessage = "";

  for await (const chunk of completion) {
    const deltaContent = chunk.choices[0].delta.content;

    if (deltaContent) {
      streamedMessage += deltaContent;
      onUpdate(streamedMessage);
    }

    if (getTextGenerationState() === "interrupted") {
      await engine.interruptGenerate();
      throw new ChatGenerationError("Chat generation interrupted");
    }
  }

  addLogEntry(
    `WebLLM finished generating the chat response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();

  return streamedMessage;
}

async function generateChatWithWllama(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const { initializeWllama, wllamaModels } = await import("./wllama");

  const model = wllamaModels[getSettings().wllamaModelId];

  const wllama = await initializeWllama(model.url, {
    wllama: {
      suppressNativeLog: true,
    },
    model: {
      n_threads: getSettings().cpuThreads,
      n_ctx: model.contextSize,
      cache_type_k: model.cacheType,
      embeddings: false,
      allowOffline: true,
    },
  });

  const prompt = await model.buildPrompt(
    wllama,
    messages[messages.length - 1].content,
    getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
  );

  let streamedMessage = "";

  await wllama.createCompletion(prompt, {
    stopTokens: model.stopTokens,
    sampling: model.sampling,
    onNewToken: (_token, _piece, currentText, { abortSignal }) => {
      if (getTextGenerationState() === "interrupted") {
        abortSignal();
        throw new ChatGenerationError("Chat generation interrupted");
      }

      if (model.stopStrings) {
        for (const stopString of model.stopStrings) {
          if (
            currentText.slice(-(stopString.length * 2)).includes(stopString)
          ) {
            abortSignal();
            currentText = currentText.slice(0, -stopString.length);
            break;
          }
        }
      }

      streamedMessage = currentText;
      onUpdate(streamedMessage);
    },
  });

  await wllama.exit();

  return streamedMessage;
}

export async function generateChatResponse(
  newMessages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  const settings = getSettings();
  let response = "";

  try {
    const allMessages = [
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
      response = await generateChatWithOpenAI(lastMessages, onUpdate);
    } else if (settings.inferenceType === "internal") {
      response = await generateChatWithInternalApi(lastMessages, onUpdate);
    } else {
      if (isWebGPUAvailable && settings.enableWebGpu) {
        response = await generateChatWithWebLlm(lastMessages, onUpdate);
      } else {
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

export interface ChatMessage {
  role: "user" | "assistant" | string;
  content: string;
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
