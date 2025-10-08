import { getSettings } from "./pubSub";

export function getSystemPrompt(searchResults: string) {
  return getSettings()
    .systemPrompt.replace("{{searchResults}}", searchResults)
    .replace(
      "{{dateTime}}",
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
}
