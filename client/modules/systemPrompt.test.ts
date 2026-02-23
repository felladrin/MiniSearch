import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemPrompt } from "./systemPrompt";

const mockGetSettings = vi.fn();

vi.mock("./pubSub", () => ({
  getSettings: () => mockGetSettings(),
}));

describe("systemPrompt", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
  });

  it("should replace searchResults placeholder", () => {
    mockGetSettings.mockReturnValue({
      systemPrompt: "Results: {{searchResults}}",
    });
    const result = getSystemPrompt("Found 5 results");
    expect(result).toContain("Found 5 results");
    expect(result).not.toContain("{{searchResults}}");
  });

  it("should replace currentDate placeholder", () => {
    mockGetSettings.mockReturnValue({
      systemPrompt: "Date: {{currentDate}}",
    });
    const result = getSystemPrompt("");
    expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });

  it("should replace dateTime placeholder", () => {
    mockGetSettings.mockReturnValue({
      systemPrompt: "Time: {{dateTime}}",
    });
    const result = getSystemPrompt("");
    expect(result).toMatch(/Time: \d{4}-\d{2}-\d{2}/);
  });

  it("should handle prompt without placeholders", () => {
    mockGetSettings.mockReturnValue({
      systemPrompt: "Hello world",
    });
    const result = getSystemPrompt("extra");
    expect(result).toBe("Hello world");
  });

  it("should handle empty search results", () => {
    mockGetSettings.mockReturnValue({
      systemPrompt: "{{searchResults}}",
    });
    const result = getSystemPrompt("");
    expect(result).toBe("");
  });
});
