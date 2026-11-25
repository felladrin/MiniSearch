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
    parentWindowOrigins: string[];
    internalApiContextLength: number;
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

  it("serves the configured parent window origins as a list", async () => {
    vi.stubEnv(
      "PARENT_WINDOW_ORIGINS",
      "https://huggingface.co, https://example.com,",
    );
    expect((await requestConfig()).parentWindowOrigins).toEqual([
      "https://huggingface.co",
      "https://example.com",
    ]);
  });

  it("serves Hugging Face as the parent window origin when the variable is unset", async () => {
    vi.stubEnv("PARENT_WINDOW_ORIGINS", undefined);
    expect((await requestConfig()).parentWindowOrigins).toEqual([
      "https://huggingface.co",
    ]);
  });

  it("serves no parent window origin when the variable is empty", async () => {
    vi.stubEnv("PARENT_WINDOW_ORIGINS", "");
    expect((await requestConfig()).parentWindowOrigins).toEqual([]);
  });

  it("serves the configured internal API context length", async () => {
    vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH", "32768");
    expect((await requestConfig()).internalApiContextLength).toBe(32768);
  });

  it("serves a 128K internal API context length when the variable is unset", async () => {
    vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH", undefined);
    expect((await requestConfig()).internalApiContextLength).toBe(131072);
  });

  it("logs an internal API context length that is not a positive integer and serves 128K", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubEnv("INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH", "128k");
    expect((await requestConfig()).internalApiContextLength).toBe(131072);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('("128k")'),
    );
    consoleError.mockRestore();
  });
});
