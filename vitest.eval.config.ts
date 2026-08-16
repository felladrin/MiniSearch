import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Runs the offline eval integration tests in the node environment. Kept
 * separate from vitest.config.ts because the retrieval eval loads the real
 * ONNX reranker (and the answer eval makes network calls) and must not load
 * the jsdom-only client setup file.
 *
 * The alias block mirrors vitest.config.ts so module resolution matches what
 * `tsc -p tsconfig.eval.json` (which reads `paths` from the base tsconfig)
 * already validated. Without it the eval could type-check green and then fail
 * at runtime on an alias it can't resolve.
 *
 *   npx vitest run --config vitest.eval.config.ts            # all eval tests
 *   npx vitest run --config vitest.eval.config.ts retrieval  # retrieval only
 *   npx vitest run --config vitest.eval.config.ts answer     # answer only
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["eval/**/*.integration.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 900_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "client"),
      "@/modules": resolve(__dirname, "client/modules"),
      "@/components": resolve(__dirname, "client/components"),
      "@/hooks": resolve(__dirname, "client/hooks"),
      "@shared": resolve(__dirname, "shared"),
      "@root": resolve(__dirname),
    },
  },
});
