import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadAllowedHosts() {
  const { default: defineViteConfig } = await import("../vite.config");
  const config = await (
    defineViteConfig as unknown as (env: {
      command: string;
      mode: string;
    }) => Promise<{ preview?: { allowedHosts?: unknown } }>
  )({ command: "serve", mode: "test" });
  return config.preview?.allowedHosts;
}

describe("vite.config preview allowedHosts", () => {
  it("allows any host when ALLOWED_HOSTS is not set", async () => {
    vi.stubEnv("ALLOWED_HOSTS", "");
    expect(await loadAllowedHosts()).toBe(true);
  });

  it("accepts a host that follows a comma and a space", async () => {
    vi.stubEnv("ALLOWED_HOSTS", "localhost, example.com");
    expect(await loadAllowedHosts()).toEqual(["localhost", "example.com"]);
  });

  it("does not open the preview server to every host for a list without hosts", async () => {
    vi.stubEnv("ALLOWED_HOSTS", ",");
    expect(await loadAllowedHosts()).toEqual([]);
  });
});
