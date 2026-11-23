import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./searchToken", () => ({
  getSearchToken: () => "test-search-token",
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function requestConfig() {
  const { configEndpointServerHook } = await import(
    "./configEndpointServerHook"
  );
  const use = vi.fn();
  configEndpointServerHook({ middlewares: { use } } as never);
  const handler = use.mock.calls[0][0] as (
    req: { url: string; method: string },
    res: { setHeader: unknown; end: (body: string) => void },
    next: () => void,
  ) => void;
  const end = vi.fn();
  handler(
    { url: "/api/config", method: "GET" },
    { setHeader: vi.fn(), end },
    vi.fn(),
  );
  return JSON.parse(end.mock.calls[0][0] as string) as {
    accessKeysEnabled: boolean;
  };
}

describe("configEndpointServerHook", () => {
  it("reports access keys as enabled when a key is configured", async () => {
    vi.stubEnv("ACCESS_KEYS", "key1, key2");
    expect((await requestConfig()).accessKeysEnabled).toBe(true);
  });

  it("reports access keys as disabled when none are configured", async () => {
    vi.stubEnv("ACCESS_KEYS", "");
    expect((await requestConfig()).accessKeysEnabled).toBe(false);
  });

  it("reports access keys as disabled when the list holds no usable key", async () => {
    vi.stubEnv("ACCESS_KEYS", " , ,");
    expect((await requestConfig()).accessKeysEnabled).toBe(false);
  });
});
