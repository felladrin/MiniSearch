import { isWebGPUAvailable } from "./webGpu";
import {
  updatePrompt,
  updateSearchResults,
  getDisableAiResponseSetting,
  getUseLargerModelSetting,
  updateResponse,
  getSearchResults,
  updateUrlsDescriptions,
  getDisableWebGpuUsageSetting,
  getNumberOfThreadsSetting,
} from "./pubSub";
import { search } from "./search";
import { query, debug } from "./urlParams";
import toast from "react-hot-toast";
import { isRunningOnMobile } from "./mobileDetection";

export async function prepareTextGeneration() {
  if (query === null) return;

  document.title = query;

  updatePrompt(query);

  const searchPromise = getSearchPromise(query);

  if (getDisableAiResponseSetting()) return;

  if (debug) console.time("Response Generation Time");

  updateLoadingToast("Loading AI model...");

  try {
    try {
      if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

      if (getDisableWebGpuUsageSetting()) throw Error("WebGPU is disabled.");

      if (getUseLargerModelSetting()) {
        try {
          await generateTextWithWebLlm(searchPromise);
        } catch (error) {
          await generateTextWithRatchet(searchPromise);
        }
      } else {
        try {
          await generateTextWithRatchet(searchPromise);
        } catch (error) {
          await generateTextWithWebLlm(searchPromise);
        }
      }
    } catch (error) {
      await generateTextWithWllama(searchPromise);
    }
  } catch (error) {
    toast.error(
      "Could not generate response. The browser may be out of memory. Please close this tab and run this search again in a new one.",
      { duration: 10000, position: "bottom-center" },
    );
  } finally {
    dismissLoadingToast();
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

async function generateTextWithWebLlm(searchPromise: Promise<void>) {
  const { CreateWebWorkerMLCEngine, CreateMLCEngine, hasModelInCache } =
    await import("@mlc-ai/web-llm");

  const availableModels = {
    Llama: "Llama-3-8B-Instruct-q4f16_1-MLC",
    Mistral: "Mistral-7B-Instruct-v0.2-q4f16_1-MLC",
    Gemma: "gemma-2b-it-q4f16_1-MLC",
    Phi: "Phi-3-mini-4k-instruct-q4f16_1-MLC",
    TinyLlama: "TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC",
  };

  const selectedModel = getUseLargerModelSetting()
    ? availableModels.Llama
    : availableModels.Phi;

  const isModelCached = await hasModelInCache(selectedModel);

  let initProgressCallback:
    | import("@mlc-ai/web-llm").InitProgressCallback
    | undefined;

  if (isModelCached) {
    updateLoadingToast("Preparing response...");
  } else {
    initProgressCallback = (report) => {
      updateLoadingToast(
        `Loading: ${report.text.replaceAll("[", "(").replaceAll("]", ")")}`,
      );
    };
  }

  const engine = Worker
    ? await CreateWebWorkerMLCEngine(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
        selectedModel,
        { initProgressCallback, logLevel: debug ? "DEBUG" : "SILENT" },
      )
    : await CreateMLCEngine(selectedModel, {
        initProgressCallback,
        logLevel: debug ? "DEBUG" : "SILENT",
      });

  if (!getDisableAiResponseSetting()) {
    await searchPromise;

    updateLoadingToast("Preparing response...");

    let isAnswering = false;

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [{ role: "user", content: getMainPrompt() }],
    });

    let streamedMessage = "";

    for await (const chunk of completion) {
      const deltaContent = chunk.choices[0].delta.content;

      if (deltaContent) streamedMessage += deltaContent;

      if (!isAnswering) {
        isAnswering = true;
        updateLoadingToast("Generating response...");
      }

      updateResponse(streamedMessage);
    }
  }

  if (debug) {
    console.info(await engine.runtimeStatsText());
  }

  engine.unload();
}

async function generateTextWithWllama(searchPromise: Promise<void>) {
  const { initializeWllama, availableModels } = await import("./wllama");

  const defaultModel = isRunningOnMobile
    ? availableModels.mobileDefault
    : availableModels.desktopDefault;

  const largerModel = isRunningOnMobile
    ? availableModels.mobileLarger
    : availableModels.desktopLarger;

  const selectedModel = getUseLargerModelSetting() ? largerModel : defaultModel;

  let loadingPercentage = 0;

  const wllama = await initializeWllama(selectedModel.url, {
    wllama: {
      suppressNativeLog: !debug,
    },
    model: {
      n_ctx: 2 * 1024,
      n_threads: getNumberOfThreadsSetting(),
      cache_type_k: selectedModel.cacheType,
      parallelDownloads: isRunningOnMobile ? 1 : 3,
      progressCallback: ({ loaded, total }) => {
        const progressPercentage = Math.round((loaded / total) * 100);

        if (loadingPercentage !== progressPercentage) {
          loadingPercentage = progressPercentage;

          if (loadingPercentage === 100) {
            updateLoadingToast(`AI model loaded.`);
          } else {
            updateLoadingToast(`Loading: ${loadingPercentage}%`);
          }
        }
      },
    },
  });

  if (!getDisableAiResponseSetting()) {
    await searchPromise;

    updateLoadingToast("Preparing response...");

    const prompt = [
      selectedModel.userPrefix,
      "Hello!",
      selectedModel.userSuffix,
      selectedModel.assistantPrefix,
      "Hi! How can I help you?",
      selectedModel.assistantSuffix,
      selectedModel.userPrefix,
      ["Take a look at this info:", getFormattedSearchResults(5)].join("\n\n"),
      selectedModel.userSuffix,
      selectedModel.assistantPrefix,
      "Alright!",
      selectedModel.assistantSuffix,
      selectedModel.userPrefix,
      "Now I'm going to write my question, and if this info is useful you can use them in your answer. Ready?",
      selectedModel.userSuffix,
      selectedModel.assistantPrefix,
      "I'm ready to answer!",
      selectedModel.assistantSuffix,
      selectedModel.userPrefix,
      query,
      selectedModel.userSuffix,
      selectedModel.assistantPrefix,
    ].join("");

    let isAnswering = false;

    const completion = await wllama.createCompletion(prompt, {
      nPredict: 768,
      sampling: selectedModel.sampling,
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        if (!isAnswering) {
          isAnswering = true;
          updateLoadingToast("Generating response...");
        }

        updateResponse(currentText);

        if (currentText.includes(selectedModel.assistantSuffix.trim())) {
          abortSignal();
        }
      },
    });

    updateResponse(
      completion.replace(selectedModel.assistantSuffix.trim(), ""),
    );
  }

  await wllama.exit();
}

async function generateTextWithRatchet(searchPromise: Promise<void>) {
  const { initializeRatchet, runCompletion, exitRatchet } = await import(
    "./ratchet"
  );

  await initializeRatchet((loadingProgressPercentage) =>
    updateLoadingToast(`Loading: ${Math.floor(loadingProgressPercentage)}%`),
  );

  if (!getDisableAiResponseSetting()) {
    await searchPromise;

    updateLoadingToast("Preparing response...");

    let isAnswering = false;

    let response = "";

    await runCompletion(getMainPrompt(), (completionChunk) => {
      if (!isAnswering) {
        isAnswering = true;
        updateLoadingToast("Generating response...");
      }

      response += completionChunk;
      updateResponse(response);
    });

    if (!endsWithASign(response)) {
      response += ".";
      updateResponse(response);
    }
  }

  await exitRatchet();
}

function endsWithASign(text: string) {
  return text.endsWith(".") || text.endsWith("!") || text.endsWith("?");
}

function getMainPrompt() {
  return [
    "Provide a concise response to the request below.",
    "If the information from the Web Search Results below is useful, you can use it to complement your response. Otherwise, ignore it.",
    "",
    "Web Search Results:",
    "",
    getFormattedSearchResults(5),
    "",
    "Request:",
    "",
    query,
  ].join("\n");
}

function getFormattedSearchResults(limit?: number) {
  return getSearchResults()
    .slice(0, limit)
    .map(([title, snippet, url]) => `${title}\n${url}\n${snippet}`)
    .join("\n\n");
}

async function getKeywords(text: string, limit?: number) {
  return (await import("keyword-extractor")).default
    .extract(text, { language: "english" })
    .slice(0, limit);
}

async function getSearchPromise(query: string) {
  toast.loading("Searching the web...", {
    id: "search-progress-toast",
    position: "bottom-center",
  });

  let searchResults = await search(
    query.length > 2000 ? (await getKeywords(query, 20)).join(" ") : query,
    30,
  );

  if (searchResults.length === 0) {
    const queryKeywords = await getKeywords(query, 10);

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

  toast.dismiss("search-progress-toast");

  updateSearchResults(searchResults);

  updateUrlsDescriptions(
    searchResults.reduce(
      (acc, [, snippet, url]) => ({ ...acc, [url]: snippet }),
      {},
    ),
  );
}
