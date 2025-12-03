import { getSettings } from "./pubSub";

export function getSystemPrompt(searchResults: string) {
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return getSettings()
    .systemPrompt.replace("{{searchResults}}", searchResults)
    .replace(/{{dateTime}}|{{currentDate}}/g, currentDate);
}
