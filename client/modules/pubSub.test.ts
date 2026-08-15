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
    vi.resetModules();
    const { menuExpandedAccordionsPubSub } = await import("./pubSub");
    const [, , getMenuExpandedAccordions] = menuExpandedAccordionsPubSub;
    expect(getMenuExpandedAccordions()).toEqual([]);
    expect(localStorage.getItem("menuExpandedAccordions")).toBeNull();
    expect(addLogEntry).toHaveBeenCalledWith(
      "Discarded an unusable stored value for 'menuExpandedAccordions'",
    );
  });

  it("falls back to the default and drops the value when the stored JSON has the wrong type", async () => {
    localStorage.setItem("showFeatureTips", '"false"');
    vi.resetModules();
    const { showFeatureTipsPubSub } = await import("./pubSub");
    const [, , getTips] = showFeatureTipsPubSub;
    expect(getTips()).toBe(true);
    expect(localStorage.getItem("showFeatureTips")).toBeNull();
    expect(addLogEntry).toHaveBeenCalledWith(
      "Discarded an unusable stored value for 'showFeatureTips'",
    );
  });

  it("keeps a dismissed feature-tips flag across a reload", async () => {
    const { showFeatureTipsPubSub } = await import("./pubSub");
    const [dismissTips] = showFeatureTipsPubSub;
    dismissTips(false);
    expect(localStorage.getItem("showFeatureTips")).toBe("false");
    vi.resetModules();
    const reloaded = await import("./pubSub");
    const [, , getTips] = reloaded.showFeatureTipsPubSub;
    expect(getTips()).toBe(false);
  });
});
