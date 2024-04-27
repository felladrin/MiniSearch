import { PreviewServer, ViteDevServer, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSSL from "@vitejs/plugin-basic-ssl";
import fetch from "node-fetch";
import { RateLimiterMemory } from "rate-limiter-flexible";

export default defineConfig(() => ({
  root: "./client",
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
      name: "configure-server-cache",
      configurePreviewServer: cacheServerHook,
    },
  ],
}));

function crossOriginServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use((_, response, next) => {
    crossOriginIsolationHeaders.forEach(({ key, value }) => {
      response.setHeader(key, value);
    });
    next();
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
    if (!request.url.startsWith("/search")) {
      next();
      return;
    }

    const remoteAddress = (
      (request.headers["x-forwarded-for"] as string) ||
      request.socket.remoteAddress ||
      ""
    )
      .split(",")[0]
      .trim();

    try {
      await rateLimiter.consume(remoteAddress);

      const { searchParams } = new URL(
        request.url,
        `http://${request.headers.host}`,
      );

      const query = searchParams.get("q");

      if (!query) {
        response.statusCode = 400;
        response.end("Missing the query parameter.");
        return;
      }

      const limitParam = searchParams.get("limit");

      const limit =
        limitParam && Number(limitParam) > 0 ? Number(limitParam) : undefined;

      const searchResults = await fetchSearXNG(query, limit);

      response.end(JSON.stringify(searchResults));
    } catch (error) {
      response.statusCode = 400;
      response.end("Too many requests.");
    }
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

/** Server headers for cross origin isolation, which enable clients to use `SharedArrayBuffer` on the Browser. */
export const crossOriginIsolationHeaders: { key: string; value: string }[] = [
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

async function fetchDuckDuckGo(query: string, limit?: number) {
  try {
    query = encodeURIComponent(query.replace(/"/g, '\\"'));
    const html = await fetch(`https://duckduckgo.com/?q=${query}`).then((res) =>
      res.text(),
    );
    const matches = html.match(/vqd=['"](\d+-\d+(?:-\d+)?)['"]/);
    const vqd = matches ? matches[1] : null;
    if (!vqd) {
      return [];
    }
    const url = `https://links.duckduckgo.com/d.js?q=${query}&o=json&vqd=${vqd}`;
    const res = await fetch(url).then((res) => res.text());
    const result = JSON.parse(res);
    const searchResults: [title: string, content: string, url: string][] = [];
    if (result.results) {
      let results = result.results;

      if (limit && limit > 0) {
        results = results.slice(0, limit);
      }

      for (const result of results) {
        if (result.n) continue;

        let content = result.a as string;

        if (!content || content === "") continue;

        const stripHtmlTags = (str: string) => str.replace(/<[^>]*>?/gm, "");

        const title = stripHtmlTags(result.t);
        content = stripHtmlTags(content);
        const url = result.u as string;

        searchResults.push([title, content, url]);
      }
    }

    return searchResults;
  } catch (e) {
    console.error(e);
    return [];
  }
}

export async function fetchSearXNG(query: string, limit?: number) {
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

    if (searchResults.length === 0) return fetchDuckDuckGo(query, limit);

    return searchResults;
  } catch (e) {
    console.error(e);
    return [];
  }
}
