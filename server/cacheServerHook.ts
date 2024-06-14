import { PreviewServer, ViteDevServer } from "vite";
import { match, Pattern } from "ts-pattern";

export function cacheServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(async (request, response, next) => {
    response.setHeader(
      ...match<string, [name: string, value: string]>(request.url)
        .with(Pattern.string.endsWith(".woff2"), () => [
          "Cache-Control",
          "public, max-age=31536000, immutable",
        ])
        .with(
          Pattern.union(
            "/",
            Pattern.string.startsWith("/?"),
            Pattern.string.endsWith(".html"),
          ),
          () => ["Cache-Control", "no-cache"],
        )
        .otherwise(() => ["Cache-Control", "public, max-age=86400"]),
    );

    next();
  });
}
