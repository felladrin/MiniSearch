import { handleActions } from "../node_modules/typed-worker/dist";
import {
  runQuestionAnsweringPipeline,
  runTextToTextGenerationPipeline,
} from "./transformers";

export const actions = {
  runQuestionAnsweringPipeline,
  runTextToTextGenerationPipeline,
};

export type Actions = typeof actions;

handleActions(actions);
