import Dexie, { type Table, type Transaction } from "dexie";
import { addLogEntry } from "./logEntries";
import { getSettings } from "./pubSub";

let currentSearchRunId: string | null = null;

function generateSearchRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function getCurrentSearchRunId(): string {
  if (!currentSearchRunId) {
    currentSearchRunId = generateSearchRunId();
  }
  return currentSearchRunId;
}

/**
 * History is on unless the user turned it off. The check guards every read and
 * write instead of relying on the database being closed: Dexie opens a
 * database that was never opened on its first query, so skipping `open()` at
 * startup does not keep searches out of IndexedDB. Settings saved before the
 * toggle existed have no value, which counts as on, like the default.
 */
export function isHistoryEnabled(): boolean {
  return getSettings().enableHistory !== false;
}

export function setCurrentSearchRunId(id: string): void {
  currentSearchRunId = id;
}

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

export interface TextResults {
  type: "text";
  items: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

export interface ImageResults {
  type: "image";
  items: Array<{
    title: string;
    url: string;
    thumbnail: string;
    sourceUrl?: string;
  }>;
}

/** One saved search; `results` is kept for entries written before the split text/image fields. */
export interface SearchEntry {
  id?: number;
  searchRunId?: string;
  query: string;
  timestamp: number;
  results?: TextResults | ImageResults;
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

/**
 * The key a search's answers and chat turns are stored under. Entries written
 * before `searchRunId` existed use their query, as the readers in
 * `getLatestLlmResponseForEntry` and `useHistoryRestore` do.
 */
function childKeyOf(search: SearchEntry): string {
  return search.searchRunId || search.query;
}

/**
 * Version 1 never removed a search's answers or chat turns with it, and
 * follow-up questions wrote chat rows under `follow-up-*` ids that nothing
 * reads, so an existing install carries rows that no search owns. They are
 * dropped once, on the upgrade. Rows that a search still reads stay.
 */
async function dropRowsNoSearchOwns(tx: Transaction): Promise<void> {
  const searches = await tx.table<SearchEntry>("searches").toArray();
  const liveKeys = new Set(searches.map(childKeyOf));
  await tx
    .table<ChatHistoryMessage>("chatHistory")
    .filter((message) => !liveKeys.has(message.conversationId))
    .delete();
  await tx
    .table<LLMResponse>("llmResponses")
    .filter(
      (response) =>
        !response.searchRunId || !liveKeys.has(response.searchRunId),
    )
    .delete();
}

const historySchema = {
  searches: "++id, searchRunId, query, timestamp, source, pinned, results",
  llmResponses: "++id, searchId, searchRunId, timestamp, model",
  chatHistory: "++id, conversationId, timestamp, [conversationId+timestamp]",
};

class HistoryDatabase extends Dexie {
  searches!: Table<SearchEntry>;
  llmResponses!: Table<LLMResponse>;
  chatHistory!: Table<ChatHistoryMessage>;

  constructor() {
    super("History");

    this.version(1).stores(historySchema);
    this.version(2).stores(historySchema).upgrade(dropRowsNoSearchOwns);
  }

  /**
   * Deletes searches together with their answers and chat turns, in one
   * transaction, so a pruned search never leaves rows behind that the UI can
   * no longer reach. A key that a surviving search still uses (two searches
   * of one run, or two legacy searches with the same query) keeps its rows,
   * because that search reads them.
   */
  async deleteSearchesWithChildren(searches: SearchEntry[]): Promise<void> {
    const ids = searches
      .map((search) => search.id)
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) return;
    const keys = [...new Set(searches.map(childKeyOf))];

    await this.transaction(
      "rw",
      this.searches,
      this.llmResponses,
      this.chatHistory,
      async () => {
        await this.searches.bulkDelete(ids);

        const survivors = [
          ...(await this.searches.where("searchRunId").anyOf(keys).toArray()),
          ...(await this.searches
            .where("query")
            .anyOf(keys)
            .filter((search) => !search.searchRunId)
            .toArray()),
        ];
        const keysInUse = new Set(survivors.map(childKeyOf));
        const ownedKeys = keys.filter((key) => !keysInUse.has(key));

        await this.llmResponses.where("searchRunId").anyOf(ownedKeys).delete();
        await this.llmResponses
          .where("searchId")
          .anyOf(ids)
          .filter((response) => !response.searchRunId)
          .delete();
        await this.chatHistory
          .where("conversationId")
          .anyOf(ownedKeys)
          .delete();
      },
    );
  }

  private cleanupInFlight: Promise<void> | null = null;

  runCleanup(): Promise<void> {
    this.cleanupInFlight ??= this.performCleanup().finally(() => {
      this.cleanupInFlight = null;
    });
    return this.cleanupInFlight;
  }

  async performCleanup(): Promise<void> {
    try {
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
          await this.deleteSearchesWithChildren(oldSearches);
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
          await this.deleteSearchesWithChildren(excess);
          addLogEntry(`Removed ${excess.length} excess search entries`);
        }
      }
    } catch (error) {
      addLogEntry(`Cleanup error: ${error}`);
    }
  }
}

export const historyDatabase = new HistoryDatabase();

export function getResultsFromEntry(
  entry: SearchEntry,
): TextResults | ImageResults | null {
  if (entry.textResults) return entry.textResults;
  if (entry.imageResults) return entry.imageResults;
  return entry.results || null;
}

export function hasTextResults(entry: SearchEntry): boolean {
  return !!(
    entry.textResults ||
    (entry.results && entry.results.type === "text")
  );
}

export function hasImageResults(entry: SearchEntry): boolean {
  return !!(
    entry.imageResults ||
    (entry.results && entry.results.type === "image")
  );
}

export async function updateSearchResults(
  searchRunId: string,
  results: TextResults | ImageResults,
): Promise<void> {
  if (!isHistoryEnabled()) return;
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

export async function addSearchToHistory(
  query: string,
  results: TextResults | ImageResults,
  source: "user" | "followup" | "suggestion" = "user",
): Promise<number | undefined> {
  if (!isHistoryEnabled()) return undefined;
  try {
    const id = await measurePerformance("Add search to history", async () => {
      return await historyDatabase.searches.add({
        searchRunId: getCurrentSearchRunId(),
        query,
        results,
        ...(results.type === "text"
          ? { textResults: results }
          : { imageResults: results }),
        timestamp: Date.now(),
        source,
        pinned: false,
      });
    });
    historyDatabase.runCleanup();
    return id;
  } catch (error) {
    addLogEntry(`Error adding search to history: ${error}`);
    return undefined;
  }
}

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
  if (!isHistoryEnabled()) return;
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
  if (!isHistoryEnabled()) return;
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

export async function clearAllHistory(): Promise<void> {
  await historyDatabase.transaction(
    "rw",
    historyDatabase.searches,
    historyDatabase.llmResponses,
    historyDatabase.chatHistory,
    async () => {
      await Promise.all([
        historyDatabase.searches.clear(),
        historyDatabase.llmResponses.clear(),
        historyDatabase.chatHistory.clear(),
      ]);
    },
  );
}
