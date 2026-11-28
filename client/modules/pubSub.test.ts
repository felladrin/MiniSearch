import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

beforeEach(() => {
  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const k in storage) delete storage[k];
    },
  });
  vi.clearAllMocks();
  vi.resetModules();
});

/**
 * Checks that a stored value the module cannot use fell back to its default,
 * was dropped from storage, and was logged.
 */
function expectUnusableStoredValue(
  key: string,
  read: () => unknown,
  fallback: unknown,
) {
  expect(read()).toEqual(fallback);
  expect(localStorage.getItem(key)).toBeNull();
  expect(addLogEntry).toHaveBeenCalledWith(
    `Discarded an unusable stored value for '${key}'`,
  );
}

describe("PubSub localStorage persistence", () => {
  it("updates query suggestions and persists to localStorage", async () => {
    const { updateQuerySuggestions, getQuerySuggestions } = await import(
      "./pubSub"
    );
    expect(getQuerySuggestions()).toEqual([]);
    const newSuggestions = ["apple", "banana"];
    updateQuerySuggestions(newSuggestions);
    expect(getQuerySuggestions()).toEqual(newSuggestions);
    const stored = JSON.parse(
      localStorage.getItem("querySuggestions") as string,
    );
    expect(stored).toEqual(newSuggestions);
  });

  it("updates settings and persists to localStorage", async () => {
    const { settingsPubSub } = await import("./pubSub");
    const [, , getCurrentSettings] = settingsPubSub;
    const defaultSettings = getCurrentSettings();
    expect(defaultSettings).toBeDefined();
    const [updateSettings] = settingsPubSub;
    const modified = { ...defaultSettings, enterToSubmit: false };
    updateSettings(modified);
    expect(getCurrentSettings()).toEqual(modified);
    const stored = JSON.parse(localStorage.getItem("settings") as string);
    expect(stored).toEqual(modified);
  });

  it("falls back to the default and drops the value when the stored JSON is corrupted", async () => {
    localStorage.setItem("menuExpandedAccordions", "{not valid json");
    const { menuExpandedAccordionsPubSub } = await import("./pubSub");
    expectUnusableStoredValue(
      "menuExpandedAccordions",
      () => menuExpandedAccordionsPubSub[2](),
      [],
    );
  });

  it("falls back to the default and drops the value when the stored JSON has the wrong type", async () => {
    localStorage.setItem("lastSearchTokenHash", "123");
    const { getLastSearchTokenHash } = await import("./pubSub");
    expectUnusableStoredValue(
      "lastSearchTokenHash",
      () => getLastSearchTokenHash(),
      "",
    );
  });

  it("falls back to the default and drops the value when the stored value is empty", async () => {
    localStorage.setItem("menuExpandedAccordions", "");
    const { menuExpandedAccordionsPubSub } = await import("./pubSub");
    expectUnusableStoredValue(
      "menuExpandedAccordions",
      () => menuExpandedAccordionsPubSub[2](),
      [],
    );
  });
});

describe("numeric settings never hold an empty string", () => {
  it("clearing the context length stores the default number", async () => {
    const { updateSettings, getSettings } = await import("./pubSub");
    const { defaultSettings } = await import("./settings");
    updateSettings({
      ...getSettings(),
      openAiContextLength: "" as unknown as number,
    });
    expect(getSettings().openAiContextLength).toBe(
      defaultSettings.openAiContextLength,
    );
    const stored = JSON.parse(localStorage.getItem("settings") as string);
    expect(stored.openAiContextLength).toBe(
      defaultSettings.openAiContextLength,
    );
  });

  it("clearing CPU threads, max entries or retention days stores the default number", async () => {
    const { updateSettings, getSettings } = await import("./pubSub");
    const { defaultSettings } = await import("./settings");
    updateSettings({
      ...getSettings(),
      cpuThreads: "" as unknown as number,
      historyMaxEntries: "" as unknown as number,
      historyRetentionDays: "" as unknown as number,
    });
    expect(getSettings().cpuThreads).toBe(defaultSettings.cpuThreads);
    expect(getSettings().historyMaxEntries).toBe(
      defaultSettings.historyMaxEntries,
    );
    expect(getSettings().historyRetentionDays).toBe(
      defaultSettings.historyRetentionDays,
    );
  });

  it("keeps history retention cleanup enabled when a stored retention is empty", async () => {
    const { defaultSettings } = await import("./settings");
    localStorage.setItem(
      "settings",
      JSON.stringify({ ...defaultSettings, historyRetentionDays: "" }),
    );
    const { getSettings } = await import("./pubSub");
    expect(getSettings().historyRetentionDays).toBeGreaterThan(0);
  });

  it("turns an unknown stored search language into the browser's", async () => {
    const { defaultSettings } = await import("./settings");
    localStorage.setItem(
      "settings",
      JSON.stringify({ ...defaultSettings, searchLanguage: "klingon" }),
    );
    const { getSettings } = await import("./pubSub");
    expect(getSettings().searchLanguage).toBe("browser");
  });

  it("turns an unknown stored time range into Anytime", async () => {
    const { defaultSettings } = await import("./settings");
    localStorage.setItem(
      "settings",
      JSON.stringify({ ...defaultSettings, searchTimeRange: "fortnight" }),
    );
    const { getSettings } = await import("./pubSub");
    expect(getSettings().searchTimeRange).toBe("any");
  });

  it("repairs a stored empty string on load without a migration", async () => {
    const { defaultSettings } = await import("./settings");
    localStorage.setItem(
      "settings",
      JSON.stringify({
        ...defaultSettings,
        openAiContextLength: "",
        cpuThreads: "",
        historyMaxEntries: "",
      }),
    );
    const { getSettings } = await import("./pubSub");
    expect(getSettings()).toMatchObject({
      openAiContextLength: defaultSettings.openAiContextLength,
      cpuThreads: defaultSettings.cpuThreads,
      historyMaxEntries: defaultSettings.historyMaxEntries,
    });
  });

  it("sends the default max_tokens and sizes the excerpt budget from the default when a stored context length is empty", async () => {
    const { defaultSettings } = await import("./settings");
    localStorage.setItem(
      "settings",
      JSON.stringify({
        ...defaultSettings,
        inferenceType: "openai",
        openAiContextLength: "",
      }),
    );
    const {
      getDefaultChatCompletionCreateParamsStreaming,
      getEffectiveContextSize,
    } = await import("./textGenerationUtilities");
    expect(
      (await getDefaultChatCompletionCreateParamsStreaming([])).max_tokens,
    ).toBe(defaultSettings.openAiContextLength);
    expect(await getEffectiveContextSize()).toBe(
      defaultSettings.openAiContextLength,
    );
  });
});

describe("settings hydration merges the stored profile into the defaults", () => {
  it("fills keys a stored profile predates, before anything renders", async () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({ enableAiResponse: true }),
    );
    const { getSettings } = await import("./pubSub");
    expect(getSettings().enableAiResponse).toBe(true);
    expect(getSettings().enablePageContentFetch).toBe(true);
  });

  it("hydrates a wrong-type key to its default and keeps a deliberate false", async () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({
        searchResultsLimit: "15",
        enablePageContentFetch: false,
        customKeyFromAnOlderBuild: "keep me",
      }),
    );
    const { getSettings } = await import("./pubSub");
    const settings = getSettings() as unknown as Record<string, unknown>;
    expect(settings.searchResultsLimit).toBe(15);
    expect(settings.enablePageContentFetch).toBe(false);
    expect(settings.customKeyFromAnOlderBuild).toBe("keep me");
  });

  it("leaves an array store exactly as stored", async () => {
    const stored = JSON.stringify(["ai", "history"]);
    localStorage.setItem("menuExpandedAccordions", stored);
    const { menuExpandedAccordionsPubSub } = await import("./pubSub");
    const [, , getMenuExpandedAccordions] = menuExpandedAccordionsPubSub;
    expect(getMenuExpandedAccordions()).toEqual(["ai", "history"]);
    expect(localStorage.getItem("menuExpandedAccordions")).toBe(stored);
  });

  it("does not write the hydrated value back to storage", async () => {
    const stored = JSON.stringify({ enableAiResponse: true });
    localStorage.setItem("settings", stored);
    await import("./pubSub");
    expect(localStorage.getItem("settings")).toBe(stored);
  });

  it("reports a usable stored object as stored user settings", async () => {
    localStorage.setItem(
      "settings",
      JSON.stringify({ enableAiResponse: true }),
    );
    const { hasStoredUserSettings } = await import("./pubSub");
    expect(hasStoredUserSettings).toBe(true);
  });

  it.each(["{not json", "[]", '"x"'])(
    "treats an unusable stored value (%s) as no stored settings, so the server defaults apply",
    async (stored) => {
      localStorage.setItem("settings", stored);
      const { hasStoredUserSettings } = await import("./pubSub");
      expect(hasStoredUserSettings).toBe(false);
      const { applyServerConfig, defaultSettings } = await import("./settings");
      const config = {
        accessKeysEnabled: false,
        accessKeyTimeoutHours: 0,
        wllamaDefaultModelId: "custom-model",
        wllamaDefaultGpuModelId: "gemma-3-4b",
        internalApiEnabled: false,
        internalApiName: "Internal API",
        internalApiContextLength: 131072,
        defaultInferenceType: "openai",
        searchToken: "a".repeat(64),
        parentWindowOrigins: ["https://huggingface.co"],
      };
      const applied = applyServerConfig(
        defaultSettings,
        config,
        hasStoredUserSettings,
        false,
      );
      expect(applied.inferenceType).toBe("openai");
      expect(applied.wllamaModelId).toBe("custom-model");
    },
  );
});
