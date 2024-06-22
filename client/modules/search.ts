import memoizePromise from "p-memoize";
import { getSearchTokenHash } from "./searchTokenHash";

export type SearchResults = [title: string, snippet: string, url: string][];

export const search = memoizePromise(
  async (query: string, limit?: number): Promise<SearchResults> => {
    const searchUrl = new URL("/search", self.location.origin);

    searchUrl.searchParams.set("q", query);

    searchUrl.searchParams.set("token", await getSearchTokenHash());

    if (limit && limit > 0) {
      searchUrl.searchParams.set("limit", limit.toString());
    }

    const response = await fetch(searchUrl.toString());

    return response.ok ? response.json() : [];
  },
);
