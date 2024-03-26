import type {
  LoadModelConfig,
  SamplingConfig,
  Wllama,
  AssetsPathConfig,
} from "@wllama/wllama";
import { importModuleWithoutTranspilation } from "./import";

let wllama: Wllama | undefined;

export async function initializeWllama(config: {
  modelUrl: string;
  modelConfig?: LoadModelConfig;
}) {
  const wllamaConfigPaths: AssetsPathConfig = {
    "single-thread/wllama.js": "/wllama/esm/single-thread/wllama.js",
    "single-thread/wllama.wasm": "/wllama/esm/single-thread/wllama.wasm",
    "multi-thread/wllama.js": "/wllama/esm/multi-thread/wllama.js",
    "multi-thread/wllama.wasm": "/wllama/esm/multi-thread/wllama.wasm",
    "multi-thread/wllama.worker.mjs":
      "/wllama/esm/multi-thread/wllama.worker.mjs",
  };

  wllama = new (
    await importModuleWithoutTranspilation<{
      Wllama: typeof Wllama;
    }>("/wllama/esm/index.js")
  ).Wllama(wllamaConfigPaths);

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

export async function rank(config: { query: string; documents: string[] }) {
  if (!wllama) throw new Error("Wllama is not initialized.");

  const calculateDotProduct = (a: number[], b: number[]) =>
    a.reduce((acc, _, i) => acc + a[i] * b[i], 0);

  const queryEmbedding = await wllama.createEmbedding(config.query);

  const documentsEmbeddings = (await Promise.all(
    config.documents.map((document) => wllama?.createEmbedding(document)),
  )) as number[][];

  return documentsEmbeddings.map((documentEmbedding) =>
    calculateDotProduct(queryEmbedding, documentEmbedding),
  );
}

export async function exitWllama() {
  if (!wllama) throw new Error("Wllama is not initialized.");

  await wllama.exit();

  wllama = undefined;
}
