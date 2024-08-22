import { isWebGPUAvailable } from "./webGpu";
import {
  updateSearchResults,
  getDisableAiResponseSetting,
  updateResponse,
  getSearchResults,
  updateUrlsDescriptions,
  getDisableWebGpuUsageSetting,
  getNumberOfThreadsSetting,
  getQuery,
  interruptTextGeneration,
  onTextGenerationInterrupted,
  getNumberOfSearchResultsToConsiderSetting,
  updateSearchPromise,
  getSearchPromise,
  updateTextGenerationState,
  updateSearchState,
  updateModelLoadingProgress,
  getTextGenerationState,
} from "./pubSub";
import { search } from "./search";
import { isRunningOnMobile } from "./mobileDetection";
import { isRunningOnSafari } from "./browserDetection";
import { match } from "ts-pattern";
import { addLogEntry } from "./logEntries";

export async function prepareTextGeneration() {
  if (getQuery() === "") return;

  document.title = getQuery();

  interruptTextGeneration();

  updateResponse("");

  updateSearchResults([]);

  updateSearchPromise(startSearch(getQuery()));

  if (getDisableAiResponseSetting()) return;

  const responseGenerationStartTime = new Date().getTime();

  updateTextGenerationState("loadingModel");

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
      await generateTextWithWllama();
    }

    updateTextGenerationState("completed");
  } catch {
    updateTextGenerationState("failed");
  }

  addLogEntry(
    `Response generation took ${new Date().getTime() - responseGenerationStartTime}ms`,
  );
}

async function generateTextWithWebLlm() {
  const { CreateWebWorkerMLCEngine, CreateMLCEngine, hasModelInCache } =
    await import("@mlc-ai/web-llm");

  const appConfig = {
    model_list: [
      {
        model_id: "mlc-q4f16_1-Qwen2-0.5B-Instruct",
        model:
          "https://huggingface.co/Felladrin/mlc-q4f16_1-Qwen2-0.5B-Instruct",
        model_lib:
          "https://huggingface.co/Felladrin/mlc-q4f16_1-Qwen2-0.5B-Instruct/resolve/main/model.wasm",
      },
      {
        model_id: "mlc-q0f16-arcee-lite",
        model: "https://huggingface.co/Felladrin/mlc-q0f16-arcee-lite",
        model_lib:
          "https://huggingface.co/Felladrin/mlc-q0f16-arcee-lite/resolve/main/model.wasm",
      },
    ],
  };

  const selectedModelId =
    appConfig.model_list[isRunningOnMobile ? 0 : 1].model_id;

  const isModelCached = await hasModelInCache(selectedModelId, appConfig);

  let initProgressCallback:
    | import("@mlc-ai/web-llm").InitProgressCallback
    | undefined;

  if (isModelCached) {
    updateTextGenerationState("preparingToGenerate");
  } else {
    initProgressCallback = (report) => {
      updateModelLoadingProgress(Math.round(report.progress * 100));
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
          logLevel: "SILENT",
        },
      )
    : await CreateMLCEngine(selectedModelId, {
        appConfig,
        initProgressCallback,
        logLevel: "SILENT",
      });

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [{ role: "user", content: getMainPrompt() }],
      temperature: 0.65,
      top_p: 0.55,
    });

    let streamedMessage = "";

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(async () => {
        await engine.interruptGenerate();
        updateTextGenerationState("interrupted");
      });

    for await (const chunk of completion) {
      const deltaContent = chunk.choices[0].delta.content;

      if (deltaContent) streamedMessage += deltaContent;

      if (getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
      }

      updateResponse(streamedMessage);
    }

    unsubscribeFromTextGenerationInterruption();

    if (getTextGenerationState() === "interrupted") {
      updateResponse("");
    }
  }

  addLogEntry(
    `WebLLM finished generating the response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();
}

async function generateTextWithWllama() {
  const { initializeWllama, availableModels } = await import("./wllama");

  const selectedModel = match(isRunningOnMobile)
    .with(true, () => availableModels.mobile)
    .with(false, () => availableModels.desktop)
    .exhaustive();

  let loadingPercentage = 0;

  const wllama = await initializeWllama(selectedModel.url, {
    wllama: {
      suppressNativeLog: true,
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
          updateModelLoadingProgress(progressPercentage);
        }
      },
    },
  });

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    const prompt = await selectedModel.buildPrompt(
      wllama,
      getQuery(),
      getFormattedSearchResults(selectedModel.shouldIncludeUrlsOnPrompt),
    );

    let abortTextGeneration: (() => void) | undefined;

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(() => {
        abortTextGeneration?.();
        updateTextGenerationState("interrupted");
      });

    await wllama.createCompletion(prompt, {
      sampling: selectedModel.sampling,
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        abortTextGeneration = abortSignal;

        if (getTextGenerationState() !== "generating") {
          updateTextGenerationState("generating");
        }

        updateResponse(currentText);
      },
    });

    unsubscribeFromTextGenerationInterruption();

    if (getTextGenerationState() === "interrupted") {
      updateResponse("");
    }
  }

  await wllama.exit();
}

async function generateTextWithRatchet() {
  const { initializeRatchet, runCompletion, exitRatchet } = await import(
    "./ratchet"
  );

  await initializeRatchet((loadingProgressPercentage) => {
    updateModelLoadingProgress(Math.round(loadingProgressPercentage));
  });

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    let response = "";

    const unsubscribeFromTextGenerationInterruption =
      onTextGenerationInterrupted(() => self.location.reload());

    await runCompletion(getMainPrompt(), (completionChunk) => {
      if (getTextGenerationState() !== "generating") {
        updateTextGenerationState("generating");
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

  if (searchResults.length === 0) {
    const queryKeywords = await getKeywords(query, 10);

    searchResults = await search(queryKeywords.join(" "), 30);
  }

  updateSearchState(searchResults.length === 0 ? "failed" : "completed");

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
    updateTextGenerationState("awaitingSearchResults");
    await getSearchPromise();
  }
}
