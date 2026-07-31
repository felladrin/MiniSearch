import { describe, expect, it } from "vitest";
import type { ServerConfig } from "./config";
import {
  applyServerConfig,
  defaultSettings,
  getInferenceTypes,
} from "./settings";

const mockConfig: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 0,
  wllamaDefaultModelId: "qwen-3-0.6b",
  internalApiEnabled: false,
  internalApiName: "Internal API",
  defaultInferenceType: "browser",
};

describe("Settings Module", () => {
  it("should have correct default settings values", () => {
    expect(defaultSettings.showEnableAiResponsePrompt).toBe(true);
    expect(defaultSettings.enableAiResponse).toBe(false);
    expect(defaultSettings.enableImageSearch).toBe(true);
    expect(defaultSettings.searchResultsLimit).toBe(15);
    expect(defaultSettings.inferenceType).toBeDefined();
  });

  it("should include core inference types", () => {
    const values = getInferenceTypes(mockConfig).map((i) => i.value);
    expect(values).toContain("browser");
    expect(values).toContain("openai");
    expect(values).toContain("horde");
  });

  it("should include internal API when enabled in config", () => {
    const configWithInternalApi = {
      ...mockConfig,
      internalApiEnabled: true,
      internalApiName: "Custom LLM",
    };
    const values = getInferenceTypes(configWithInternalApi).map((i) => i.value);
    expect(values).toContain("internal");
    expect(
      getInferenceTypes(configWithInternalApi).find(
        (i) => i.value === "internal",
      )?.label,
    ).toBe("Custom LLM");
  });

  it("should exclude internal API when disabled in config", () => {
    const values = getInferenceTypes(mockConfig).map((i) => i.value);
    expect(values).not.toContain("internal");
  });

  it("should apply server config defaults to a profile that was never saved", () => {
    const config = {
      ...mockConfig,
      wllamaDefaultModelId: "custom-model",
      defaultInferenceType: "internal",
    };
    const applied = applyServerConfig(defaultSettings, config, false);
    expect(applied.wllamaModelId).toBe("custom-model");
    expect(applied.inferenceType).toBe("internal");
  });

  it("should preserve stored settings that differ from the server defaults", () => {
    const config = {
      ...mockConfig,
      wllamaDefaultModelId: "different-model",
      defaultInferenceType: "openai",
    };
    const userSettings = {
      ...defaultSettings,
      wllamaModelId: "user-picked-model",
      inferenceType: "horde",
    };
    const applied = applyServerConfig(userSettings, config, true);
    expect(applied.wllamaModelId).toBe("user-picked-model");
    expect(applied.inferenceType).toBe("horde");
  });

  it("should preserve a stored setting that happens to equal a shipped default", () => {
    const config = {
      ...mockConfig,
      wllamaDefaultModelId: "admin-preferred-model",
      defaultInferenceType: "internal",
    };
    const applied = applyServerConfig(defaultSettings, config, true);
    expect(applied.wllamaModelId).toBe(defaultSettings.wllamaModelId);
    expect(applied.inferenceType).toBe(defaultSettings.inferenceType);
  });
});
