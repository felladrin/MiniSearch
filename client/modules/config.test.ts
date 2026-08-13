import type { ServerConfig } from "@shared/serverConfig";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const serverConfig: ServerConfig = {
  accessKeysEnabled: true,
  accessKeyTimeoutHours: 24,
  wllamaDefaultModelId: "some-model",
  internalApiEnabled: true,
  internalApiName: "Custom LLM",
  defaultInferenceType: "internal",
  pageContentReadingEnabled: true,
};

/** Imports a fresh copy of the module so its cache starts empty. */
async function importConfigModule() {
  vi.resetModules();
  return import("./config");
}

describe("Config Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the config served by the endpoint", async () => {
    const { getConfig } = await importConfigModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(serverConfig),
    });

    await expect(getConfig()).resolves.toEqual(serverConfig);
  });

  it("fetches only once across concurrent and repeated calls", async () => {
    const { getConfig } = await importConfigModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(serverConfig),
    });

    await Promise.all([getConfig(), getConfig()]);
    await getConfig();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Resolving with defaults here would report `accessKeysEnabled: false` to the
  // app shell, skipping the access key page whenever the endpoint hiccups.
  it("rejects rather than reporting defaults when the endpoint fails", async () => {
    const { getConfig } = await importConfigModule();
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(getConfig()).rejects.toThrow("500");
  });

  it("rejects when the request cannot be made at all", async () => {
    const { getConfig } = await importConfigModule();
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(getConfig()).rejects.toThrow("Network error");
  });

  it("retries after a failure instead of caching it", async () => {
    const { getConfig } = await importConfigModule();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(getConfig()).rejects.toThrow("Network error");

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(serverConfig),
    });

    await expect(getConfig()).resolves.toEqual(serverConfig);
  });
});
