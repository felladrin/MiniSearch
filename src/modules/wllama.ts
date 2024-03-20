import {
  type LoadModelConfig,
  type SamplingConfig,
  Wllama,
} from "@wllama/wllama/esm";

let wllama: Wllama | null = null;

export async function initializeWllama(config: {
  modelUrl: string;
  modelConfig?: LoadModelConfig;
}) {
  const configPaths = {
    "single-thread/wllama.wasm": new URL(
      "../../node_modules/@wllama/wllama/esm/single-thread/wllama.wasm",
      import.meta.url,
    ).href,
    "multi-thread/wllama.wasm": new URL(
      "../../node_modules/@wllama/wllama/esm/multi-thread/wllama.wasm",
      import.meta.url,
    ).href,
    "multi-thread/wllama.worker.mjs": new URL(
      "../../node_modules/@wllama/wllama/esm/multi-thread/wllama.worker.mjs",
      import.meta.url,
    ).href,
  };

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
