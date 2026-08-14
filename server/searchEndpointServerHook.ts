import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import { rankSearchResults } from "./rankSearchResults.ts";
import { getRerankerStatus } from "./rerankerService.ts";
import {
  incrementGraphicalSearchesSinceLastRestart,
  incrementTextualSearchesSinceLastRestart,
} from "./searchesSinceLastRestart.ts";
import { resolvePublicUrl } from "./utils/publicUrl.ts";
import { readCappedBytes } from "./utils/streamUtils.ts";
import { fetchSearXNG } from "./webSearchService.ts";

const THUMBNAIL_TIMEOUT_MS = 1000;
const MAX_THUMBNAIL_REDIRECTS = 3;
const MAX_THUMBNAIL_BYTES = 500_000;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 30;
const MAX_QUERY_LENGTH = 2000;

const searchParamsSchema = z.object({
  query: z
    .string({ error: "Missing query parameter" })
    .trim()
    .min(1, "Missing query parameter")
    .max(
      MAX_QUERY_LENGTH,
      `Query parameter must not exceed ${MAX_QUERY_LENGTH} characters`,
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .catch(DEFAULT_SEARCH_LIMIT)
    .transform((limit) => Math.min(limit, MAX_SEARCH_LIMIT)),
});

type TextResult = [title: string, content: string, url: string];
type ImageResult = [
  title: string,
  url: string,
  thumbnailSource: string,
  sourceUrl: string,
];

async function fetchThumbnailAsDataUrl(thumbnailSource: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
  try {
    let target = thumbnailSource;

    for (let hop = 0; hop <= MAX_THUMBNAIL_REDIRECTS; hop++) {
      let url: URL;
      try {
        url = await resolvePublicUrl(target);
      } catch {
        // Malformed, non-HTTP, or a private/link-local/reserved address:
        // do not fetch it on the server's behalf. Throwing lets the caller's
        // catch drop the whole image result, matching the other failure paths.
        throw new Error(
          "Refusing to fetch thumbnail from a non-public address",
        );
      }

      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
      });

      const location = response.headers.get("location");
      if (isRedirect(response.status) && location) {
        await response.body?.cancel().catch(() => {});
        target = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(
          `Thumbnail request failed with status ${response.status}`,
        );
      }

      const contentType =
        response.headers.get("content-type") ?? "application/octet-stream";
      const { bytes } = await readCappedBytes(response, MAX_THUMBNAIL_BYTES);
      const base64 = Buffer.from(bytes).toString("base64");

      return `data:${contentType};base64,${base64}`;
    }

    throw new Error("Thumbnail redirected too many times");
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== 304;
}

async function handleRanking(
  query: string,
  results: [title: string, content: string, url: string][],
  isTextSearch?: boolean,
): Promise<[title: string, content: string, url: string][]> {
  const isRerankerHealthy = await getRerankerStatus();
  if (!isRerankerHealthy) {
    console.warn("Reranker service is not healthy, using unranked results");
  }

  try {
    if (isRerankerHealthy) {
      return await rankSearchResults(query, results, isTextSearch);
    }
    return results;
  } catch (error) {
    console.error(
      "Error ranking search results:",
      error instanceof Error ? error.message : error,
    );
    return results;
  }
}

/**
 * Sets up search endpoint middleware for the Vite server.
 * Handles both text and image search requests with token verification, result ranking, and thumbnail processing.
 *
 * @param server - The Vite dev server or preview server instance
 * @returns void - Modifies the server middleware in place
 */
export function searchEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/search/")) return next();

    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");
    const parsedParams = searchParamsSchema.safeParse({
      query: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? DEFAULT_SEARCH_LIMIT,
    });

    if (!parsedParams.success) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ error: parsedParams.error.issues[0].message }),
      );
      return;
    }

    const { query, limit } = parsedParams.data;
    const { shouldContinue } = await handleTokenVerification(
      token,
      response,
      request,
    );

    if (!shouldContinue) return;

    try {
      const isTextSearch = request.url?.startsWith("/search/text");
      const searchType = isTextSearch ? "text" : "images";

      const searxngResults = await fetchSearXNG(query, searchType, limit);

      if (isTextSearch) {
        const results = searxngResults as TextResult[];
        const rankedResults = await handleRanking(query, results, true);

        incrementTextualSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(rankedResults));
      } else {
        const results = searxngResults as ImageResult[];
        const resultsText = results.map(
          ([title, url]) => [title?.slice(0, 100) || "", "", url] as TextResult,
        );
        const rankedResults = await handleRanking(query, resultsText);

        const processedResults = (
          await Promise.all(
            rankedResults.map(async ([title, , rankedResultUrl]) => {
              const result = results.find(
                ([, resultUrl]) => resultUrl === rankedResultUrl,
              );
              if (!result) return null;
              const [_, url, thumbnailSource, sourceUrl] = result;
              try {
                const thumbnail =
                  await fetchThumbnailAsDataUrl(thumbnailSource);

                return [title, url, thumbnail, sourceUrl] as ImageResult;
              } catch {
                return null;
              }
            }),
          )
        ).filter((result): result is ImageResult => result !== null);

        incrementGraphicalSearchesSinceLastRestart();

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(processedResults));
      }
    } catch (error) {
      console.error(
        "Error processing search:",
        error instanceof Error ? error.message : error,
      );
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}
