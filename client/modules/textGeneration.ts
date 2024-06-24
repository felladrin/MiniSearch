import { isWebGPUAvailable } from "./webGpu";
import {
  updateQuery,
  updateSearchResults,
  getDisableAiResponseSetting,
  getUseLargerModelSetting,
  updateResponse,
  getSearchResults,
  updateUrlsDescriptions,
  getDisableWebGpuUsageSetting,
  getNumberOfThreadsSetting,
  isDebugModeEnabled,
  getQuery,
  interruptTextGeneration,
  onTextGenerationInterrupted,
  getNumberOfSearchResultsToConsiderSetting,
} from "./pubSub";
import { search } from "./search";
import toast from "react-hot-toast";
import { isRunningOnMobile } from "./mobileDetection";
import { isRunningOnSafari } from "./browserDetection";
import { match } from "ts-pattern";

export async function prepareTextGeneration() {
  if (getQuery() === "") return;

  document.title = getQuery();

  interruptTextGeneration();

  updateQuery(getQuery());

  updateResponse("");

  updateSearchResults([]);

  const searchPromise = getSearchPromise(getQuery());

  if (getDisableAiResponseSetting()) return;

  if (isDebugModeEnabled()) console.time("Response Generation Time");

  updateLoadingToast("Loading AI model...");

  try {
    try {
      if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

      if (getDisableWebGpuUsageSetting()) throw Error("WebGPU is disabled.");

      const generateTextWithWebGpu = [
        generateTextWithWebLlm,
        generateTextWithRatchet,
      ];

      if (isRunningOnSafari) generateTextWithWebGpu.reverse();

      try {
        await generateTextWithWebGpu[0](searchPromise);
      } catch (error) {
        await generateTextWithWebGpu[1](searchPromise);
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

  if (isDebugModeEnabled()) {
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
        {
          initProgressCallback,
          logLevel: isDebugModeEnabled() ? "DEBUG" : "SILENT",
        },
      )
    : await CreateMLCEngine(selectedModel, {
        initProgressCallback,
        logLevel: isDebugModeEnabled() ? "DEBUG" : "SILENT",
      });

  if (!getDisableAiResponseSetting()) {
    await searchPromise;

    updateLoadingToast("Preparing response...");

    let isAnswering = false;

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [{ role: "user", content: getMainPrompt(true) }],
    });

    let streamedMessage = "";

    let wasInterrupted = false;

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(async () => {
        await engine.interruptGenerate();
        wasInterrupted = true;
      });

    for await (const chunk of completion) {
      const deltaContent = chunk.choices[0].delta.content;

      if (deltaContent) streamedMessage += deltaContent;

      if (!isAnswering) {
        isAnswering = true;
        updateLoadingToast("Generating response...");
      }

      updateResponse(streamedMessage);
    }

    unsubscribeFromTextGenerationInterruption();

    if (wasInterrupted) updateResponse("");
  }

  if (isDebugModeEnabled()) {
    console.info(await engine.runtimeStatsText());
  }

  engine.unload();
}

async function generateTextWithWllama(searchPromise: Promise<void>) {
  const { initializeWllama, availableModels } = await import("./wllama");

  const selectedModel = match([isRunningOnMobile, getUseLargerModelSetting()])
    .with([true, false], () => availableModels.mobileDefault)
    .with([true, true], () => availableModels.mobileLarger)
    .with([false, false], () => availableModels.desktopDefault)
    .with([false, true], () => availableModels.desktopLarger)
    .exhaustive();

  let loadingPercentage = 0;

  const wllama = await initializeWllama(selectedModel.url, {
    wllama: {
      suppressNativeLog: !isDebugModeEnabled(),
    },
    model: {
      n_threads: getNumberOfThreadsSetting(),
      n_ctx: selectedModel.contextSize,
      cache_type_k: selectedModel.cacheType,
      parallelDownloads: isRunningOnMobile ? 1 : 3,
      embeddings: false,
      progressCallback: ({ loaded, total }) => {
        const progressPercentage = Math.round((loaded / total) * 100);

        if (loadingPercentage !== progressPercentage) {
          loadingPercentage = progressPercentage;
          updateLoadingToast(
            loadingPercentage === 100
              ? `AI model loaded.`
              : `Loading: ${loadingPercentage}%`,
          );
        }
      },
    },
  });

  if (!getDisableAiResponseSetting()) {
    await searchPromise;

    updateLoadingToast("Preparing response...");

    const prompt = [
      selectedModel.introduction,
      selectedModel.userPrefix,
      "Hello!",
      selectedModel.userSuffix,
      selectedModel.assistantPrefix,
      "Hi! How can I help you?",
      selectedModel.assistantSuffix,
      selectedModel.userPrefix,
      getMainPrompt(!isRunningOnMobile),
      selectedModel.userSuffix,
      selectedModel.assistantPrefix,
    ].join("");

    let isAnswering = false;

    let abortTextGeneration: (() => void) | undefined;

    let wasInterrupted = false;

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(() => {
        abortTextGeneration?.();
        wasInterrupted = true;
      });

    await wllama.createCompletion(prompt, {
      sampling: selectedModel.sampling,
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        abortTextGeneration = abortSignal;

        if (!isAnswering) {
          isAnswering = true;
          updateLoadingToast("Generating response...");
        }

        updateResponse(currentText);

        for (const stopString of selectedModel.stopStrings) {
          if (currentText.includes(stopString)) {
            updateResponse(currentText.replaceAll(stopString, ""));
            abortSignal();
          }
        }
      },
    });

    unsubscribeFromTextGenerationInterruption();

    if (wasInterrupted) updateResponse("");
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

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(() => self.location.reload());

    await runCompletion(getMainPrompt(true), (completionChunk) => {
      if (!isAnswering) {
        isAnswering = true;
        updateLoadingToast("Generating response...");
      }

      response += completionChunk;
      updateResponse(response);
    });

    unsubscribeFromTextGenerationInterruption();

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

function getMainPrompt(shouldIncludeUrl: boolean) {
  const numberOfSearchResultsToConsider = Math.min(
    Math.max(getNumberOfSearchResultsToConsiderSetting(), 0),
    10,
  );

  if (numberOfSearchResultsToConsider === 0) return getQuery();

  return [
    "Provide a concise response to the request below.",
    "If the information from the web search results below is useful, you can use it to complement your response. Otherwise, ignore it.",
    "",
    "Top web search results:",
    "",
    getFormattedSearchResults(
      shouldIncludeUrl,
      numberOfSearchResultsToConsider,
    ),
    "",
    "Request:",
    "",
    getQuery(),
  ].join("\n");
}

function getFormattedSearchResults(shouldIncludeUrl: boolean, limit?: number) {
  if (shouldIncludeUrl) {
    return getSearchResults()
      .slice(0, limit)
      .map(
        ([title, snippet, url], index) =>
          `${index + 1}. [${title}](${url} "${snippet.replaceAll('"', "'")}")`,
      )
      .join("\n");
  }

  return getSearchResults()
    .slice(0, limit)
    .map(([title, snippet]) => `${title}\n${snippet}`)
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
