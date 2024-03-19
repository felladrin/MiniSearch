import type {
  LoadModelConfig,
  SamplingConfig,
  Wllama as WllamaType,
  AssetsPathConfig,
} from "@wllama/wllama/esm";
import wllamaSingle from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import wllamaMulti from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";
import wllamaMultiWorker from "@wllama/wllama/esm/multi-thread/wllama.worker.mjs?url";

let wllama: WllamaType | null = null;

export async function initializeWllama(config: {
  modelUrl: string;
  modelConfig?: LoadModelConfig;
}) {
  let configPaths: AssetsPathConfig;

  if (process.env.NODE_ENV === "development") {
    configPaths = {
      "single-thread/wllama.wasm": wllamaSingle,
      "multi-thread/wllama.wasm": wllamaMulti,
      "multi-thread/wllama.worker.mjs": wllamaMultiWorker,
    };
  } else {
    configPaths = {
      "single-thread/wllama.wasm": "/wllama/esm/single-thread/wllama.wasm",
      "multi-thread/wllama.wasm": "/wllama/esm/multi-thread/wllama.wasm",
      "multi-thread/wllama.worker.mjs":
        "/wllama/esm/multi-thread/wllama.worker.mjs",
    };
  }

  let Wllama!: typeof WllamaType;

  if (process.env.NODE_ENV === "development") {
    Wllama = (await import("@wllama/wllama/esm/index.js")).Wllama;
  } else {
    Wllama = (await import("/wllama/esm/index.js" as string)).Wllama;
  }

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
