import { getSettings } from "./pubSub";
import { Setting } from "./settings";

export function getSystemPrompt(searchResults: string) {
  return getSettings()[Setting.systemPrompt].replace(
    "{{searchResults}}",
    searchResults,
  );
}
