import { defineConfig } from "vitest/config";

/**
 * Runs the reranker integration test, which loads the real ONNX model. Kept
 * separate from vitest.config.ts because it needs the node environment and must
 * not load the jsdom-only client setup file.
 *
 *   npx vitest run --config vitest.integration.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.integration.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 900_000,
  },
});
