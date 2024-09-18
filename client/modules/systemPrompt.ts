import { getSettings } from "./pubSub";

export function getSystemPrompt(searchResults: string) {
  return getSettings()
    .systemPrompt.replace("{{searchResults}}", searchResults)
    .replace("{{dateTime}}", new Date().toString());
}
