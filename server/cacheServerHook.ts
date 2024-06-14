import { PreviewServer, ViteDevServer } from "vite";
import { match, P } from "ts-pattern";

export function cacheServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(async (request, response, next) => {
    response.setHeader(
      ...match<string, [name: string, value: string]>(request.url)
        .with(P.string.endsWith(".woff2"), () => [
          "Cache-Control",
          "public, max-age=31536000, immutable",
        ])
        .with(
          P.union("/", P.string.startsWith("/?"), P.string.endsWith(".html")),
          () => ["Cache-Control", "no-cache"],
        )
        .otherwise(() => ["Cache-Control", "public, max-age=86400"]),
    );

    next();
  });
}
