import Dexie, { type Table } from "dexie";
import { addLogEntry } from "./logEntries";

let currentSearchRunId: string | null = null;

function generateSearchRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Gets the current search run ID, generating one if it doesn't exist
 * @returns The current search run ID
 */
export function getCurrentSearchRunId(): string {
  if (!currentSearchRunId) {
    currentSearchRunId = generateSearchRunId();
  }
  return currentSearchRunId;
}

/**
 * Sets the current search run ID
 * @param id - The search run ID to set
 */
export function setCurrentSearchRunId(id: string): void {
  currentSearchRunId = id;
}

/**
 * Resets the current search run ID to null
 */
export function resetSearchRunId(): void {
  currentSearchRunId = null;
}

function measurePerformance<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = performance.now();
  return fn().then(
    (result) => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      if (duration > 100) {
        addLogEntry(`${operation} completed in ${duration.toFixed(2)}ms`);
      }
      return result;
    },
    (error) => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      addLogEntry(
        `${operation} failed after ${duration.toFixed(2)}ms: ${error}`,
      );
      throw error;
    },
  );
}

/**
 * Text search results structure
 */
export interface TextResults {
  type: "text";
  items: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

/**
 * Image search results structure
 */
export interface ImageResults {
  type: "image";
  items: Array<{
    title: string;
    url: string;
    thumbnail: string;
    sourceUrl?: string;
  }>;
}

/**
 * Search history entry structure
 */
export interface SearchEntry {
  id?: number;
  searchRunId?: string;
  query: string;
  timestamp: number;
  results?: TextResults | ImageResults; // Legacy field for backward compatibility
  textResults?: TextResults;
  imageResults?: ImageResults;
  llmResponse?: string;
  chatMessages?: Array<{
    role: string;
    content: string;
  }>;
  pinned?: boolean;
  source?: string;
}

interface LLMResponse {
  id?: number;
  searchRunId?: string;
  prompt: string;
  response: string;
  model: string;
  timestamp: number;
  searchId?: number;
  quality?: number;
}

interface ChatHistoryMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  conversationId: string;
  metadata?: Record<string, unknown>;
}

class HistoryDatabase extends Dexie {
  searches!: Table<SearchEntry>;
  llmResponses!: Table<LLMResponse>;
  chatHistory!: Table<ChatHistoryMessage>;

  constructor() {
    super("History");

    this.version(1).stores({
      searches: "++id, searchRunId, query, timestamp, source, pinned, results",
      llmResponses: "++id, searchId, searchRunId, timestamp, model",
      chatHistory:
        "++id, conversationId, timestamp, [conversationId+timestamp]",
    });

    this.searches.hook("creating", () => {
      this.performCleanup().catch((error) => {
        addLogEntry(`Cleanup hook error: ${error}`);
      });
    });
  }

  async performCleanup(): Promise<void> {
    try {
      const { getSettings } = await import("./pubSub");
      const globalSettings = getSettings();
      const settings = {
        autoCleanup: globalSettings.historyAutoCleanup,
        retentionDays: globalSettings.historyRetentionDays,
        maxEntries: globalSettings.historyMaxEntries,
      };
      if (!settings.autoCleanup) return;

      if (settings.retentionDays > 0) {
        const cutoffTime =
          Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000;

        const oldSearches = await this.searches
          .where("timestamp")
          .below(cutoffTime)
          .and((search) => !search.pinned)
          .limit(100)
          .toArray();

        if (oldSearches.length > 0) {
          await this.searches.bulkDelete(
            oldSearches
              .map((s) => s.id)
              .filter((id): id is number => id !== undefined),
          );
          addLogEntry(`Cleaned up ${oldSearches.length} old search entries`);
        }
      }

      const totalCount = await this.searches.count();
      if (totalCount > settings.maxEntries) {
        const excess = await this.searches
          .orderBy("timestamp")
          .reverse()
          .offset(settings.maxEntries)
          .filter((search) => !search.pinned)
          .toArray();

        if (excess.length > 0) {
          await this.searches.bulkDelete(
            excess
              .map((s) => s.id)
              .filter((id): id is number => id !== undefined),
          );
          addLogEntry(`Removed ${excess.length} excess search entries`);
        }
      }
    } catch (error) {
      addLogEntry(`Cleanup error: ${error}`);
    }
  }
}

/**
 * History database instance for search history management
 */
export const historyDatabase = new HistoryDatabase();

/**
 * Helper function to get results from a search entry with backward compatibility
 * @param entry - The search entry
 * @returns The appropriate results object (text or image) or null
 */
export function getResultsFromEntry(
  entry: SearchEntry,
): TextResults | ImageResults | null {
  // First try new structure
  if (entry.textResults) return entry.textResults;
  if (entry.imageResults) return entry.imageResults;

  // Fallback to legacy structure
  return entry.results || null;
}

/**
 * Helper function to check if an entry has text results
 * @param entry - The search entry
 * @returns True if the entry has text results
 */
export function hasTextResults(entry: SearchEntry): boolean {
  return !!(
    entry.textResults ||
    (entry.results && entry.results.type === "text")
  );
}

/**
 * Helper function to check if an entry has image results
 * @param entry - The search entry
 * @returns True if the entry has image results
 */
export function hasImageResults(entry: SearchEntry): boolean {
  return !!(
    entry.imageResults ||
    (entry.results && entry.results.type === "image")
  );
}

/**
 * Updates search results for a given search run ID
 * @param searchRunId - The search run ID to update
 * @param results - The search results to update (text or image)
 */
export async function updateSearchResults(
  searchRunId: string,
  results: TextResults | ImageResults,
): Promise<void> {
  try {
    await measurePerformance("Update search results", async () => {
      const latest = await historyDatabase.searches
        .where("searchRunId")
        .equals(searchRunId)
        .first();

      if (latest?.id !== undefined) {
        const updatedEntry = { ...latest };
        if (results.type === "text") {
          updatedEntry.textResults = results;
        } else {
          updatedEntry.imageResults = results;
        }
        await historyDatabase.searches.update(latest.id, updatedEntry);
      }
    });
  } catch (error) {
    addLogEntry(`Error updating search results: ${error}`);
  }
}

/**
 * Adds a search entry to the history
 * @param query - The search query
 * @param results - The search results (text or image)
 * @param source - The source of the search (user, followup, or suggestion)
 * @returns Promise resolving to the ID of the added entry
 */
export async function addSearchToHistory(
  query: string,
  results: TextResults | ImageResults,
  source: "user" | "followup" | "suggestion" = "user",
): Promise<number | undefined> {
  return measurePerformance("Add search to history", async () => {
    return await historyDatabase.searches.add({
      searchRunId: getCurrentSearchRunId(),
      query,
      results, // Store in legacy field for backward compatibility
      ...(results.type === "text"
        ? { textResults: results }
        : { imageResults: results }),
      timestamp: Date.now(),
      source,
      pinned: false,
    });
  }).catch((error) => {
    addLogEntry(`Error adding search to history: ${error}`);
    return undefined;
  });
}

/**
 * Gets recent searches from history
 * @param limit - Maximum number of searches to retrieve
 * @returns Promise resolving to array of recent search entries
 */
export async function getRecentSearches(
  limit: number = 10,
): Promise<SearchEntry[]> {
  return measurePerformance("Get recent searches", async () => {
    return await historyDatabase.searches
      .orderBy("timestamp")
      .reverse()
      .limit(limit)
      .toArray();
  }).catch((error) => {
    addLogEntry(`Error fetching recent searches: ${error}`);
    return [];
  });
}

export async function saveLlmResponseForQuery(
  query: string,
  response: string,
  model: string = "",
): Promise<void> {
  try {
    const searchRunId = getCurrentSearchRunId();
    const latest = await historyDatabase.searches
      .where("searchRunId")
      .equals(searchRunId)
      .first();

    await historyDatabase.llmResponses.add({
      searchRunId,
      prompt: query,
      response,
      model,
      timestamp: Date.now(),
      searchId: latest?.id,
    });
  } catch (error) {
    addLogEntry(`Error saving LLM response: ${error}`);
  }
}

export async function getLatestLlmResponseForEntry(
  entry: SearchEntry,
): Promise<string | null> {
  try {
    const searchRunId = entry.searchRunId || entry.query;
    const records = await historyDatabase.llmResponses
      .where("searchRunId")
      .equals(searchRunId)
      .toArray();
    if (records.length > 0) {
      const latest = records.reduce((a, b) =>
        a.timestamp > b.timestamp ? a : b,
      );
      return latest.response;
    }
    return null;
  } catch (error) {
    addLogEntry(`Error getting latest LLM response: ${error}`);
    return null;
  }
}

export async function saveChatMessageForQuery(
  _query: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  try {
    const searchRunId = getCurrentSearchRunId();
    await historyDatabase.chatHistory.add({
      role,
      content,
      timestamp: Date.now(),
      conversationId: searchRunId,
    });
  } catch (error) {
    addLogEntry(`Error saving chat message: ${error}`);
  }
}

export async function getChatMessagesForQuery(
  searchRunId: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const messages = await historyDatabase.chatHistory
      .where("conversationId")
      .equals(searchRunId)
      .sortBy("timestamp");
    return messages.map((msg) => ({ role: msg.role, content: msg.content }));
  } catch (error) {
    addLogEntry(`Error getting chat messages: ${error}`);
    return [];
  }
}
