import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: resolve(__dirname, "client/setupTests.ts"),
    alias: {
      "@": resolve(__dirname, "client"),
      "@/modules": resolve(__dirname, "client/modules"),
      "@/components": resolve(__dirname, "client/components"),
      "@/hooks": resolve(__dirname, "client/hooks"),
      "@shared": resolve(__dirname, "shared"),
      "@root": resolve(__dirname),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "json-summary"],
      include: ["client/**/*.{tsx,ts,jsx,js}"],
      exclude: ["client/dist/**"],
    },
  },
  define: {
    VITE_WEBLLM_DEFAULT_F16_MODEL_ID: JSON.stringify("model-f16"),
    VITE_WEBLLM_DEFAULT_F32_MODEL_ID: JSON.stringify("model-f32"),
    VITE_WLLAMA_DEFAULT_MODEL_ID: JSON.stringify("wllama-model"),
    VITE_DEFAULT_INFERENCE_TYPE: JSON.stringify("default"),
    VITE_INTERNAL_API_ENABLED: JSON.stringify("false"),
    VITE_INTERNAL_API_NAME: JSON.stringify("internal-api"),
    VITE_BUILD_DATE_TIME: JSON.stringify(Date.now()),
    VITE_COMMIT_SHORT_HASH: JSON.stringify("test-hash"),
  },
});
