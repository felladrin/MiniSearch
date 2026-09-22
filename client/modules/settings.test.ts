import { describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "./config";
import {
  applyServerConfig,
  defaultSettings,
  getDefaultCpuThreads,
  getInferenceTypes,
  prefersLocalDictationModel,
} from "./settings";

const mockConfig: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 0,
  wllamaDefaultModelId: "littlelamb-290m",
  internalApiEnabled: false,
  internalApiName: "Internal API",
  defaultInferenceType: "browser",
  searchToken: "a".repeat(64),
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

  describe("prefersLocalDictationModel", () => {
    it("is true when the primary language is English", () => {
      expect(prefersLocalDictationModel("en")).toBe(true);
      expect(prefersLocalDictationModel("en-US")).toBe(true);
      expect(prefersLocalDictationModel("en-GB")).toBe(true);
      expect(prefersLocalDictationModel("EN")).toBe(true);
    });

    it("is false when the primary language is not English", () => {
      expect(prefersLocalDictationModel("pt")).toBe(false);
      expect(prefersLocalDictationModel("pt-BR")).toBe(false);
      expect(prefersLocalDictationModel("de-DE")).toBe(false);
    });

    it("compares the subtag exactly instead of by prefix", () => {
      // `startsWith("en")` would match historical subtags like Middle
      // English, which no browser UI actually uses.
      expect(prefersLocalDictationModel("enm")).toBe(false);
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

describe("dictation model default", () => {
  const loadWithLanguage = async (language: string) => {
    // Scoped restore rather than vi.restoreAllMocks(): the setup file installs
    // matchMedia as a mock, and a broad restore would take it down with the
    // language spy for anything that runs after this describe.
    const languageSpy = vi
      .spyOn(navigator, "language", "get")
      .mockReturnValue(language);
    vi.resetModules();
    const module = await import("./settings");
    languageSpy.mockRestore();
    return module;
  };

  it("starts a non-English profile on the browser recognizer", async () => {
    // The wiring from prefersLocalDictationModel into defaultSettings: a
    // literal `true` here would leave every non-English first visit on a
    // model that cannot transcribe their speech, while the pure function
    // kept passing its own tests.
    const { defaultSettings: settings } = await loadWithLanguage("pt-BR");

    expect(settings.enableLocalDictationModel).toBe(false);
  });

  it("starts an English profile on the on-device model", async () => {
    const { defaultSettings: settings } = await loadWithLanguage("en-US");

    expect(settings.enableLocalDictationModel).toBe(true);
  });
});
