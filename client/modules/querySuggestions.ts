import { shuffle } from "@shared/shuffle";
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

/** The refill under way, so callers that find the store empty together share one fetch. */
let refillInFlight: Promise<void> | undefined;

/** Pops a stored suggestion, refilling the store when it is empty; never resolves to an empty string. */
export async function getRandomQuerySuggestion(): Promise<string> {
  if (toNonEmptyStrings(getQuerySuggestions()).length === 0) {
    refillInFlight ??= refillQuerySuggestions(25).finally(() => {
      refillInFlight = undefined;
    });
    await refillInFlight;
  }

  // Read after the wait, not before: callers that waited on the same refill
  // each take their own suggestion from what it stored.
  const querySuggestions = toNonEmptyStrings(getQuerySuggestions());
  const randomQuerySuggestion = querySuggestions.pop();

  updateQuerySuggestions(querySuggestions);

  return randomQuerySuggestion ?? DEFAULT_QUERY_SUGGESTION;
}

async function refillQuerySuggestions(limit: number): Promise<void> {
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

    const querySuggestionsList = shuffle(toNonEmptyStrings(body)).slice(
      0,
      limit,
    );

    updateQuerySuggestions(querySuggestionsList);

    addLogEntry(
      `Query suggestions refilled with ${querySuggestionsList.length} suggestions`,
    );
  } catch (error) {
    addLogEntry(
      `Failed to refill query suggestions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
