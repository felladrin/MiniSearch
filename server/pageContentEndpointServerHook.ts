import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import { fetchPageContents } from "./pageContentService.ts";
import { recordGroundingOutcome } from "./searchesSinceLastRestart.ts";

const MAX_QUERY_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;
/** Matches `searchResultsToConsider` on the client: the pages that reach the prompt. */
const MAX_URLS = 6;

const pageContentParamsSchema = z.object({
  query: z
    .string({ error: "Missing query parameter" })
    .trim()
    .min(1, "Missing query parameter")
    .max(
      MAX_QUERY_LENGTH,
      `Query parameter must not exceed ${MAX_QUERY_LENGTH} characters`,
    ),
  urls: z
    .array(
      z
        .url({ protocol: /^https?$/, error: "Invalid URL parameter" })
        .max(MAX_URL_LENGTH),
    )
    .min(1, "Missing url parameter")
    .max(MAX_URLS, `No more than ${MAX_URLS} URLs can be read per request`)
    // Repeats would otherwise multiply the requests one caller can aim at a
    // single site, and a page read twice adds nothing to the excerpt.
    .transform((urls) => [...new Set(urls)]),
});

/**
 * Sets up the `/page-content` endpoint, which reads the pages behind a handful
 * of search results and answers with the passages most relevant to the query.
 *
 * Kept off the `/search/` prefix on purpose: `searchEndpointServerHook` claims
 * every path under it, so a sibling route there would depend on middleware
 * ordering to ever be reached.
 *
 * Unlike `/search/`, which only ever reaches the configured SearXNG instance,
 * this endpoint fetches URLs the caller chose. It is always available; each
 * browser decides whether to call it, under AI Settings > Read Page Content.
 */
export function pageContentEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith("/page-content")) return next();

    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== "/page-content") return next();

    // Verified before the parameters are read, so malformed requests from an
    // unauthenticated caller still count against the rate limiter.
    const { shouldContinue } = await handleTokenVerification(
      url.searchParams.get("token"),
      response,
      request,
    );

    if (!shouldContinue) return;

    const parsedParams = pageContentParamsSchema.safeParse({
      query: url.searchParams.get("q") ?? undefined,
      urls: url.searchParams.getAll("url"),
    });

    if (!parsedParams.success) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ error: parsedParams.error.issues[0].message }),
      );
      return;
    }

    try {
      const { query, urls } = parsedParams.data;
      const contents = await fetchPageContents(query, urls);
      recordGroundingOutcome(contents.length > 0);

      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          Object.fromEntries(
            contents.map(({ url: page, content }) => [page, content]),
          ),
        ),
      );
    } catch (error) {
      console.error(
        "Error reading page content:",
        error instanceof Error ? error.message : error,
      );
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}
