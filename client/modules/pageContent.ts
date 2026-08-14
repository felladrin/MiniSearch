import { addLogEntry } from "./logEntries";
import { getSearchTokenHash } from "./searchTokenHash";
import type { PageContents } from "./types";

/**
 * Generous compared with the search timeout: this request reads several pages
 * in parallel and only delays the AI answer, never the search results.
 */
const REQUEST_TIMEOUT = 20000;

/**
 * Reads the pages behind the given result URLs, in ranked order, and returns
 * the passages most relevant to the query, keyed by URL. Empty when nothing
 * could be read.
 *
 * A failure here is not an error the user needs to see: the answer falls back
 * to search snippets, which is what it was grounded on before.
 */
export async function fetchPageContents(
  query: string,
  urls: string[],
): Promise<PageContents> {
  if (urls.length === 0) return {};

  const endpointUrl = new URL("/page-content", self.location.origin);
  endpointUrl.searchParams.set("q", query);
  endpointUrl.searchParams.set("token", await getSearchTokenHash());
  for (const url of urls) endpointUrl.searchParams.append("url", url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(endpointUrl.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contents = (await response.json()) as PageContents;

    addLogEntry(
      `Page content: read ${Object.keys(contents).length} of ${urls.length} page(s)`,
    );

    return contents;
  } catch (error) {
    addLogEntry(
      `Page content fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}
