import { PreviewServer, ViteDevServer } from "vite";
import { match, Pattern } from "ts-pattern";

export function cacheServerHook<T extends ViteDevServer | PreviewServer>(
  server: T,
) {
  server.middlewares.use(async (request, response, next) => {
    const cacheControlValue = match(request.url)
      .with(
        Pattern.string.startsWith("/assets/"),
        () => "public, max-age=31536000, immutable",
      )
      .with(
        Pattern.union(
          "/",
          Pattern.string.startsWith("/?"),
          Pattern.string.endsWith(".html"),
        ),
        () => "no-cache",
      )
      .otherwise(() => "public, max-age=86400, must-revalidate");

    response.setHeader("Cache-Control", cacheControlValue);

    next();
  });
}
