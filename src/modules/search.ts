import { convert as convertHtmlToPlainText } from "html-to-text";

export type SearchResults = [title: string, snippet: string, url: string][];

export const searchQueryKey = "searchQuery";

export async function search(query: string, limit?: number) {
  const searchUrl = new URL("/search", window.location.origin);
  searchUrl.searchParams.set("q", query);
  if (limit && limit > 0) {
    searchUrl.searchParams.set("limit", limit.toString());
  }
  const response = await fetch(searchUrl.toString());
  return await response.json();
}

export function decodeSearchResults(
  searchResults: SearchResults,
): SearchResults {
  return searchResults.map(([title, snippet, url]) => [
    convertHtmlToPlainText(title),
    convertHtmlToPlainText(snippet),
    url,
  ]);
}
