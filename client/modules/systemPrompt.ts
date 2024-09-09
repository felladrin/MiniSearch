import { getSettings } from "./pubSub";
import { Setting } from "./settings";

export function getSystemPrompt(searchResults: string) {
  const systemPrompt = getSettings()[Setting.systemPrompt];
  return systemPrompt
    .replace("{{searchResults}}", searchResults)
    .replace("{{dateTime}}", new Date().toString());
}
