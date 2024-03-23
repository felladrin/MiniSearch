import { handleActions } from "typed-worker";
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
