import { addLogEntry } from "./logEntries";
import { getQuerySuggestions, updateQuerySuggestions } from "./pubSub";

export async function getRandomQuerySuggestion() {
  if (getQuerySuggestions().length === 0) await refillQuerySuggestions(25);

  const querySuggestions = getQuerySuggestions();

  const randomQuerySuggestion = querySuggestions.pop() as string;

  updateQuerySuggestions(querySuggestions);

  return randomQuerySuggestion;
}

async function refillQuerySuggestions(limit?: number) {
  const querySuggestionsFileUrl = new URL(
    "/query-suggestions.json",
    self.location.origin,
  );

  const fetchResponse = await fetch(querySuggestionsFileUrl.toString());

  const querySuggestionsList: string[] = await fetchResponse.json();

  updateQuerySuggestions(
    querySuggestionsList.sort(() => Math.random() - 0.5).slice(0, limit),
  );

  addLogEntry(`Query suggestions refilled with ${limit} suggestions`);
}
/**
 * Returns up to count suggestions for the home page, without consuming them
 * from the shared pool (the search box placeholder still pops one per load).
 * Falls back to an empty list when the suggestions file cannot be loaded, so
 * the home page degrades to just the search box.
 */
export async function getQuerySuggestionSamples(count: number) {
  if (getQuerySuggestions().length === 0) await refillQuerySuggestions(25);

  return getQuerySuggestions().slice(0, count);
}
