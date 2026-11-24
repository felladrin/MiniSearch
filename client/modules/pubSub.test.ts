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
    const [, , getMenuExpandedAccordions] = menuExpandedAccordionsPubSub;
    expect(getMenuExpandedAccordions()).toEqual([]);
    expect(localStorage.getItem("menuExpandedAccordions")).toBeNull();
    expect(addLogEntry).toHaveBeenCalledWith(
      "Discarded an unusable stored value for 'menuExpandedAccordions'",
    );
  });

  it("falls back to the default and drops the value when the stored JSON has the wrong type", async () => {
    localStorage.setItem("lastSearchTokenHash", "123");
    const { getLastSearchTokenHash } = await import("./pubSub");
    expect(getLastSearchTokenHash()).toBe("");
    expect(localStorage.getItem("lastSearchTokenHash")).toBeNull();
    expect(addLogEntry).toHaveBeenCalledWith(
      "Discarded an unusable stored value for 'lastSearchTokenHash'",
    );
  });

  it("falls back to the default and drops the value when the stored value is empty", async () => {
    localStorage.setItem("menuExpandedAccordions", "");
    const { menuExpandedAccordionsPubSub } = await import("./pubSub");
    const [, , getMenuExpandedAccordions] = menuExpandedAccordionsPubSub;
    expect(getMenuExpandedAccordions()).toEqual([]);
    expect(localStorage.getItem("menuExpandedAccordions")).toBeNull();
    expect(addLogEntry).toHaveBeenCalledWith(
      "Discarded an unusable stored value for 'menuExpandedAccordions'",
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
    expect(getDefaultChatCompletionCreateParamsStreaming().max_tokens).toBe(
      defaultSettings.openAiContextLength,
    );
    expect(getEffectiveContextSize()).toBe(defaultSettings.openAiContextLength);
  });
});
