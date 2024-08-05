import { isWebGPUAvailable } from "./webGpu";
import {
  updateSearchResults,
  getDisableAiResponseSetting,
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
  updateSearchPromise,
  getSearchPromise,
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

  updateResponse("");

  updateSearchResults([]);

  updateSearchPromise(startSearch(getQuery()));

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
        await generateTextWithWebGpu[0]();
      } catch {
        await generateTextWithWebGpu[1]();
      }
    } catch {
      try {
        await generateTextWithWllama();
      } catch {
        await generateTextWithWllama(true);
      }
    }
  } catch {
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

async function generateTextWithWebLlm() {
  const { CreateWebWorkerMLCEngine, CreateMLCEngine, hasModelInCache } =
    await import("@mlc-ai/web-llm");

  const appConfig = {
    model_list: [
      {
        model_id: "mlc-q0f16-Qwen2-1.5B-Instruct",
        model: "https://huggingface.co/Felladrin/mlc-q0f16-Qwen2-1.5B-Instruct",
        model_lib:
          "https://huggingface.co/Felladrin/mlc-q0f16-Qwen2-1.5B-Instruct/resolve/main/model.wasm",
      },
    ],
  };

  const selectedModelId = appConfig.model_list[0].model_id;

  const isModelCached = await hasModelInCache(selectedModelId, appConfig);

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
        selectedModelId,
        {
          appConfig,
          initProgressCallback,
          logLevel: isDebugModeEnabled() ? "DEBUG" : "SILENT",
        },
      )
    : await CreateMLCEngine(selectedModelId, {
        appConfig,
        initProgressCallback,
        logLevel: isDebugModeEnabled() ? "DEBUG" : "SILENT",
      });

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateLoadingToast("Preparing response...");

    let isAnswering = false;

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [{ role: "user", content: getMainPrompt() }],
      temperature: 0.65,
      top_p: 0.55,
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

async function generateTextWithWllama(useFallbackModel?: boolean) {
  const { initializeWllama, availableModels } = await import("./wllama");

  const selectedModel = match(isRunningOnMobile)
    .with(true, () =>
      useFallbackModel
        ? availableModels.mobileFallback
        : availableModels.mobile,
    )
    .with(false, () => availableModels.desktop)
    .exhaustive();

  let loadingPercentage = 0;

  const wllama = await initializeWllama(selectedModel.url, {
    wllama: {
      suppressNativeLog: !isDebugModeEnabled(),
    },
    model: {
      n_threads: isRunningOnMobile ? 1 : getNumberOfThreadsSetting(),
      n_ctx: selectedModel.contextSize,
      cache_type_k: selectedModel.cacheType,
      parallelDownloads: isRunningOnMobile ? 1 : 3,
      embeddings: false,
      allowOffline: true,
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
    await canStartResponding();

    updateLoadingToast("Preparing response...");

    const prompt = selectedModel.buildPrompt(
      getQuery(),
      getFormattedSearchResults(selectedModel.shouldIncludeUrlsOnPrompt),
    );

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

async function generateTextWithRatchet() {
  const { initializeRatchet, runCompletion, exitRatchet } = await import(
    "./ratchet"
  );

  await initializeRatchet((loadingProgressPercentage) =>
    updateLoadingToast(`Loading: ${Math.floor(loadingProgressPercentage)}%`),
  );

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateLoadingToast("Preparing response...");

    let isAnswering = false;

    let response = "";

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(() => self.location.reload());

    await runCompletion(getMainPrompt(), (completionChunk) => {
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

function getMainPrompt() {
  return `${getFormattedSearchResults(true)}

---

${getQuery()}`;
}

function getFormattedSearchResults(shouldIncludeUrl: boolean) {
  const searchResults = getSearchResults().slice(
    0,
    getNumberOfSearchResultsToConsiderSetting(),
  );

  if (searchResults.length === 0) return "None.";

  if (shouldIncludeUrl) {
    return searchResults
      .map(
        ([title, snippet, url], index) =>
          `${index + 1}. [${title}](${url} "${snippet.replaceAll('"', "'")}")`,
      )
      .join("\n");
  }

  return searchResults
    .map(([title, snippet]) => `${title}\n${snippet}`)
    .join("\n\n");
}

async function getKeywords(text: string, limit?: number) {
  return (await import("keyword-extractor")).default
    .extract(text, { language: "english" })
    .slice(0, limit);
}

async function startSearch(query: string) {
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

  return searchResults;
}

async function canStartResponding() {
  if (getNumberOfSearchResultsToConsiderSetting() > 0) {
    await getSearchPromise();
  }
}
