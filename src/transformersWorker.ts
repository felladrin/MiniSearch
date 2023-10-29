import { handleActions } from "../node_modules/typed-worker/dist";
import { runTextToTextGenerationPipeline } from "./transformers";

export const actions = {
  runTextToTextGenerationPipeline,
};

export type Actions = typeof actions;

handleActions(actions);
