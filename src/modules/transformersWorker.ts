import { handleActions } from "../../node_modules/typed-worker/dist";
import {
  runTextToTextGenerationPipeline,
  applyChatTemplate,
} from "./transformers";

export const actions = {
  runTextToTextGenerationPipeline,
  applyChatTemplate,
};

export type Actions = typeof actions;

handleActions(actions);
