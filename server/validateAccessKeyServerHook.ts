import { argon2Verify } from "hash-wasm";
import type { PreviewServer, ViteDevServer } from "vite";

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

    req.on("end", async () => {
      try {
        const { accessKeyHash } = JSON.parse(body);
        let isValid = false;

        for (const key of accessKeys) {
          try {
            if (await argon2Verify({ password: key, hash: accessKeyHash })) {
              isValid = true;
              break;
            }
          } catch (error) {
            void error;
          }
        }

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ valid: isValid }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ valid: false, error: "Invalid request" }));
      }
    });
  });
}
