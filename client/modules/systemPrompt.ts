import { getSettings } from "./pubSub";

const PLACEHOLDERS = /\{\{(searchResults|currentDate|dateTime)\}\}/g;

/** Replaces the `{{searchResults}}` and date placeholders in the configured prompt. */
export function getSystemPrompt(searchResults: string) {
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return getSettings().systemPrompt.replace(PLACEHOLDERS, (_match, name) =>
    name === "searchResults" ? searchResults : currentDate,
  );
}
