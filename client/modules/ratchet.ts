import {
  Model,
  Quantization,
  default as initialize,
} from "@ratchet-ml/ratchet-web";
import ratchetWasmUrl from "@ratchet-ml/ratchet-web/ratchet-web_bg.wasm?url";

let model: Model | undefined;

export async function initializeRatchet(
  handleLoadingProgress: (loadingProgressPercentage: number) => void,
) {
  await initialize(ratchetWasmUrl);

  model = await Model.load(
    { Phi: "phi3" },
    Quantization.Q8_0,
    handleLoadingProgress,
  );
}

export async function runCompletion(
  prompt: string,
  callback: (completionChunk: string) => void,
) {
  if (!model) throw new Error("Ratchet is not initialized.");

  await model.run({ prompt, callback });
}

export async function exitRatchet() {
  if (!model) throw new Error("Ratchet is not initialized.");

  model.free();

  model = undefined;
}
