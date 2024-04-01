import { convert as convertHtmlToPlainText } from "html-to-text";

export type SearchResults = [title: string, snippet: string, url: string][];

export async function search(query: string, limit?: number) {
  const searchUrl = new URL("/search", self.location.origin);

  searchUrl.searchParams.set("q", query);

  if (limit && limit > 0) {
    searchUrl.searchParams.set("limit", limit.toString());
  }

  const response = await fetch(searchUrl.toString());

  const searchResults = (await response.json()) as SearchResults;

  const cleanedSearchResults = searchResults.map(([title, snippet, url]) => [
    convertHtmlToPlainText(title),
    convertHtmlToPlainText(snippet),
    url,
  ]) as SearchResults;

  return cleanedSearchResults;
}
