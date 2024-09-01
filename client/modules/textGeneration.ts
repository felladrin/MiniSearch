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
  getNumberOfSearchResultsToConsiderSetting,
  updateSearchPromise,
  getSearchPromise,
  updateTextGenerationState,
  updateSearchState,
  updateModelLoadingProgress,
  getTextGenerationState,
  getWebLlmModelSetting,
} from "./pubSub";
import { search } from "./search";
import { addLogEntry } from "./logEntries";

export async function prepareTextGeneration() {
  if (getQuery() === "") return;

  document.title = getQuery();

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

      await generateTextWithWebLlm();
    } catch {
      await generateTextWithWllama();
    }

    if (getTextGenerationState() !== "interrupted") {
      updateTextGenerationState("completed");
    }
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

  const selectedModelId = getWebLlmModelSetting();

  addLogEntry(`Selected WebLLM model: ${selectedModelId}`);

  const isModelCached = await hasModelInCache(selectedModelId);

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
          initProgressCallback,
          logLevel: "SILENT",
        },
      )
    : await CreateMLCEngine(selectedModelId, {
        initProgressCallback,
        logLevel: "SILENT",
      });

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    const completion = await engine.chat.completions.create({
      stream: true,
      messages: [
        {
          role: "system",
          content: `You are an AI assistant tasked with answering questions based on provided web search results and a user inquiry. Analyze the search results and use them as background information if relevant to the inquiry, but you may disregard them if they don't contribute to answering the question. Provide a concise and informative response to the user's inquiry in a short paragraph format.

Web search results:
${"```"}
${getFormattedSearchResults(true)}
${"```"}

Please answer the user's inquiry based on the information provided or your general knowledge if the search results are not relevant. Include additional context or related information that might be useful or interesting to the user, even if not directly asked for in the inquiry. Always respond in the same language used by the user in their inquiry.`,
        },
        { role: "user", content: getQuery() },
      ],
      temperature: 0,
      frequency_penalty: 1.02,
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

      updateResponse(streamedMessage);
    }
  }

  addLogEntry(
    `WebLLM finished generating the response. Stats: ${await engine.runtimeStatsText()}`,
  );

  engine.unload();
}

async function generateTextWithWllama() {
  const { initializeWllama, model } = await import("./wllama");

  let loadingPercentage = 0;

  const wllama = await initializeWllama(model.url, {
    wllama: {
      suppressNativeLog: true,
    },
    model: {
      n_threads: getNumberOfThreadsSetting(),
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

  if (!getDisableAiResponseSetting()) {
    await canStartResponding();

    updateTextGenerationState("preparingToGenerate");

    const prompt = await model.buildPrompt(
      wllama,
      getQuery(),
      getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
    );

    await wllama.createCompletion(prompt, {
      sampling: model.sampling,
      onNewToken: (_token, _piece, currentText, { abortSignal }) => {
        if (getTextGenerationState() === "interrupted") {
          abortSignal();
        } else if (getTextGenerationState() !== "generating") {
          updateTextGenerationState("generating");
        }

        updateResponse(currentText);
      },
    });
  }

  await wllama.exit();
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
