import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "./pubSub";

// Pin auto-cleanup off and avoid pubSub's module-level localStorage reads.
vi.mock("./pubSub", () => ({
  getSettings: vi.fn(() => ({
    historyAutoCleanup: false,
    historyRetentionDays: 30,
    historyMaxEntries: 500,
  })),
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

  describe("getPinnedSearches", () => {
    it("returns only pinned entries, newest first, however old", async () => {
      const { addSearchToHistory, getPinnedSearches, historyDatabase } =
        await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      vi.setSystemTime(new Date(2000, 0, 1));
      const oldest = await addSearchToHistory("pinned long ago", results);
      vi.setSystemTime(new Date(2000, 0, 2));
      await addSearchToHistory("never pinned", results);
      vi.setSystemTime(new Date(2000, 0, 3));
      const newest = await addSearchToHistory("pinned lately", results);
      for (const id of [oldest, newest]) {
        await historyDatabase.searches.update(id as number, {
          pinned: true,
          pinnedAt: Date.now(),
        });
      }

      const pinned = await getPinnedSearches();
      expect(pinned.map((search) => search.query)).toEqual([
        "pinned lately",
        "pinned long ago",
      ]);
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

      await historyDatabase.llmResponses.add({
        searchRunId: "my-query-fallback",
        prompt: "legacy key test",
        response: "answer",
        model: "m",
        timestamp: Date.now(),
      });

      const entryWithoutRunId = {
        id: -1,
        query: "my-query-fallback",
        timestamp: Date.now(),
      };
      const response = await getLatestLlmResponseForEntry(entryWithoutRunId);
      expect(response).toBe("answer");
    });
  });

  describe("replaceChatConversation / getChatMessagesForQuery", () => {
    const pair = (question: string, answer: string) => [
      { role: "user" as const, content: question },
      { role: "assistant" as const, content: answer },
    ];

    it("stores the messages in the order given", async () => {
      const { replaceChatConversation, getChatMessagesForQuery } = await import(
        "./history"
      );

      await replaceChatConversation("run-a", [
        ...pair("Q1", "A1"),
        ...pair("Q2", "A2"),
      ]);

      expect(await getChatMessagesForQuery("run-a")).toEqual([
        ...pair("Q1", "A1"),
        ...pair("Q2", "A2"),
      ]);
    });

    it("replaces the conversation instead of appending to it", async () => {
      const { replaceChatConversation, getChatMessagesForQuery } = await import(
        "./history"
      );

      await replaceChatConversation("run-a", pair("Q1", "First answer"));
      await replaceChatConversation("run-a", pair("Q1", "Regenerated"));

      expect(await getChatMessagesForQuery("run-a")).toEqual(
        pair("Q1", "Regenerated"),
      );
    });

    it("leaves other conversations untouched", async () => {
      const { replaceChatConversation, getChatMessagesForQuery } = await import(
        "./history"
      );

      await replaceChatConversation("run-a", pair("A?", "A."));
      await replaceChatConversation("run-b", pair("B?", "B."));
      await replaceChatConversation("run-a", []);

      expect(await getChatMessagesForQuery("run-b")).toEqual(pair("B?", "B."));
    });

    it("removes the conversation when given an empty list", async () => {
      const { replaceChatConversation, historyDatabase } = await import(
        "./history"
      );

      await replaceChatConversation("run-a", pair("Q1", "A1"));
      await replaceChatConversation("run-a", []);

      expect(await historyDatabase.chatHistory.count()).toBe(0);
    });

    it("should return empty array when no messages exist", async () => {
      const { getChatMessagesForQuery } = await import("./history");
      const messages = await getChatMessagesForQuery("nonexistent-run-id");
      expect(messages).toEqual([]);
    });
  });

  describe("cleanup after add", () => {
    it("should not throw TransactionInactiveError when auto-cleanup is enabled", async () => {
      const { getSettings } = await import("./pubSub");
      const { defaultSettings } = await import("./settings");
      vi.mocked(getSettings).mockReturnValue({
        ...defaultSettings,
        historyAutoCleanup: true,
        historyRetentionDays: 0,
        historyMaxEntries: 5,
      });

      const { addSearchToHistory, historyDatabase } = await import("./history");
      const results = {
        type: "text" as const,
        items: [{ title: "T", url: "https://t.com", snippet: "S" }],
      };

      // Cleanup must run after the add transaction completes: inside it, the
      // async import causes a TransactionInactiveError.
      for (let i = 0; i < 8; i++) {
        const id = await addSearchToHistory(`query ${i}`, results);
        expect(id).toBeDefined();
      }

      // Settle any in-flight cleanup, then run one final cleanup to ensure
      // the count reflects the steady state.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await historyDatabase.runCleanup();

      // Cleanup should have trimmed to maxEntries (pinned entries exempt, none here)
      const count = await historyDatabase.searches.count();
      expect(count).toBeLessThanOrEqual(5);
    });

    it("should deduplicate concurrent cleanup calls", async () => {
      const { getSettings } = await import("./pubSub");
      const { defaultSettings } = await import("./settings");
      vi.mocked(getSettings).mockReturnValue({
        ...defaultSettings,
        historyAutoCleanup: true,
        historyRetentionDays: 0,
        historyMaxEntries: 1000,
      });

      const { historyDatabase } = await import("./history");

      const p1 = historyDatabase.runCleanup();
      const p2 = historyDatabase.runCleanup();
      expect(p1).toBe(p2);

      await p1;
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

  describe("clearAllHistory", () => {
    it("should clear searches, llmResponses, and chatHistory in a single transaction", async () => {
      const { clearAllHistory, historyDatabase } = await import("./history");

      await historyDatabase.searches.add({
        searchRunId: "run-1",
        query: "test query",
        timestamp: Date.now(),
        source: "text",
        pinned: false,
      });

      await historyDatabase.llmResponses.add({
        searchId: 1,
        searchRunId: "run-1",
        timestamp: Date.now(),
        prompt: "test prompt",
        response: "test response",
        model: "gpt-4o",
      });

      await historyDatabase.chatHistory.add({
        role: "user",
        content: "hello",
        timestamp: Date.now(),
        conversationId: "run-1",
      });

      expect(await historyDatabase.searches.count()).toBe(1);
      expect(await historyDatabase.llmResponses.count()).toBe(1);
      expect(await historyDatabase.chatHistory.count()).toBe(1);

      await clearAllHistory();

      expect(await historyDatabase.searches.count()).toBe(0);
      expect(await historyDatabase.llmResponses.count()).toBe(0);
      expect(await historyDatabase.chatHistory.count()).toBe(0);
    });
  });
});

describe("History Module - Enable Search History off", () => {
  const settingsMock = vi.mocked(getSettings);
  const historyOn = settingsMock.getMockImplementation();
  const textResults = {
    type: "text" as const,
    items: [{ title: "T", url: "https://t.com", snippet: "S" }],
  };

  beforeEach(async () => {
    const { historyDatabase } = await import("./history");
    await historyDatabase.searches.clear();
    await historyDatabase.llmResponses.clear();
    await historyDatabase.chatHistory.clear();
    settingsMock.mockImplementation(
      () =>
        ({
          ...historyOn?.(),
          enableHistory: false,
        }) as ReturnType<typeof getSettings>,
    );
  });

  afterEach(async () => {
    if (historyOn) settingsMock.mockImplementation(historyOn);
    const { historyDatabase } = await import("./history");
    if (!historyDatabase.isOpen()) await historyDatabase.open();
  });

  it("writes no search, result, answer or chat message", async () => {
    const {
      addSearchToHistory,
      getCurrentSearchRunId,
      historyDatabase,
      replaceChatConversation,
      saveLlmResponseForQuery,
      updateSearchResults,
    } = await import("./history");

    const id = await addSearchToHistory("private query", textResults);
    await updateSearchResults(getCurrentSearchRunId(), textResults);
    await saveLlmResponseForQuery("private query", "answer", "m");
    await replaceChatConversation(getCurrentSearchRunId(), [
      { role: "user", content: "follow-up" },
    ]);

    expect(id).toBeUndefined();
    expect(await historyDatabase.searches.count()).toBe(0);
    expect(await historyDatabase.llmResponses.count()).toBe(0);
    expect(await historyDatabase.chatHistory.count()).toBe(0);
  });

  it("does not open a database the app never opened", async () => {
    // The state at startup with history off: index.tsx skips open(), and
    // Dexie would open the database on the first query.
    const { addSearchToHistory, historyDatabase } = await import("./history");
    historyDatabase.close({ disableAutoOpen: false });

    await addSearchToHistory("private query", textResults);

    expect(historyDatabase.isOpen()).toBe(false);
  });
});

describe("History Module - a search takes its answers and chats with it", () => {
  const settingsMock = vi.mocked(getSettings);
  const historyOn = settingsMock.getMockImplementation();

  function enableCleanup(
    overrides: {
      historyRetentionDays?: number;
      historyMaxEntries?: number;
    } = {},
  ) {
    settingsMock.mockImplementation(
      () =>
        ({
          ...historyOn?.(),
          historyAutoCleanup: true,
          historyRetentionDays: 30,
          historyMaxEntries: 500,
          ...overrides,
        }) as ReturnType<typeof getSettings>,
    );
  }

  /** A search plus the answer and chat turn stored under its key. */
  async function seedSearch({
    key,
    ageMs = 0,
    pinned = false,
    legacy = false,
  }: {
    key: string;
    ageMs?: number;
    pinned?: boolean;
    legacy?: boolean;
  }) {
    const { historyDatabase } = await import("./history");
    const timestamp = Date.now() - ageMs;
    const searchId = await historyDatabase.searches.add({
      ...(legacy ? {} : { searchRunId: key }),
      query: key,
      timestamp,
      pinned,
      source: "user",
    });
    await historyDatabase.llmResponses.add({
      searchRunId: key,
      searchId: searchId as number,
      prompt: key,
      response: `answer for ${key}`,
      model: "m",
      timestamp,
    });
    await historyDatabase.chatHistory.add({
      role: "user",
      content: `chat for ${key}`,
      timestamp,
      conversationId: key,
    });
    return searchId as number;
  }

  async function counts() {
    const { historyDatabase } = await import("./history");
    return {
      searches: await historyDatabase.searches.count(),
      llmResponses: await historyDatabase.llmResponses.count(),
      chatHistory: await historyDatabase.chatHistory.count(),
    };
  }

  /** The search, answer and chat stored under `key` are the only rows left. */
  async function expectOnlyRowsOf(key: string) {
    const { historyDatabase } = await import("./history");
    const searches = await historyDatabase.searches.toArray();
    const answers = await historyDatabase.llmResponses.toArray();
    const chats = await historyDatabase.chatHistory.toArray();
    expect(searches.map((search) => search.searchRunId)).toEqual([key]);
    expect(answers.map((answer) => answer.searchRunId)).toEqual([key]);
    expect(chats.map((chat) => chat.conversationId)).toEqual([key]);
  }

  const sixtyDays = 60 * 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    const { historyDatabase } = await import("./history");
    await historyDatabase.searches.clear();
    await historyDatabase.llmResponses.clear();
    await historyDatabase.chatHistory.clear();
  });

  afterEach(() => {
    if (historyOn) settingsMock.mockImplementation(historyOn);
  });

  it("removes an expired search's answer and chat with it", async () => {
    enableCleanup();
    await seedSearch({ key: "old", ageMs: sixtyDays });
    await seedSearch({ key: "recent" });

    const { historyDatabase } = await import("./history");
    await historyDatabase.runCleanup();

    await expectOnlyRowsOf("recent");
  });

  it("keeps a pinned search's answer and chat", async () => {
    enableCleanup();
    await seedSearch({ key: "pinned", ageMs: sixtyDays, pinned: true });

    const { historyDatabase } = await import("./history");
    await historyDatabase.runCleanup();

    await expectOnlyRowsOf("pinned");
  });

  it("trims answers and chats with the searches over the entry limit", async () => {
    enableCleanup({ historyRetentionDays: 0, historyMaxEntries: 10 });
    for (let i = 0; i < 15; i++) {
      await seedSearch({ key: `run-${i}`, ageMs: (15 - i) * 1000 });
    }

    const { historyDatabase } = await import("./history");
    await historyDatabase.runCleanup();

    expect(await counts()).toEqual({
      searches: 10,
      llmResponses: 10,
      chatHistory: 10,
    });
  });

  it("finds a legacy search's answer and chat by its query", async () => {
    enableCleanup();
    await seedSearch({ key: "legacy query", ageMs: sixtyDays, legacy: true });

    const { historyDatabase } = await import("./history");
    await historyDatabase.runCleanup();

    expect(await counts()).toEqual({
      searches: 0,
      llmResponses: 0,
      chatHistory: 0,
    });
  });

  it("keeps the rows of a key another search still reads", async () => {
    enableCleanup();
    // Two searches of one run share the key their answer is stored under.
    await seedSearch({ key: "shared-run", ageMs: sixtyDays });
    const { historyDatabase } = await import("./history");
    await historyDatabase.searches.add({
      searchRunId: "shared-run",
      query: "second search of the run",
      timestamp: Date.now(),
      pinned: false,
      source: "user",
    });

    await historyDatabase.runCleanup();

    await expectOnlyRowsOf("shared-run");
  });

  it("deletes one search with its answer and chat and leaves the others", async () => {
    const target = await seedSearch({ key: "delete-me" });
    await seedSearch({ key: "keep-me" });

    const { historyDatabase } = await import("./history");
    const entry = await historyDatabase.searches.get(target);
    if (!entry) throw new Error("seeded search is missing");
    await historyDatabase.deleteSearchesWithChildren([entry]);

    await expectOnlyRowsOf("keep-me");
  });

  it("drops the rows no search owns when a version 1 database is upgraded", async () => {
    const { historyDatabase } = await import("./history");
    historyDatabase.close({ disableAutoOpen: false });
    await Dexie.delete("History");

    const v1 = new Dexie("History");
    v1.version(1).stores({
      searches: "++id, searchRunId, query, timestamp, source, pinned, results",
      llmResponses: "++id, searchId, searchRunId, timestamp, model",
      chatHistory:
        "++id, conversationId, timestamp, [conversationId+timestamp]",
    });
    const now = Date.now();
    await v1.table("searches").add({
      searchRunId: "live",
      query: "live",
      timestamp: now,
      pinned: false,
    });
    await v1.table("llmResponses").bulkAdd([
      {
        searchRunId: "live",
        prompt: "p",
        response: "kept",
        model: "m",
        timestamp: now,
      },
      {
        searchRunId: "gone",
        prompt: "p",
        response: "orphan",
        model: "m",
        timestamp: now,
      },
    ]);
    await v1.table("chatHistory").bulkAdd([
      { role: "user", content: "kept", timestamp: now, conversationId: "live" },
      {
        role: "user",
        content: "orphan",
        timestamp: now,
        conversationId: "gone",
      },
      {
        role: "user",
        content: "follow-up",
        timestamp: now,
        conversationId: "follow-up-1",
      },
    ]);
    v1.close();

    await historyDatabase.open();

    const answers = await historyDatabase.llmResponses.toArray();
    const chats = await historyDatabase.chatHistory.toArray();
    expect(answers.map((row) => row.response)).toEqual(["kept"]);
    expect(chats.map((row) => row.content)).toEqual(["kept"]);
    expect(await historyDatabase.searches.count()).toBe(1);
  });

  it("indexes the searches pinned before a version 2 database is upgraded", async () => {
    const { getPinnedSearches, historyDatabase } = await import("./history");
    historyDatabase.close({ disableAutoOpen: false });
    await Dexie.delete("History");

    const v2Schema = {
      searches: "++id, searchRunId, query, timestamp, source, pinned, results",
      llmResponses: "++id, searchId, searchRunId, timestamp, model",
      chatHistory:
        "++id, conversationId, timestamp, [conversationId+timestamp]",
    };
    const v2 = new Dexie("History");
    v2.version(1).stores(v2Schema);
    v2.version(2).stores(v2Schema);
    await v2.table("searches").bulkAdd([
      { query: "pinned long ago", timestamp: 1_000, pinned: true },
      { query: "never pinned", timestamp: 2_000, pinned: false },
      { query: "pinned lately", timestamp: 3_000, pinned: true },
    ]);
    v2.close();

    await historyDatabase.open();

    const pinned = await getPinnedSearches();
    expect(pinned.map((search) => [search.query, search.pinnedAt])).toEqual([
      ["pinned lately", 3_000],
      ["pinned long ago", 1_000],
    ]);
    const unpinned = await historyDatabase.searches
      .where("query")
      .equals("never pinned")
      .first();
    expect(unpinned && "pinnedAt" in unpinned).toBe(false);
    // The boolean index never held an entry, so version 3 drops it.
    const indexNames = historyDatabase.searches.schema.indexes.map(
      (index) => index.name,
    );
    expect(indexNames).toContain("pinnedAt");
    expect(indexNames).not.toContain("pinned");
  });
});
