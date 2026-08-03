import { defineConfig, devices } from "@playwright/test";

// ponytail: CI starts docker-compose.production.yml on :7860 (see reusable-check-docker.yml)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:7860";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
