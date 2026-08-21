import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin auto-cleanup off and avoid pubSub's module-level localStorage reads.
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
    expect(getCurrentSearchRunId()).toMatch(/^\d+-[a-z0-9]+$/);
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

  it("should hand out a fresh ID after every reset", async () => {
    const { getCurrentSearchRunId, setCurrentSearchRunId, resetSearchRunId } =
      await import("./history");
    setCurrentSearchRunId("test-id");

    resetSearchRunId();
    const first = getCurrentSearchRunId();
    resetSearchRunId();
    const second = getCurrentSearchRunId();

    expect(first).not.toBe("test-id");
    expect(second).not.toBe(first);
    expect(second).toMatch(/^\d+-[a-z0-9]+$/);
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

describe("History Module - Dexie CRUD", () => {
  let historyDatabase: typeof import("./history").historyDatabase;
  let resetSearchRunId: typeof import("./history").resetSearchRunId;

  beforeAll(async () => {
    const mod = await import("./history");
    historyDatabase = mod.historyDatabase;
    resetSearchRunId = mod.resetSearchRunId;
  });

  beforeEach(async () => {
    await historyDatabase.searches.clear();
    await historyDatabase.llmResponses.clear();
    await historyDatabase.chatHistory.clear();
    resetSearchRunId();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

    it("should store image results under imageResults, not textResults", async () => {
      const { addSearchToHistory, getRecentSearches } = await import(
        "./history"
      );
      const results = {
        type: "image" as const,
        items: [
          { title: "I", url: "https://i.com", thumbnail: "https://t.com" },
        ],
      };
      await addSearchToHistory("image query", results);
      const [entry] = await getRecentSearches();
      expect(entry.imageResults).toEqual(results);
      expect(entry.textResults).toBeUndefined();
      expect(entry.results).toEqual(results);
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

      // Insert "second" with the earlier timestamp so it proves sorting by timestamp, not ID.
      vi.setSystemTime(new Date(2000, 0, 2));
      await addSearchToHistory("first", results);
      vi.setSystemTime(new Date(2000, 0, 1));
      await addSearchToHistory("second", results);

      const searches = await getRecentSearches();
      expect(searches).toHaveLength(2);
      expect(searches[0].query).toBe("first");
      expect(searches[1].query).toBe("second");
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

    it("should cap at the default limit of 10", async () => {
      const { addSearchToHistory, getRecentSearches } = await import(
        "./history"
      );
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      for (let i = 0; i < 12; i++) {
        await addSearchToHistory(`query ${i}`, results);
      }

      const searches = await getRecentSearches();
      expect(searches).toHaveLength(10);
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
      const [entry] = await getRecentSearches();
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
      const [entry] = await getRecentSearches();
      expect(entry.textResults).toEqual(results);
      expect(entry.results).toEqual(results);
    });
  });

  describe("updateSearchResults", () => {
    it("should update the first entry for a searchRunId with new results", async () => {
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

      const [entry] = await getRecentSearches();
      expect(entry.imageResults).toEqual(updatedResults);
      // Verify spread preserves original textResults
      expect(entry.textResults).toEqual(initialResults);
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

      const [entry] = await getRecentSearches();
      const response = await getLatestLlmResponseForEntry(entry);
      expect(response).toBe("AI answer");
    });

    it("should store searchId back-link from llmResponses to the search row", async () => {
      const { addSearchToHistory, historyDatabase, saveLlmResponseForQuery } =
        await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      const id = await addSearchToHistory("llm link test", results);
      await saveLlmResponseForQuery("llm link test", "answer", "m");

      const llmRecords = await historyDatabase.llmResponses.toArray();
      expect(llmRecords).toHaveLength(1);
      expect(llmRecords[0].searchId).toBe(id);
    });

    it("should return the most recent response when multiple exist", async () => {
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

      await addSearchToHistory("multi llm", results);
      // Save "second" first with a later timestamp, "first" second with earlier timestamp.
      vi.setSystemTime(new Date(2000, 0, 2));
      await saveLlmResponseForQuery("multi llm", "second", "m");
      vi.setSystemTime(new Date(2000, 0, 1));
      await saveLlmResponseForQuery("multi llm", "first", "m");

      const [entry] = await getRecentSearches();
      const response = await getLatestLlmResponseForEntry(entry);
      expect(response).toBe("second"); // must pick by timestamp, not insertion order
    });

    it("should fall back to entry.query when searchRunId is missing", async () => {
      const { historyDatabase, getLatestLlmResponseForEntry } = await import(
        "./history"
      );

      // Insert an LLM response with a known searchRunId directly
      await historyDatabase.llmResponses.add({
        searchRunId: "my-query-fallback",
        prompt: "legacy key test",
        response: "answer",
        model: "m",
        timestamp: Date.now(),
      });

      // Entry without searchRunId should resolve via entry.query fallback
      const entryWithoutRunId = {
        id: -1,
        query: "my-query-fallback",
        timestamp: Date.now(),
      };
      const response = await getLatestLlmResponseForEntry(entryWithoutRunId);
      expect(response).toBe("answer");
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
      // Save assistant message with earlier timestamp so it proves sort by timestamp.
      vi.setSystemTime(new Date(2000, 0, 2));
      await saveChatMessageForQuery("chat test", "user", "Hello");
      vi.setSystemTime(new Date(2000, 0, 1));
      await saveChatMessageForQuery("chat test", "assistant", "Hi there");

      const messages = await getChatMessagesForQuery(runId);
      expect(messages).toHaveLength(2);
      // sortBy("timestamp") puts the assistant (Jan 1) before user (Jan 2).
      expect(messages[0]).toEqual({ role: "assistant", content: "Hi there" });
      expect(messages[1]).toEqual({ role: "user", content: "Hello" });
    });

    it("should return empty array when no messages exist", async () => {
      const { getChatMessagesForQuery } = await import("./history");
      const messages = await getChatMessagesForQuery("nonexistent-run-id");
      expect(messages).toEqual([]);
    });
  });

  describe("error paths", () => {
    it("should return undefined when addSearchToHistory fails", async () => {
      const { addSearchToHistory, historyDatabase } = await import("./history");
      vi.spyOn(historyDatabase.searches, "add").mockRejectedValue(
        new Error("boom"),
      );
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };
      const id = await addSearchToHistory("q", results);
      expect(id).toBeUndefined();
    });

    it("should return empty array when getRecentSearches fails", async () => {
      const { getRecentSearches, historyDatabase } = await import("./history");
      vi.spyOn(historyDatabase.searches, "orderBy").mockImplementation(() => {
        throw new Error("boom") as never;
      });
      const results = await getRecentSearches();
      expect(results).toEqual([]);
    });

    it("should return null when getLatestLlmResponseForEntry fails", async () => {
      const { getLatestLlmResponseForEntry, historyDatabase } = await import(
        "./history"
      );
      vi.spyOn(historyDatabase.llmResponses, "where").mockReturnValue({
        equals: () => ({
          toArray: () => Promise.reject(new Error("boom")),
        }),
      } as never);
      const response = await getLatestLlmResponseForEntry({
        query: "test",
        timestamp: 0,
      });
      expect(response).toBeNull();
    });

    it("should return empty array when getChatMessagesForQuery fails", async () => {
      const { getChatMessagesForQuery, historyDatabase } = await import(
        "./history"
      );
      vi.spyOn(historyDatabase.chatHistory, "where").mockReturnValue({
        equals: () => ({
          sortBy: () => Promise.reject(new Error("boom")),
        }),
      } as never);
      const messages = await getChatMessagesForQuery("test");
      expect(messages).toEqual([]);
    });
  });
});
