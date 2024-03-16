import { LoadModelConfig, SamplingConfig, Wllama } from "@wllama/wllama";
import wllamaSingle from "@wllama/wllama/src/single-thread/wllama.wasm?url";
import wllamaMulti from "@wllama/wllama/src/multi-thread/wllama.wasm?url";
import wllamaMultiWorker from "@wllama/wllama/src/multi-thread/wllama.worker.mjs?url";

const configPaths = {
  "single-thread/wllama.wasm": wllamaSingle,
  "multi-thread/wllama.wasm": wllamaMulti,
  "multi-thread/wllama.worker.mjs": wllamaMultiWorker,
};

export async function runCompletion(config: {
  modelUrl: string;
  modelConfig?: LoadModelConfig;
  prompt: string;
  nPredict?: number;
  sampling?: SamplingConfig;
  onNewToken: (token: number, piece: Uint8Array, currentText: string) => void;
}) {
  const wllama = new Wllama(configPaths);

  await wllama.loadModelFromUrl(config.modelUrl, config.modelConfig ?? {});

  return wllama.createCompletion(config.prompt, {
    nPredict: config.nPredict,
    sampling: config.sampling,
    onNewToken: config.onNewToken,
  });
}
