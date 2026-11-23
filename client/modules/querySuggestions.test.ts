import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import { getQuerySuggestions, updateQuerySuggestions } from "./pubSub";
import {
  DEFAULT_QUERY_SUGGESTION,
  getRandomQuerySuggestion,
} from "./querySuggestions";

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

describe("getRandomQuerySuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateQuerySuggestions([]);
  });

  it("returns a stored suggestion without fetching", async () => {
    updateQuerySuggestions(["first", "second"]);

    await expect(getRandomQuerySuggestion()).resolves.toBe("second");
    expect(getQuerySuggestions()).toEqual(["first"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the default when the fetched list is empty", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await expect(getRandomQuerySuggestion()).resolves.toBe(
      DEFAULT_QUERY_SUGGESTION,
    );
  });

  it("skips stored entries that are not non-empty strings", async () => {
    updateQuerySuggestions([null, "", "   "] as unknown as string[]);
    mockFetch.mockResolvedValueOnce(jsonResponse(["fetched"]));

    await expect(getRandomQuerySuggestion()).resolves.toBe("fetched");
  });

  it("drops unusable entries from the fetched list", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([null, "", 42, "usable"]));

    await expect(getRandomQuerySuggestion()).resolves.toBe("usable");
    expect(getQuerySuggestions()).toEqual([]);
  });

  it("logs how many suggestions the refill actually stored", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(["a", "b", "c"]));

    await getRandomQuerySuggestion();

    expect(addLogEntry).toHaveBeenCalledWith(
      "Query suggestions refilled with 3 suggestions",
    );
  });

  it.each([
    ["a 404 response", () => new Response("Not found", { status: 404 })],
    ["invalid JSON", () => new Response("not json", { status: 200 })],
    ["a body that is not a list", () => jsonResponse({ suggestions: [] })],
  ])("returns the default and logs on %s", async (_, response) => {
    mockFetch.mockResolvedValueOnce(response());

    await expect(getRandomQuerySuggestion()).resolves.toBe(
      DEFAULT_QUERY_SUGGESTION,
    );
    expect(addLogEntry).toHaveBeenCalledWith(
      expect.stringContaining("Failed to refill query suggestions"),
    );
  });
});
