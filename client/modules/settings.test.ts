import {
  CITATION_EXAMPLE,
  DEFAULT_SYSTEM_PROMPT,
} from "@shared/defaultSystemPrompt";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_CONFIG, type ServerConfig } from "./config";
import {
  applyServerConfig,
  defaultSettings,
  getDefaultCpuThreads,
  getInferenceTypes,
  upgradeUntouchedSystemPrompt,
} from "./settings";

const mockConfig: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 0,
  wllamaDefaultModelId: "littlelamb-290m",
  wllamaDefaultGpuModelId: "gemma-3-4b",
  internalApiEnabled: false,
  internalApiName: "Internal API",
  defaultInferenceType: "browser",
  searchToken: "a".repeat(64),
  parentWindowOrigins: ["https://huggingface.co"],
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
      internalApiEnabled: true,
      defaultInferenceType: "internal",
    };
    const applied = applyServerConfig(defaultSettings, config, false, false);
    expect(applied.wllamaModelId).toBe("custom-model");
    expect(applied.inferenceType).toBe("internal");
  });

  it("should seed the GPU model default when the browser has WebGPU", () => {
    const config = {
      ...mockConfig,
      wllamaDefaultModelId: "cpu-model",
      wllamaDefaultGpuModelId: "gpu-model",
    };
    expect(
      applyServerConfig(defaultSettings, config, false, true).wllamaModelId,
    ).toBe("gpu-model");
    expect(
      applyServerConfig(defaultSettings, config, false, false).wllamaModelId,
    ).toBe("cpu-model");
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
    const applied = applyServerConfig(userSettings, config, true, true);
    expect(applied.wllamaModelId).toBe("user-picked-model");
    expect(applied.inferenceType).toBe("horde");
  });

  it("should preserve a stored setting that happens to equal a shipped default", () => {
    const config = {
      ...mockConfig,
      wllamaDefaultModelId: "admin-preferred-model",
      defaultInferenceType: "internal",
    };
    const applied = applyServerConfig(defaultSettings, config, true, true);
    expect(applied.wllamaModelId).toBe(defaultSettings.wllamaModelId);
    expect(applied.inferenceType).toBe(defaultSettings.inferenceType);
  });

  describe("an inference type the server no longer offers", () => {
    const storedInternal = { ...defaultSettings, inferenceType: "internal" };

    it("switches a stored type to the server default", () => {
      const config = { ...mockConfig, defaultInferenceType: "openai" };
      const applied = applyServerConfig(storedInternal, config, true, true);
      expect(applied.inferenceType).toBe("openai");
      expect(applied.wllamaModelId).toBe(storedInternal.wllamaModelId);
    });

    it("uses the shipped default when the server default is not offered either", () => {
      // DEFAULT_INFERENCE_TYPE=internal left in place after the internal API
      // was removed: the server still names "internal" as its default.
      const config = { ...mockConfig, defaultInferenceType: "internal" };
      expect(
        applyServerConfig(storedInternal, config, true, true).inferenceType,
      ).toBe("browser");
      expect(
        applyServerConfig(defaultSettings, config, false, true).inferenceType,
      ).toBe("browser");
    });

    it("keeps a stored type the server still offers", () => {
      const config = { ...mockConfig, internalApiEnabled: true };
      expect(applyServerConfig(storedInternal, config, true, true)).toBe(
        storedInternal,
      );
    });

    it("keeps a stored type when the server config could not be loaded", () => {
      // The fallback is not the server's answer, so it must not overwrite a
      // choice that the next successful load may confirm.
      expect(
        applyServerConfig(storedInternal, FALLBACK_CONFIG, true, true),
      ).toBe(storedInternal);
    });

    it("always leaves the settings select with a matching option", () => {
      for (const internalApiEnabled of [true, false]) {
        for (const defaultInferenceType of ["browser", "internal", "unknown"]) {
          for (const stored of [
            "browser",
            "openai",
            "horde",
            "internal",
            "gone",
          ]) {
            const config = {
              ...mockConfig,
              internalApiEnabled,
              defaultInferenceType,
            };
            const offered = getInferenceTypes(config).map(
              (t) => t.value as string,
            );
            for (const wasStored of [true, false]) {
              const applied = applyServerConfig(
                { ...defaultSettings, inferenceType: stored },
                config,
                wasStored,
                true,
              );
              expect(offered).toContain(applied.inferenceType);
            }
          }
        }
      }
    });
  });
});

describe("legacy voice migration", () => {
  const load = async (stored: Record<string, unknown> | null) => {
    localStorage.clear();
    if (stored) localStorage.setItem("settings", JSON.stringify(stored));
    vi.resetModules();
    return import("./settings");
  };

  it("keeps the system engine for a profile that picked an OS voice", async () => {
    const { defaultSettings: settings } = await load({
      selectedVoiceId: "urn:moz-tts:speechd:English (America)",
    });

    expect(settings.textToSpeechEngine).toBe("system");
  });

  it("uses the local engine for a profile that never picked a voice", async () => {
    const { defaultSettings: settings } = await load({ selectedVoiceId: "" });

    expect(settings.textToSpeechEngine).toBe("local");
  });

  it("leaves an already-migrated profile alone", async () => {
    const { defaultSettings: settings } = await load({
      selectedVoiceId: "urn:moz-tts:speechd:English (America)",
      textToSpeechEngine: "local",
    });

    expect(settings.textToSpeechEngine).toBe("local");
  });

  it("uses the local engine for a fresh profile", async () => {
    const { defaultSettings: settings } = await load(null);

    expect(settings.textToSpeechEngine).toBe("local");
  });
});

describe("upgradeUntouchedSystemPrompt", () => {
  const previousDefault = DEFAULT_SYSTEM_PROMPT.replace(
    CITATION_EXAMPLE,
    "[youtube.com](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
  );

  it("replaces a saved prompt that is exactly the previous default", () => {
    const upgraded = upgradeUntouchedSystemPrompt({
      ...defaultSettings,
      systemPrompt: previousDefault,
    });
    expect(upgraded.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("keeps a prompt the user edited", () => {
    const edited = `${previousDefault}\nAlways answer in haiku.`;
    const kept = upgradeUntouchedSystemPrompt({
      ...defaultSettings,
      systemPrompt: edited,
    });
    expect(kept.systemPrompt).toBe(edited);
  });
});
