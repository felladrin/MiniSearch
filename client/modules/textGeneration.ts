import { isWebGPUAvailable } from "./webGpu";
import {
  updatePrompt,
  updateSearchResults,
  getDisableAiResponseSetting,
  getSummarizeLinksSetting,
  getUseLargerModelSetting,
  updateResponse,
  getSearchResults,
  updateUrlsDescriptions,
  getUrlsDescriptions,
} from "./pubSub";
import { SearchResults, search } from "./search";
import { query, debug, disableWorkers } from "./urlParams";
import toast from "react-hot-toast";
import { isRunningOnMobile } from "./mobileDetection";

const Worker = disableWorkers ? undefined : self.Worker;

const amountOfSearchResultsToUseOnPrompt = isRunningOnMobile ? 3 : 6;

export async function prepareTextGeneration() {
  if (query === null) return;

  document.title = query;

  updatePrompt(query);

  updateLoadingToast("Searching the web...");

  let searchResults = await search(query, 30);

  if (searchResults.length === 0) {
    const queryKeywords = (await import("keyword-extractor")).default.extract(
      query,
      {
        language: "english",
      },
    );

    searchResults = await search(queryKeywords.join(" "), 30);
  }

  if (searchResults.length === 0) {
    toast(
      "It looks like your current search did not return any results. Try refining your search by adding more keywords or rephrasing your query.",
      {
        position: "bottom-center",
        duration: 10000,
        icon: "💡",
      },
    );
  }

  updateSearchResults(searchResults);

  updateUrlsDescriptions(
    searchResults.reduce(
      (acc, [, snippet, url]) => ({ ...acc, [url]: snippet }),
      {},
    ),
  );

  if (getDisableAiResponseSetting() && !getSummarizeLinksSetting()) return;

  if (debug) console.time("Response Generation Time");

  if (!isRunningOnMobile) {
    updateLoadingToast("Loading AI model...");

    try {
      updateSearchResults(
        await rankSearchResultsWithWllama(searchResults, query),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : (error as string);

      console.info(`Could not rank search results: ${errorMessage}`);
    }
  }

  updateLoadingToast("Loading AI model...");

  try {
    try {
      if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

      await generateTextWithWebLlm();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : (error as string);

      console.info(
        `Could not load web-llm chat module: ${errorMessage}\n\nFalling back to Wllama.`,
      );

      try {
        await generateTextWithWllama();
      } catch (error) {
        console.error("Error while generating response with wllama:", error);
      }
    }

    dismissLoadingToast();
  } catch (error) {
    console.error(
      "Could not generate response with any of the available models:",
      error,
    );

    dismissLoadingToast();

    const restartTimeout = 5000;

    toast.error(
      "Could not generate response. This browser may be out of memory. Let's try refreshing the page.",
      { duration: restartTimeout },
    );

    setTimeout(() => {
      caches.keys().then(function (cacheNames) {
        cacheNames.forEach(function (cacheName) {
          caches.delete(cacheName);
        });
        localStorage.clear();
        location.reload();
      });
    }, restartTimeout);
  }

  if (debug) {
    console.timeEnd("Response Generation Time");
  }
}

function updateLoadingToast(text: string) {
  toast.loading(text, {
    id: "text-generation-loading-toast",
    position: "bottom-center",
  });
}

function dismissLoadingToast() {
  toast.dismiss("text-generation-loading-toast");
}

async function generateTextWithWebLlm() {
  const { CreateWebWorkerEngine, CreateEngine, hasModelInCache } = await import(
    "@mlc-ai/web-llm"
  );

  const availableModels = {
    Llama: "Llama-3-8B-Instruct-q4f16_1",
    Mistral: "Mistral-7B-Instruct-v0.2-q4f16_1",
    Gemma: "gemma-2b-it-q4f16_1",
  };

  const selectedModel = getUseLargerModelSetting()
    ? availableModels.Llama
    : availableModels.Gemma;

  const isModelCached = await hasModelInCache(selectedModel);

  let initProgressCallback:
    | import("@mlc-ai/web-llm").InitProgressCallback
    | undefined;

  if (isModelCached) {
    updateLoadingToast("Generating response...");
  } else {
    initProgressCallback = (report) => {
      updateLoadingToast(
        `Loading: ${report.text.replaceAll("[", "(").replaceAll("]", ")")}`,
      );
    };
  }

  const engine = Worker
    ? await CreateWebWorkerEngine(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
        selectedModel,
        { initProgressCallback },
      )
    : await CreateEngine(selectedModel, { initProgressCallback });

  if (!getDisableAiResponseSetting()) {
    updateLoadingToast("Generating response...");

    const prompt = [
      "I have a request/question for you, but before that, I want to provide you with some context.",
      "\n",
      "Context:",
      getSearchResults()
        .slice(0, amountOfSearchResultsToUseOnPrompt)
        .map(([title, snippet]) => `- ${title}: ${snippet}`)
        .join("\n"),
      "\n",
      "Now, my request/question is:",
      query,
    ].join("\n");

    const messages: import("@mlc-ai/web-llm").ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity.",
      },
      { role: "user", content: prompt },
    ];

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: messages,
      temperature: 0.5,
      top_p: 0.5,
      frequency_penalty: 1.15,
      presence_penalty: 0.5,
      max_gen_len: 768,
    });

    let streamedMessage = "";

    for await (const chunk of completion) {
      const deltaContent = chunk.choices[0].delta.content;

      if (deltaContent) streamedMessage += deltaContent;

      updateResponse(streamedMessage);
    }
  }

  await engine.resetChat();

  if (getSummarizeLinksSetting()) {
    updateLoadingToast("Summarizing links...");

    for (const [title, snippet, url] of getSearchResults()) {
      const prompt = [
        `When searching for "${query}", this link was found: [${title}](${url} "${snippet}")`,
        "Now, tell me: What is this link about and how is it related to the search?",
        "Note: Don't cite the link in your response. Just write a few sentences to indicate if it's worth visiting.",
      ].join("\n");

      const messages: import("@mlc-ai/web-llm").ChatCompletionMessageParam[] = [
        {
          role: "system",
          content:
            "You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity.",
        },
        { role: "user", content: prompt },
      ];

      const completion = await engine.chat.completions.create({
        stream: true,
        messages: messages,
        temperature: 0.5,
        top_p: 0.5,
        frequency_penalty: 1.15,
        presence_penalty: 0.5,
        max_gen_len: 128,
      });

      let streamedMessage = "";

      for await (const chunk of completion) {
        const deltaContent = chunk.choices[0].delta.content;

        if (deltaContent) streamedMessage += deltaContent;

        updateUrlsDescriptions({
          ...getUrlsDescriptions(),
          [url]: streamedMessage,
        });
      }

      await engine.resetChat();
    }
  }

  if (debug) {
    console.info(await engine.runtimeStatsText());
  }

  engine.unload();
}

async function generateTextWithWllama() {
  const { initializeWllama, runCompletion, exitWllama } = await import(
    "./wllama"
  );

  const commonSamplingConfig: import("@wllama/wllama").SamplingConfig = {
    temp: 0.35,
    dynatemp_range: 0.25,
    top_k: 0,
    top_p: 1,
    min_p: 0.05,
    tfs_z: 0.95,
    typical_p: 0.85,
    penalty_freq: 0.5,
    penalty_repeat: 1.176,
    penalty_last_n: -1,
    mirostat: 2,
    mirostat_tau: 3.5,
  };

  const availableModels: {
    [key in
      | "mobileDefault"
      | "mobileLarger"
      | "desktopDefault"
      | "desktopLarger"]: {
      url: string;
      systemPrefix: string;
      userPrefix: string;
      assistantPrefix: string;
      messageSuffix: string;
      sampling: import("@wllama/wllama").SamplingConfig;
    };
  } = {
    mobileDefault: {
      url: "https://huggingface.co/Felladrin/gguf-vicuna-160m/resolve/main/vicuna-160m.Q8_0.gguf",
      systemPrefix: "",
      userPrefix: "USER:",
      assistantPrefix: "ASSISTANT:",
      messageSuffix: "</s> ",
      sampling: commonSamplingConfig,
    },
    mobileLarger: {
      url: "https://huggingface.co/Felladrin/gguf-zephyr-220m-dpo-full/resolve/main/zephyr-220m-dpo-full.Q8_0.gguf",
      systemPrefix: "<|system|>\n",
      userPrefix: "<|user|>\n",
      assistantPrefix: "<|assistant|>\n",
      messageSuffix: "</s>\n",
      sampling: commonSamplingConfig,
    },
    desktopDefault: {
      url: "https://huggingface.co/Felladrin/gguf-vicuna-160m/resolve/main/vicuna-160m.Q8_0.gguf",
      systemPrefix: "",
      userPrefix: "USER:",
      assistantPrefix: "ASSISTANT:",
      messageSuffix: "</s> ",
      sampling: commonSamplingConfig,
    },
    desktopLarger: {
      url: "https://huggingface.co/Felladrin/gguf-Qwen1.5-0.5B-Chat/resolve/main/Qwen1.5-0.5B-Chat.Q8_0.gguf",
      systemPrefix: "<|im_start|>system\n",
      userPrefix: "<|im_start|>user\n",
      assistantPrefix: "<|im_start|>assistant\n",
      messageSuffix: "<|im_end|>\n",
      sampling: commonSamplingConfig,
    },
  };

  const defaultModel = isRunningOnMobile
    ? availableModels.mobileDefault
    : availableModels.desktopDefault;

  const largerModel = isRunningOnMobile
    ? availableModels.mobileLarger
    : availableModels.desktopLarger;

  const selectedModel = getUseLargerModelSetting() ? largerModel : defaultModel;

  await initializeWllama({
    modelUrl: selectedModel.url,
    modelConfig: {
      n_ctx: 2048,
    },
  });

  if (!getDisableAiResponseSetting()) {
    const prompt = [
      selectedModel.systemPrefix,
      [
        "You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity.",
        "If the information below is useful, you can use it to complement your response. Otherwise, ignore it.",
        getSearchResults()
          .slice(0, amountOfSearchResultsToUseOnPrompt)
          .map(([title, snippet]) => `- ${title}: ${snippet}`)
          .join("\n"),
      ].join("\n\n"),
      selectedModel.messageSuffix,
      selectedModel.userPrefix,
      "Hello!",
      selectedModel.messageSuffix,
      selectedModel.assistantPrefix,
      "Hi! How can I help you today?",
      selectedModel.messageSuffix,
      selectedModel.userPrefix,
      query,
      selectedModel.messageSuffix,
      selectedModel.assistantPrefix,
    ].join("");

    if (!query) throw Error("Query is empty.");

    updateLoadingToast("Generating response...");

    const completion = await runCompletion({
      prompt,
      nPredict: 768,
      sampling: selectedModel.sampling,
      onNewToken: (_token, _piece, currentText) => {
        updateResponse(currentText);
      },
    });

    updateResponse(completion);
  }

  if (getSummarizeLinksSetting()) {
    updateLoadingToast("Summarizing links...");

    for (const [title, snippet, url] of getSearchResults()) {
      const prompt = [
        selectedModel.systemPrefix,
        "You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity.",
        selectedModel.messageSuffix,
        selectedModel.userPrefix,
        "Hello!",
        selectedModel.messageSuffix,
        selectedModel.assistantPrefix,
        "Hi! How can I help you today?",
        selectedModel.messageSuffix,
        selectedModel.userPrefix,
        ["Context:", `${title}: ${snippet}`].join("\n"),
        "\n",
        ["Question:", "What is this text about?"].join("\n"),
        selectedModel.messageSuffix,
        selectedModel.assistantPrefix,
        "This text is about",
      ].join("");

      const completion = await runCompletion({
        prompt,
        nPredict: 128,
        sampling: selectedModel.sampling,
        onNewToken: (_token, _piece, currentText) => {
          updateUrlsDescriptions({
            ...getUrlsDescriptions(),
            [url]: `This link is about ${currentText}`,
          });
        },
      });

      updateUrlsDescriptions({
        ...getUrlsDescriptions(),
        [url]: `This link is about ${completion}`,
      });
    }
  }

  await exitWllama();
}

async function rankSearchResultsWithWllama(
  searchResults: SearchResults,
  query: string,
) {
  const { initializeWllama, rank, exitWllama } = await import("./wllama");

  await initializeWllama({
    modelUrl:
      "https://huggingface.co/ggml-org/models/resolve/main/bert-bge-small/ggml-model-f16.gguf",
    modelConfig: {
      n_ctx: 2048,
      embeddings: true,
      pooling_type: "LLAMA_POOLING_TYPE_MEAN",
    },
  });

  const documents = searchResults.map(
    ([title, snippet]) => `${title}: ${snippet}`,
  );

  updateLoadingToast("Analyzing search results...");

  const scores = await rank({ query, documents });

  const searchResultToScoreMap: Map<SearchResults[0], number> = new Map();

  scores.map((score, index) =>
    searchResultToScoreMap.set(searchResults[index], score ?? 0),
  );

  await exitWllama();

  return searchResults.slice().sort((a, b) => {
    return (
      (searchResultToScoreMap.get(b) ?? 0) -
      (searchResultToScoreMap.get(a) ?? 0)
    );
  });
}
