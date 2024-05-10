import {
  DownloadModelConfig,
  SamplingConfig,
  Wllama,
  AssetsPathConfig,
} from "@wllama/wllama";
import singleThreadWllamaJsUrl from "@wllama/wllama/esm/single-thread/wllama.js?url";
import singleThreadWllamaWasmUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import multiThreadWllamaJsUrl from "@wllama/wllama/esm/multi-thread/wllama.js?url";
import multiThreadWllamaWasmUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import multiThreadWllamaWorkerMjsUrl from "@wllama/wllama/esm/multi-thread/wllama.worker.mjs?url";

let wllama: Wllama | undefined;

export async function initializeWllama(config: {
  modelUrl: string;
  modelConfig?: DownloadModelConfig;
}) {
  const wllamaConfigPaths: AssetsPathConfig = {
    "single-thread/wllama.js": singleThreadWllamaJsUrl,
    "single-thread/wllama.wasm": singleThreadWllamaWasmUrl,
    "multi-thread/wllama.js": multiThreadWllamaJsUrl,
    "multi-thread/wllama.wasm": multiThreadWllamaWasmUrl,
    "multi-thread/wllama.worker.mjs": multiThreadWllamaWorkerMjsUrl,
  };

  wllama = new Wllama(wllamaConfigPaths);

  return wllama.loadModelFromUrl(config.modelUrl, config.modelConfig ?? {});
}

export async function runCompletion(config: {
  prompt: string;
  nPredict?: number;
  sampling?: SamplingConfig;
  onNewToken: (token: number, piece: Uint8Array, currentText: string) => void;
}) {
  if (!wllama) throw new Error("Wllama is not initialized.");

  return wllama.createCompletion(config.prompt, {
    nPredict: config.nPredict,
    sampling: config.sampling,
    onNewToken: config.onNewToken,
  });
}

export async function exitWllama() {
  if (!wllama) throw new Error("Wllama is not initialized.");

  await wllama.exit();

  wllama = undefined;
}
