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
  searchToken: "a".repeat(64),
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

  // The search token is per-process, so a restart leaves this page holding one
  // the server never issued; invalidating is how a loaded page gets the new one.
  it("refetches after the cache is invalidated", async () => {
    const { getConfig, invalidateConfig } = await importConfigModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(serverConfig),
    });

    await getConfig();

    const rotatedConfig = { ...serverConfig, searchToken: "b".repeat(64) };
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(rotatedConfig),
    });

    invalidateConfig();

    await expect(getConfig()).resolves.toEqual(rotatedConfig);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // Otherwise the discarded response lands in the cache a moment after the
  // invalidation, and the page goes back to hashing the token it just dropped.
  it("does not let a fetch started before the invalidation repopulate the cache", async () => {
    const { getConfig, invalidateConfig } = await importConfigModule();
    let resolveFirstFetch: (config: ServerConfig) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstFetch = (config) =>
          resolve({ ok: true, json: vi.fn().mockResolvedValue(config) });
      }),
    );

    const firstCall = getConfig();
    invalidateConfig();
    resolveFirstFetch(serverConfig);
    await expect(firstCall).resolves.toEqual(serverConfig);

    const rotatedConfig = { ...serverConfig, searchToken: "b".repeat(64) };
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(rotatedConfig),
    });

    await expect(getConfig()).resolves.toEqual(rotatedConfig);
    expect(mockFetch).toHaveBeenCalledTimes(2);
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
