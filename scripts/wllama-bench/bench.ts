// Browser side of the wllama benchmark. Runs inside the page that run.mjs
// opens, so a model is loaded and prompted through MiniSearch's own modules:
// the catalog entry, the warmup-then-load in initializeWllama, and the chat
// messages the search flow builds from results and page excerpts.

import {
  getSettings,
  queryPubSub,
  settingsPubSub,
  updateLlmTextSearchResults,
  updatePageContents,
} from "../../client/modules/pubSub";
import {
  defaultContextSize,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "../../client/modules/textGenerationUtilities";
import type { TextSearchResults } from "../../client/modules/types";
import { initializeWllama, wllamaModels } from "../../client/modules/wllama";

interface BenchCase {
  name: string;
  query: string;
  results: TextSearchResults;
  pages: Record<string, string>;
}

interface BenchOptions {
  /** A catalog id, or `owner/repo/file.gguf` for a model not in the catalog. */
  model: string;
  device: "webgpu" | "cpu";
  /** Defaults to MiniSearch's own `cpuThreads` setting. */
  threads?: number;
  cases: BenchCase[];
  chatTemplateKwargs?: Record<string, unknown>;
  reasoningBudgetTokens?: number;
  /** Seconds before an answer is cut off and marked as timed out. */
  caseTimeoutSeconds: number;
  /** Replaces the default system prompt, to measure a change to it. */
  systemPrompt?: string;
}

function resolveModel(id: string) {
  const catalogModel = wllamaModels[id];
  if (catalogModel) return catalogModel;

  const [owner, repo, ...file] = id.split("/");
  if (!owner || !repo || file.length === 0) {
    throw new Error(
      `"${id}" is neither a catalog id nor an owner/repo/file.gguf path`,
    );
  }

  // Starts from a catalog entry's shared defaults, minus the thinking budget
  // that only some entries set, as a new catalog entry would.
  return {
    ...Object.values(wllamaModels)[0],
    reasoningBudgetTokens: undefined,
    label: id,
    hfRepoId: `${owner}/${repo}`,
    hfFilePath: file.join("/"),
  };
}

async function runBench(options: BenchOptions) {
  if (options.device === "webgpu" && !(await navigator.gpu?.requestAdapter())) {
    throw new Error("This browser exposes no WebGPU adapter");
  }

  const catalogModel = resolveModel(options.model);
  const model = {
    ...catalogModel,
    chatTemplateKwargs:
      options.chatTemplateKwargs ?? catalogModel.chatTemplateKwargs,
    reasoningBudgetTokens:
      options.reasoningBudgetTokens ?? catalogModel.reasoningBudgetTokens,
  };

  if (options.systemPrompt) {
    settingsPubSub[0]({ ...getSettings(), systemPrompt: options.systemPrompt });
  }

  const loadStart = performance.now();
  // Mirrors initializeWllamaInstance in client/modules/textGenerationWithWllama.ts,
  // with the device forced instead of detected.
  const wllama = await initializeWllama(model.hfRepoId, model.hfFilePath, {
    wllama: { suppressNativeLog: false, allowOffline: true },
    chatTemplateKwargs: model.chatTemplateKwargs,
    model: {
      n_threads: options.threads ?? getSettings().cpuThreads,
      n_ctx: model.contextSize,
      n_batch: 512,
      cache_type_k: model.cacheTypeK,
      cache_type_v: model.cacheTypeV,
      flash_attn: model.flash_attn,
      embeddings: false,
      n_gpu_layers: options.device === "webgpu" ? 99999 : 0,
      ...(model.reasoningBudgetTokens
        ? { reasoning_budget_tokens: model.reasoningBudgetTokens }
        : {}),
    },
  });
  const loadSeconds = (performance.now() - loadStart) / 1000;

  const cases = [];
  for (const benchCase of options.cases) {
    queryPubSub[0](benchCase.query);
    updateLlmTextSearchResults(benchCase.results);
    updatePageContents(benchCase.pages);
    const messages = getDefaultChatMessages(
      await getFormattedSearchResults(model.shouldIncludeUrlsOnPrompt),
    );

    const start = performance.now();
    let firstAnswerAt: number | undefined;
    let thinkingTokens = 0;
    let answerTokens = 0;
    let reasoning = "";
    let answer = "";
    let timings: Record<string, number> | undefined;
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      options.caseTimeoutSeconds * 1000,
    );

    const stream = await wllama.createChatCompletion({
      messages,
      max_tokens: defaultContextSize,
      stream: true,
      abortSignal: abortController.signal,
      ...model.getSampling(),
      ...(model.chatTemplateKwargs
        ? { chat_template_kwargs: model.chatTemplateKwargs }
        : {}),
    });

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as
          | { content?: string; reasoning_content?: string }
          | undefined;
        if (delta?.reasoning_content) {
          thinkingTokens++;
          reasoning += delta.reasoning_content;
        }
        if (delta?.content) {
          firstAnswerAt ??= performance.now();
          answerTokens++;
          answer += delta.content;
        }
        // The engine's own timings ride on the stream's chunks; the last one
        // covers the whole completion.
        const chunkTimings = (chunk as { timings?: Record<string, number> })
          .timings;
        if (chunkTimings) timings = chunkTimings;
      }
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    } finally {
      clearTimeout(timeout);
    }

    const end = performance.now();
    cases.push({
      name: benchCase.name,
      promptTokens: timings?.prompt_n,
      promptTokensPerSecond: timings?.prompt_per_second,
      generatedTokensPerSecond: timings?.predicted_per_second,
      thinkingTokens,
      answerTokens,
      secondsToFirstAnswerToken:
        firstAnswerAt === undefined
          ? undefined
          : (firstAnswerAt - start) / 1000,
      totalSeconds: (end - start) / 1000,
      timedOut: abortController.signal.aborted,
      // Kept so the scorer can tell an echoed instruction from an answer.
      prompt: messages[0].content,
      reasoning,
      answer,
    });
  }

  await wllama.exit();

  return { model: model.label, device: options.device, loadSeconds, cases };
}

Object.assign(window, { runBench, benchReady: true });
