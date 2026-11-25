import { afterEach, describe, expect, it, vi } from "vitest";
import { getInternalApiConfig } from "./internalApiConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubEnvironment(values: Record<string, string | undefined>) {
  for (const variable of [
    "INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL",
    "INTERNAL_OPENAI_COMPATIBLE_API_KEY",
    "INTERNAL_OPENAI_COMPATIBLE_API_MODEL",
    "INTERNAL_OPENAI_COMPATIBLE_API_NAME",
    "INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH",
    "INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT",
    "MODEL_DEFAULT_MAX_TOKENS",
    "MODEL_REQUEST_TIMEOUT_MS",
  ]) {
    vi.stubEnv(variable, values[variable]);
  }
}

describe("getInternalApiConfig", () => {
  it("returns the defaults when nothing is set", () => {
    stubEnvironment({});

    expect(getInternalApiConfig()).toEqual({
      baseUrl: undefined,
      apiKey: undefined,
      models: [],
      name: "Internal API",
      contextLength: 131072,
      reasoningEffort: undefined,
      maxOutputTokens: 8192,
      requestTimeoutMs: 30000,
    });
  });

  it("reads every variable that is set", () => {
    stubEnvironment({
      INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL: "https://llm.example/v1",
      INTERNAL_OPENAI_COMPATIBLE_API_KEY: "test-key",
      INTERNAL_OPENAI_COMPATIBLE_API_MODEL: " model-a , model-b ,",
      INTERNAL_OPENAI_COMPATIBLE_API_NAME: "Company LLM",
      INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH: "32768",
      INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT: " low ",
      MODEL_DEFAULT_MAX_TOKENS: "4096",
      MODEL_REQUEST_TIMEOUT_MS: "60000",
    });

    expect(getInternalApiConfig()).toEqual({
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      models: ["model-a", "model-b"],
      name: "Company LLM",
      contextLength: 32768,
      reasoningEffort: "low",
      maxOutputTokens: 4096,
      requestTimeoutMs: 60000,
    });
  });

  // `parseInt` read "8k" as 8, so a typo cut every answer to 8 tokens.
  it.each(["8k", "abc", "0", "-1", "1.5"])(
    "replaces %j with the default and logs it",
    (value) => {
      stubEnvironment({ MODEL_DEFAULT_MAX_TOKENS: value });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(getInternalApiConfig().maxOutputTokens).toBe(8192);
      expect(consoleError).toHaveBeenCalledWith(
        `MODEL_DEFAULT_MAX_TOKENS is not a positive integer ("${value}"); using 8192.`,
      );
    },
  );

  it("logs a bad value once, not on every read", () => {
    stubEnvironment({ MODEL_REQUEST_TIMEOUT_MS: "30s" });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    getInternalApiConfig();
    getInternalApiConfig();

    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
