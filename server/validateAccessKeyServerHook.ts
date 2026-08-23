import { argon2Verify } from "hash-wasm";
import type { PreviewServer, ViteDevServer } from "vite";
import { ARGON2_HASH_PREFIX } from "../shared/argon2Parameters.ts";
import { consumeRateLimitPoint } from "./verifyTokenAndRateLimit.ts";

/** POST /api/validate-access-key: checks an argon2id hash against the configured `ACCESS_KEYS`. */
export function validateAccessKeyServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url !== "/api/validate-access-key" || req.method !== "POST") {
      return next();
    }

    // Consume a rate-limit point before the argon2 loop. A wrong hash costs one
    // full argon2 verification per configured key, so nothing may bound that
    // work other than the limiter - the same lever the search token path closes.
    // It shares the search path's limiter, so a caller cannot hold a second
    // budget. The answer is a 429, not a `{ valid: false }`, so a client can
    // tell "too many attempts" from "wrong key".
    if (!(await consumeRateLimitPoint(req))) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Too many requests." }));
      return;
    }

    const accessKeys = process.env.ACCESS_KEYS?.split(",") ?? [];

    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const { accessKeyHash } = JSON.parse(body);

        // The client hashes with the shared parameters, so a hash carrying any
        // other block cannot be valid against this server. Checking before
        // argon2Verify refuses a mismatch for free, before any allocation or
        // work starts. Without it a caller could embed m=4194304,t=1000,p=1 and
        // force a multi-gigabyte allocation per configured key.
        if (
          typeof accessKeyHash !== "string" ||
          !accessKeyHash.startsWith(ARGON2_HASH_PREFIX)
        ) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ valid: false }));
          return;
        }

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
