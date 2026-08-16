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
