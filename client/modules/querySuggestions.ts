import { addLogEntry } from "./logEntries";
import { getQuerySuggestions, updateQuerySuggestions } from "./pubSub";

/** Shown in the search box when no stored or fetched suggestion is usable. */
export const DEFAULT_QUERY_SUGGESTION = "Anything you need!";

/** Keeps the non-empty strings of a list read from storage or the network. */
function toNonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

/** Pops a stored suggestion, refilling the store when it is empty; never resolves to an empty string. */
export async function getRandomQuerySuggestion(): Promise<string> {
  let querySuggestions = toNonEmptyStrings(getQuerySuggestions());

  if (querySuggestions.length === 0)
    querySuggestions = await refillQuerySuggestions(25);

  const randomQuerySuggestion = querySuggestions.pop();

  updateQuerySuggestions(querySuggestions);

  return randomQuerySuggestion ?? DEFAULT_QUERY_SUGGESTION;
}

async function refillQuerySuggestions(limit: number): Promise<string[]> {
  const querySuggestionsFileUrl = new URL(
    "/query-suggestions.json",
    self.location.origin,
  );

  try {
    const fetchResponse = await fetch(querySuggestionsFileUrl.toString());

    if (!fetchResponse.ok) {
      throw new Error(`HTTP ${fetchResponse.status}`);
    }

    const body: unknown = await fetchResponse.json();

    if (!Array.isArray(body)) {
      throw new Error("the response is not a list");
    }

    const querySuggestionsList = toNonEmptyStrings(body)
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);

    addLogEntry(
      `Query suggestions refilled with ${querySuggestionsList.length} suggestions`,
    );

    return querySuggestionsList;
  } catch (error) {
    addLogEntry(
      `Failed to refill query suggestions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}
