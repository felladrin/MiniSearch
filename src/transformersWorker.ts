import { handleActions } from "../node_modules/typed-worker/dist";
import { preloadModels, runTextToTextGenerationPipeline } from "./transformers";

export const actions = {
  preloadModels,
  runTextToTextGenerationPipeline,
};

export type Actions = typeof actions;

handleActions(actions);
