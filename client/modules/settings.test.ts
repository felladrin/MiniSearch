import { describe, expect, it } from "vitest";
import type { ServerConfig } from "./config";
import {
  applyServerConfig,
  defaultSettings,
  getDefaultCpuThreads,
  getInferenceTypes,
} from "./settings";

const mockConfig: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 0,
  wllamaDefaultModelId: "littlelamb-290m",
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
    expect(defaultSettings.enablePageContentFetch).toBe(true);
    expect(defaultSettings.inferenceType).toBeDefined();
  });

  it("keeps the feature-tips flag out of settings", () => {
    // The menu's feature-tips hint persists in its own localStorage channel
    // (showFeatureTipsPubSub). If it were a settings field, the settings forms
    // (which snapshot settings at mount and write the whole object back) would
    // resurrect a dismissed hint on the next toggle.
    expect(defaultSettings).not.toHaveProperty("showFeatureTips");
  });

  describe("getDefaultCpuThreads", () => {
    it("should always leave at least one thread on tiny machines", () => {
      expect(getDefaultCpuThreads(1)).toBe(1);
      expect(getDefaultCpuThreads(2)).toBe(1);
    });

    it("should scale with the machine instead of using a fixed ceiling", () => {
      expect(getDefaultCpuThreads(4)).toBe(2);
      expect(getDefaultCpuThreads(8)).toBe(4);
      expect(getDefaultCpuThreads(16)).toBe(8);
      expect(getDefaultCpuThreads(32)).toBe(16);
      expect(getDefaultCpuThreads(128)).toBe(64);
    });

    it("should round down on an odd processor count", () => {
      expect(getDefaultCpuThreads(3)).toBe(1);
      expect(getDefaultCpuThreads(9)).toBe(4);
    });

    it("should never oversubscribe the logical processors", () => {
      for (const cores of [1, 2, 3, 4, 8, 12, 16, 24, 32, 64, 256]) {
        expect(getDefaultCpuThreads(cores)).toBeLessThanOrEqual(
          Math.max(1, Math.floor(cores / 2)),
        );
      }
    });
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
