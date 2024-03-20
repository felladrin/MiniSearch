import type {
  LoadModelConfig,
  SamplingConfig,
  Wllama as WllamaType,
} from "@wllama/wllama/esm";
import wllamaSingleUrl from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import wllamaMultiUrl from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import wllamaMultiWorkerUrl from "@wllama/wllama/esm/multi-thread/wllama.worker.mjs?url";
import wllamaModuleUrl from "@wllama/wllama/esm/index.js?url";

let wllama: WllamaType | null = null;

export async function initializeWllama(config: {
  modelUrl: string;
  modelConfig?: LoadModelConfig;
}) {
  const configPaths = {
    "single-thread/wllama.wasm": wllamaSingleUrl,
    "multi-thread/wllama.wasm": wllamaMultiUrl,
    "multi-thread/wllama.worker.mjs": wllamaMultiWorkerUrl,
  };

  const Wllama: typeof WllamaType = (await import(wllamaModuleUrl)).Wllama;

  wllama = new Wllama(configPaths);

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

  wllama = null;
}
