import { describe, expect, it } from "vitest";
import { defaultSettings, inferenceTypes } from "./settings";

describe("Settings Module", () => {
  it("should have correct default settings values", () => {
    expect(defaultSettings.showEnableAiResponsePrompt).toBe(true);
    expect(defaultSettings.enableAiResponse).toBe(false);
    expect(defaultSettings.enableWebGpu).toBe(true);
    expect(defaultSettings.enableImageSearch).toBe(true);
    expect(defaultSettings.searchResultsToConsider).toBe(3);
    expect(defaultSettings.searchResultsLimit).toBe(15);
    expect(defaultSettings.inferenceType).toBeDefined();
  });

  it("should include core inference types", () => {
    const values = inferenceTypes.map((i) => i.value);
    expect(values).toContain("browser");
    expect(values).toContain("openai");
    expect(values).toContain("horde");
  });
});
