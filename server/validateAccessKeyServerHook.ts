import { PreviewServer, ViteDevServer } from "vite";

export function validateAccessKeyServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url !== "/api/validate-access-key" || req.method !== "POST") {
      return next();
    }

    const accessKeys = process.env.ACCESS_KEYS?.split(",") ?? [];

    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      const { accessKey } = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ valid: accessKeys.includes(accessKey) }));
    });
  });
}
