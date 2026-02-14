import { beforeEach, describe, expect, it, vi } from "vitest";

describe("History Module - Search Run ID Management", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetSearchRunId } = await import("./history");
    resetSearchRunId();
  });

  it("should generate a new search run ID when none exists", async () => {
    const { getCurrentSearchRunId } = await import("./history");
    const id = getCurrentSearchRunId();
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("should return the same ID on subsequent calls", async () => {
    const { getCurrentSearchRunId } = await import("./history");
    const id1 = getCurrentSearchRunId();
    const id2 = getCurrentSearchRunId();
    expect(id1).toBe(id2);
  });

  it("should allow setting a custom search run ID", async () => {
    const { getCurrentSearchRunId, setCurrentSearchRunId, resetSearchRunId } =
      await import("./history");
    resetSearchRunId();
    const customId = "custom-test-id-12345";
    setCurrentSearchRunId(customId);
    expect(getCurrentSearchRunId()).toBe(customId);
  });

  it("should allow resetting the search run ID", async () => {
    const { getCurrentSearchRunId, setCurrentSearchRunId, resetSearchRunId } =
      await import("./history");
    resetSearchRunId();
    setCurrentSearchRunId("test-id");
    expect(getCurrentSearchRunId()).toBe("test-id");

    resetSearchRunId();
    const newId = getCurrentSearchRunId();
    expect(newId).not.toBe("test-id");
    expect(newId).toBeDefined();
  });

  it("should generate unique IDs after reset", async () => {
    const { getCurrentSearchRunId, resetSearchRunId } = await import(
      "./history"
    );
    resetSearchRunId();
    const id1 = getCurrentSearchRunId();
    resetSearchRunId();
    const id2 = getCurrentSearchRunId();
    expect(id1).not.toBe(id2);
  });
});

describe("History Module - Entry Helper Functions", () => {
  it("should detect text results in new structure", async () => {
    const { hasTextResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      textResults: { type: "text" as const, items: [] },
    };
    expect(hasTextResults(entry)).toBe(true);
  });

  it("should detect text results in legacy structure", async () => {
    const { hasTextResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      results: { type: "text" as const, items: [] },
    };
    expect(hasTextResults(entry)).toBe(true);
  });

  it("should return false when no text results exist", async () => {
    const { hasTextResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
    };
    expect(hasTextResults(entry)).toBe(false);
  });

  it("should detect image results in new structure", async () => {
    const { hasImageResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      imageResults: { type: "image" as const, items: [] },
    };
    expect(hasImageResults(entry)).toBe(true);
  });

  it("should detect image results in legacy structure", async () => {
    const { hasImageResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      results: { type: "image" as const, items: [] },
    };
    expect(hasImageResults(entry)).toBe(true);
  });

  it("should return false when no image results exist", async () => {
    const { hasImageResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
    };
    expect(hasImageResults(entry)).toBe(false);
  });

  it("should get results from new textResults field", async () => {
    const { getResultsFromEntry } = await import("./history");
    const textResults = {
      type: "text" as const,
      items: [
        { title: "Test", url: "https://test.com", snippet: "Test snippet" },
      ],
    };
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      textResults,
    };
    expect(getResultsFromEntry(entry)).toBe(textResults);
  });

  it("should get results from new imageResults field", async () => {
    const { getResultsFromEntry } = await import("./history");
    const imageResults = {
      type: "image" as const,
      items: [
        {
          title: "Image",
          url: "https://img.com/img.jpg",
          thumbnail: "https://img.com/thumb.jpg",
        },
      ],
    };
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      imageResults,
    };
    expect(getResultsFromEntry(entry)).toBe(imageResults);
  });

  it("should fallback to legacy results field", async () => {
    const { getResultsFromEntry } = await import("./history");
    const legacyResults = {
      type: "text" as const,
      items: [
        {
          title: "Legacy",
          url: "https://legacy.com",
          snippet: "Legacy snippet",
        },
      ],
    };
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      results: legacyResults,
    };
    expect(getResultsFromEntry(entry)).toBe(legacyResults);
  });

  it("should return null when no results exist", async () => {
    const { getResultsFromEntry } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
    };
    expect(getResultsFromEntry(entry)).toBeNull();
  });

  it("should detect text results in legacy structure", async () => {
    const { hasTextResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      results: { type: "text" as const, items: [] },
    };
    expect(hasTextResults(entry)).toBe(true);
  });

  it("should return false when no text results exist", async () => {
    const { hasTextResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
    };
    expect(hasTextResults(entry)).toBe(false);
  });

  it("should detect image results in new structure", async () => {
    const { hasImageResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      imageResults: { type: "image" as const, items: [] },
    };
    expect(hasImageResults(entry)).toBe(true);
  });

  it("should detect image results in legacy structure", async () => {
    const { hasImageResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      results: { type: "image" as const, items: [] },
    };
    expect(hasImageResults(entry)).toBe(true);
  });

  it("should return false when no image results exist", async () => {
    const { hasImageResults } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
    };
    expect(hasImageResults(entry)).toBe(false);
  });

  it("should get results from new textResults field", async () => {
    const { getResultsFromEntry } = await import("./history");
    const textResults = {
      type: "text" as const,
      items: [
        { title: "Test", url: "https://test.com", snippet: "Test snippet" },
      ],
    };
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      textResults,
    };
    expect(getResultsFromEntry(entry)).toBe(textResults);
  });

  it("should get results from new imageResults field", async () => {
    const { getResultsFromEntry } = await import("./history");
    const imageResults = {
      type: "image" as const,
      items: [
        {
          title: "Image",
          url: "https://img.com/img.jpg",
          thumbnail: "https://img.com/thumb.jpg",
        },
      ],
    };
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      imageResults,
    };
    expect(getResultsFromEntry(entry)).toBe(imageResults);
  });

  it("should fallback to legacy results field", async () => {
    const { getResultsFromEntry } = await import("./history");
    const legacyResults = {
      type: "text" as const,
      items: [
        {
          title: "Legacy",
          url: "https://legacy.com",
          snippet: "Legacy snippet",
        },
      ],
    };
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
      results: legacyResults,
    };
    expect(getResultsFromEntry(entry)).toBe(legacyResults);
  });

  it("should return null when no results exist", async () => {
    const { getResultsFromEntry } = await import("./history");
    const entry = {
      id: 1,
      searchRunId: "test-1",
      query: "test",
      timestamp: Date.now(),
    };
    expect(getResultsFromEntry(entry)).toBeNull();
  });
});

describe("Search run ID management", () => {
  it("should generate new ID when none exists", async () => {
    const { getCurrentSearchRunId, resetSearchRunId } = await import(
      "./history"
    );
    resetSearchRunId();
    const id = getCurrentSearchRunId();
    expect(id).toBeTruthy();
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });

  it("should return same ID on subsequent calls", async () => {
    const { getCurrentSearchRunId, resetSearchRunId } = await import(
      "./history"
    );
    resetSearchRunId();
    const id1 = getCurrentSearchRunId();
    const id2 = getCurrentSearchRunId();
    expect(id1).toBe(id2);
  });

  it("should allow setting custom ID", async () => {
    const { getCurrentSearchRunId, setCurrentSearchRunId, resetSearchRunId } =
      await import("./history");
    resetSearchRunId();
    setCurrentSearchRunId("custom-id-123");
    expect(getCurrentSearchRunId()).toBe("custom-id-123");
  });

  it("should reset ID to null", async () => {
    const { getCurrentSearchRunId, setCurrentSearchRunId, resetSearchRunId } =
      await import("./history");
    resetSearchRunId();
    setCurrentSearchRunId("custom-id-123");
    resetSearchRunId();
    const id = getCurrentSearchRunId();
    expect(id).not.toBe("custom-id-123");
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });
});
