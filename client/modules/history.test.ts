import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the pubSub module so cleanup hooks don't fail on missing getSettings
vi.mock("./pubSub", () => ({
  getSettings: () => ({
    historyAutoCleanup: false,
    historyRetentionDays: 30,
    historyMaxEntries: 500,
  }),
}));

const createTestEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  searchRunId: "test-1",
  query: "test",
  timestamp: Date.now(),
  ...overrides,
});

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
    const entry = createTestEntry({
      results: { type: "text" as const, items: [] },
    });
    expect(hasTextResults(entry)).toBe(true);
  });

  it("should return false when no text results exist", async () => {
    const { hasTextResults } = await import("./history");
    const entry = createTestEntry();
    expect(hasTextResults(entry)).toBe(false);
  });

  it("should detect image results in new structure", async () => {
    const { hasImageResults } = await import("./history");
    const entry = createTestEntry({
      imageResults: { type: "image" as const, items: [] },
    });
    expect(hasImageResults(entry)).toBe(true);
  });

  it("should detect image results in legacy structure", async () => {
    const { hasImageResults } = await import("./history");
    const entry = createTestEntry({
      results: { type: "image" as const, items: [] },
    });
    expect(hasImageResults(entry)).toBe(true);
  });

  it("should return false when no image results exist", async () => {
    const { hasImageResults } = await import("./history");
    const entry = createTestEntry();
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
    const entry = createTestEntry({ textResults });
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
    const entry = createTestEntry({ imageResults });
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
    const entry = createTestEntry({ results: legacyResults });
    expect(getResultsFromEntry(entry)).toBe(legacyResults);
  });

  it("should return null when no results exist", async () => {
    const { getResultsFromEntry } = await import("./history");
    const entry = createTestEntry();
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

describe("History Module - Dexie CRUD", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { historyDatabase, resetSearchRunId } = await import("./history");
    // Clear all tables so each test starts from a clean state
    await historyDatabase.searches.clear();
    await historyDatabase.llmResponses.clear();
    await historyDatabase.chatHistory.clear();
    resetSearchRunId();
  });

  describe("addSearchToHistory", () => {
    it("should add a text search entry and return an ID", async () => {
      const { addSearchToHistory } = await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };
      const id = await addSearchToHistory("test query", results);
      expect(id).toBeDefined();
      expect(typeof id).toBe("number");
    });

    it("should add an image search entry and return an ID", async () => {
      const { addSearchToHistory } = await import("./history");
      const results = {
        type: "image" as const,
        items: [
          { title: "I", url: "https://i.com", thumbnail: "https://t.com" },
        ],
      };
      const id = await addSearchToHistory("image query", results);
      expect(id).toBeDefined();
      expect(typeof id).toBe("number");
    });
  });

  describe("getRecentSearches", () => {
    it("should return empty array when no entries exist", async () => {
      const { getRecentSearches } = await import("./history");
      const results = await getRecentSearches();
      expect(results).toEqual([]);
    });

    it("should return entries in reverse chronological order", async () => {
      const { addSearchToHistory, getRecentSearches } = await import(
        "./history"
      );
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      await addSearchToHistory("first", results);
      await new Promise((r) => setTimeout(r, 10));
      await addSearchToHistory("second", results);

      const searches = await getRecentSearches();
      expect(searches.length).toBeGreaterThanOrEqual(2);
      // Most recent should be first
      expect(searches[0].query).toBe("second");
    });

    it("should respect the limit parameter", async () => {
      const { addSearchToHistory, getRecentSearches } = await import(
        "./history"
      );
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      for (let i = 0; i < 5; i++) {
        await addSearchToHistory(`query ${i}`, results);
      }

      const searches = await getRecentSearches(2);
      expect(searches).toHaveLength(2);
    });
  });

  describe("addSearchToHistory + getRecentSearches round-trip", () => {
    it("should preserve query, source, and searchRunId through a write/read cycle", async () => {
      const { addSearchToHistory, getRecentSearches, getCurrentSearchRunId } =
        await import("./history");
      const runId = getCurrentSearchRunId();
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      await addSearchToHistory("round trip query", results, "user");
      const searches = await getRecentSearches();
      const entry = searches.find((s) => s.query === "round trip query");

      expect(entry).toBeDefined();
      if (!entry) return;
      expect(entry.query).toBe("round trip query");
      expect(entry.searchRunId).toBe(runId);
      expect(entry.source).toBe("user");
    });

    it("should store textResults and legacy results fields", async () => {
      const { addSearchToHistory, getRecentSearches } = await import(
        "./history"
      );
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      await addSearchToHistory("fields test", results);
      const searches = await getRecentSearches();
      const entry = searches.find((s) => s.query === "fields test");

      expect(entry).toBeDefined();
      if (!entry) return;
      expect(entry.textResults).toEqual(results);
      expect(entry.results).toEqual(results);
    });
  });

  describe("updateSearchResults", () => {
    it("should update the latest entry for a searchRunId with new results", async () => {
      const {
        addSearchToHistory,
        updateSearchResults,
        getRecentSearches,
        getCurrentSearchRunId,
      } = await import("./history");
      const runId = getCurrentSearchRunId();
      const initialResults = {
        type: "text" as const,
        items: [{ title: "Initial", url: "https://i.com", snippet: "I" }],
      };
      const updatedResults = {
        type: "image" as const,
        items: [
          {
            title: "Updated",
            url: "https://u.com",
            thumbnail: "https://th.com",
          },
        ],
      };

      await addSearchToHistory("update test", initialResults);
      await updateSearchResults(runId, updatedResults);

      const searches = await getRecentSearches();
      const entry = searches.find((s) => s.query === "update test");

      expect(entry).toBeDefined();
      if (!entry) return;
      expect(entry.imageResults).toEqual(updatedResults);
    });
  });

  describe("saveLlmResponseForQuery / getLatestLlmResponseForEntry", () => {
    it("should save and retrieve an LLM response for a search entry", async () => {
      const {
        addSearchToHistory,
        getRecentSearches,
        saveLlmResponseForQuery,
        getLatestLlmResponseForEntry,
      } = await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      await addSearchToHistory("llm test", results);
      await saveLlmResponseForQuery("llm test", "AI answer", "model-x");

      const searches = await getRecentSearches();
      const entry = searches.find((s) => s.query === "llm test");
      expect(entry).toBeDefined();
      if (!entry) return;

      const response = await getLatestLlmResponseForEntry(entry);
      expect(response).toBe("AI answer");
    });

    it("should return null when no LLM response exists", async () => {
      const {
        addSearchToHistory,
        getRecentSearches,
        getLatestLlmResponseForEntry,
      } = await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      await addSearchToHistory("no llm", results);
      const searches = await getRecentSearches();
      const entry = searches.find((s) => s.query === "no llm");
      expect(entry).toBeDefined();
      if (!entry) return;

      const response = await getLatestLlmResponseForEntry(entry);
      expect(response).toBeNull();
    });
  });

  describe("saveChatMessageForQuery / getChatMessagesForQuery", () => {
    it("should save and retrieve chat messages in order", async () => {
      const {
        addSearchToHistory,
        getCurrentSearchRunId,
        saveChatMessageForQuery,
        getChatMessagesForQuery,
      } = await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };
      const runId = getCurrentSearchRunId();

      await addSearchToHistory("chat test", results);
      await saveChatMessageForQuery("chat test", "user", "Hello");
      await new Promise((r) => setTimeout(r, 10));
      await saveChatMessageForQuery("chat test", "assistant", "Hi there");

      const messages = await getChatMessagesForQuery(runId);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(messages[1]).toEqual({ role: "assistant", content: "Hi there" });
    });

    it("should return empty array when no messages exist", async () => {
      const { getChatMessagesForQuery } = await import("./history");
      const messages = await getChatMessagesForQuery("nonexistent-run-id");
      expect(messages).toEqual([]);
    });
  });
});
