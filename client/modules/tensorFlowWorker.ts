import { handleActions } from "../../node_modules/typed-worker/dist";
import { rank } from "./tensorFlow";

export const actions = {
  rank,
};

export type Actions = typeof actions;

handleActions(actions);
