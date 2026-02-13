import { getSettings } from "./pubSub";

/**
 * Generates a system prompt by replacing placeholders with actual values
 * @param searchResults - The search results to inject into the prompt
 * @returns The formatted system prompt with current date and search results
 */
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
