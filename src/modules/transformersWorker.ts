import { handleActions } from "../../node_modules/typed-worker/dist";
import {
  runTextToTextGenerationPipeline,
  applyChatTemplate,
  rank,
} from "./transformers";

export const actions = {
  runTextToTextGenerationPipeline,
  applyChatTemplate,
  rank,
};

export type Actions = typeof actions;

handleActions(actions);
