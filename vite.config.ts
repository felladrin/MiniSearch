import { PreviewServer, ViteDevServer, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSSL from "@vitejs/plugin-basic-ssl";
import fetch from "node-fetch";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import temporaryDirectory from "temp-dir";
import path from "node:path";

const serverStartTime = new Date().getTime();
let searchesSinceLastRestart = 0;

export default defineConfig(({ command }) => {
  if (command === "build") regenerateSearchToken();

  return {
    root: "./client",
    define: {
      __SEARCH_TOKEN__: JSON.stringify(getSearchToken()),
    },
    server: {
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
      hmr: {
        port: process.env.HMR_PORT ? Number(process.env.HMR_PORT) : undefined,
      },
    },
    preview: {
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
    },
    build: {
      target: "esnext",
    },
    plugins: [
      process.env.BASIC_SSL === "true" ? basicSSL() : undefined,
      react(),
      {
        name: "configure-server-cross-origin-isolation",
        configureServer: crossOriginServerHook,
        configurePreviewServer: crossOriginServerHook,
      },
      {
        name: "configure-server-search-endpoint",
        configureServer: searchEndpointServerHook,
        configurePreviewServer: searchEndpointServerHook,
      },
      {
        name: "configure-server-status-endpoint",
        configureServer: statusEndpointServerHook,
        configurePreviewServer: statusEndpointServerHook,
      },
      {
        name: "configure-server-cache",
        configurePreviewServer: cacheServerHook,
      },
    ],
  };
});

function crossOriginServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use((_, response, next) => {
    /** Server headers for cross origin isolation, which enable clients to use `SharedArrayBuffer` on the Browser. */
    const crossOriginIsolationHeaders: { key: string; value: string }[] = [
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "require-corp",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "cross-origin",
      },
    ];

    crossOriginIsolationHeaders.forEach(({ key, value }) => {
      response.setHeader(key, value);
    });

    next();
  });
}

function statusEndpointServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/status")) return next();

    const secondsSinceLastRestart = Math.floor(
      (new Date().getTime() - serverStartTime) / 1000,
    );

    response.end(
      JSON.stringify({
        secondsSinceLastRestart,
        searchesSinceLastRestart,
        searchesPerSecond: searchesSinceLastRestart / secondsSinceLastRestart,
      }),
    );
  });
}

function searchEndpointServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  const rateLimiter = new RateLimiterMemory({
    points: 2,
    duration: 10,
  });

  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/search")) return next();

    const { searchParams } = new URL(
      request.url,
      `http://${request.headers.host}`,
    );

    const token = searchParams.get("token");

    if (!token || token !== getSearchToken()) {
      response.statusCode = 401;
      response.end("Unauthorized.");
      return;
    }

    const query = searchParams.get("q");

    if (!query) {
      response.statusCode = 400;
      response.end("Missing the query parameter.");
      return;
    }

    const limitParam = searchParams.get("limit");

    const limit =
      limitParam && Number(limitParam) > 0 ? Number(limitParam) : undefined;

    try {
      const remoteAddress = (
        (request.headers["x-forwarded-for"] as string) ||
        request.socket.remoteAddress ||
        "unknown"
      )
        .split(",")[0]
        .trim();

      await rateLimiter.consume(remoteAddress);
    } catch (error) {
      response.statusCode = 429;
      response.end("Too many requests.");
      return;
    }

    const searchResults = await fetchSearXNG(query, limit);

    searchesSinceLastRestart++;

    response.end(JSON.stringify(searchResults));
  });
}

function cacheServerHook<T extends ViteDevServer | PreviewServer>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (
      request.url === "/" ||
      request.url.startsWith("/?") ||
      request.url.endsWith(".html")
    ) {
      response.setHeader("Cache-Control", "no-cache");
    } else {
      response.setHeader("Cache-Control", "public, max-age=86400");
    }

    next();
  });
}

async function fetchSearXNG(query: string, limit?: number) {
  try {
    const url = new URL("http://127.0.0.1:8080/search");

    url.search = new URLSearchParams({
      q: query,
      language: "auto",
      safesearch: "0",
      format: "json",
    }).toString();

    const response = await fetch(url);

    let { results } = (await response.json()) as {
      results: { url: string; title: string; content: string }[];
    };

    const searchResults: [title: string, content: string, url: string][] = [];

    if (results) {
      if (limit && limit > 0) {
        results = results.slice(0, limit);
      }

      const uniqueUrls = new Set<string>();

      for (const result of results) {
        if (!result.content || uniqueUrls.has(result.url)) continue;

        const stripHtmlTags = (str: string) => str.replace(/<[^>]*>?/gm, "");

        const content = stripHtmlTags(result.content).trim();

        if (content === "") continue;

        const title = stripHtmlTags(result.title);

        const url = result.url;

        searchResults.push([title, content, url]);

        uniqueUrls.add(url);
      }
    }

    return searchResults;
  } catch (e) {
    console.error(e);
    return [];
  }
}

function getSearchTokenFilePath() {
  return path.resolve(temporaryDirectory, "minisearch-token");
}

function regenerateSearchToken() {
  const newToken = Math.random().toString(36).substring(2);
  writeFileSync(getSearchTokenFilePath(), newToken);
}

function getSearchToken() {
  if (!existsSync(getSearchTokenFilePath())) regenerateSearchToken();
  return readFileSync(getSearchTokenFilePath(), "utf8");
}
