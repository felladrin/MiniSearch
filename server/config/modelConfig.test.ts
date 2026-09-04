import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getModelConfig } from "./modelConfig.ts";

const modelEnvironmentVariables = [
  "MODEL_MAX_RETRIES",
  "MODEL_BASE_BACKOFF_MS",
  "MODEL_MAX_BACKOFF_MS",
  "MODEL_REQUEST_TIMEOUT_MS",
  "MODEL_MAX_CONCURRENT_REQUESTS",
  "MODEL_DEFAULT_MAX_TOKENS",
  "MODEL_TEMPERATURE",
  "MODEL_TOP_P",
] as const;

const originalModelEnvironment = new Map(
  modelEnvironmentVariables.map((variable) => [
    variable,
    process.env[variable],
  ]),
);

function clearModelEnvironment() {
  for (const variable of modelEnvironmentVariables) {
    delete process.env[variable];
  }
}

function restoreModelEnvironment() {
  for (const variable of modelEnvironmentVariables) {
    const originalValue = originalModelEnvironment.get(variable);
    if (originalValue === undefined) delete process.env[variable];
    else process.env[variable] = originalValue;
  }
}

describe("getModelConfig", () => {
  beforeEach(clearModelEnvironment);

  afterEach(restoreModelEnvironment);

  it("returns the default model configuration", () => {
    expect(getModelConfig()).toEqual({
      maxRetries: 5,
      baseBackoffMs: 100,
      maxBackoffMs: 5000,
      requestTimeoutMs: 30000,
      maxConcurrentRequests: 10,
      defaultMaxTokens: 2048,
      temperature: 0.7,
      topP: 0.9,
    });
  });

  it("keeps the defaults within the supported request ranges", () => {
    const config = getModelConfig();

    expect(config.maxRetries).toBeGreaterThanOrEqual(0);
    expect(config.baseBackoffMs).toBeGreaterThan(0);
    expect(config.maxBackoffMs).toBeGreaterThanOrEqual(config.baseBackoffMs);
    expect(config.requestTimeoutMs).toBeGreaterThan(0);
    expect(config.maxConcurrentRequests).toBeGreaterThan(0);
    expect(config.defaultMaxTokens).toBeGreaterThan(0);
    expect(config.temperature).toBeGreaterThanOrEqual(0);
    expect(config.temperature).toBeLessThanOrEqual(2);
    expect(config.topP).toBeGreaterThan(0);
    expect(config.topP).toBeLessThanOrEqual(1);
  });

  it("parses every supported environment override", () => {
    process.env.MODEL_MAX_RETRIES = "2";
    process.env.MODEL_BASE_BACKOFF_MS = "250";
    process.env.MODEL_MAX_BACKOFF_MS = "10000";
    process.env.MODEL_REQUEST_TIMEOUT_MS = "45000";
    process.env.MODEL_MAX_CONCURRENT_REQUESTS = "4";
    process.env.MODEL_DEFAULT_MAX_TOKENS = "4096";
    process.env.MODEL_TEMPERATURE = "0.2";
    process.env.MODEL_TOP_P = "0.95";

    expect(getModelConfig()).toEqual({
      maxRetries: 2,
      baseBackoffMs: 250,
      maxBackoffMs: 10000,
      requestTimeoutMs: 45000,
      maxConcurrentRequests: 4,
      defaultMaxTokens: 4096,
      temperature: 0.2,
      topP: 0.95,
    });
  });

  it("uses the default for an empty environment variable", () => {
    process.env.MODEL_MAX_RETRIES = "";
    process.env.MODEL_TEMPERATURE = "";

    expect(getModelConfig()).toMatchObject({
      maxRetries: 5,
      temperature: 0.7,
    });
  });
});
