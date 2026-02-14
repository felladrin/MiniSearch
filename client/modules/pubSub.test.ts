import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
