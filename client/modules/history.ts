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
  /**
   * When the entry was pinned; absent while unpinned. It is indexed in place of
   * `pinned`, because IndexedDB does not index boolean values, so only pinned
   * entries are in this index. `togglePin` writes both fields in one update.
   */
  pinnedAt?: number;
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

/**
 * Entries pinned before `pinnedAt` existed get one, so the index finds them.
 * Their real pin time is unknown; the entry's own `timestamp` stands in, which
 * keeps a plausible pin order.
 */
async function indexPinnedEntries(tx: Transaction): Promise<void> {
  await tx
    .table<SearchEntry>("searches")
    .filter((search) => search.pinned === true)
    .modify((search) => {
      search.pinnedAt = search.timestamp;
    });
}

const historySchema = {
  searches: "++id, searchRunId, query, timestamp, source, pinned, results",
  llmResponses: "++id, searchId, searchRunId, timestamp, model",
  chatHistory: "++id, conversationId, timestamp, [conversationId+timestamp]",
};

/**
 * Version 3 drops the `pinned` index, which never held an entry (IndexedDB
 * does not index booleans), and indexes `pinnedAt` instead. The `pinned`
 * field itself stays.
 */
const historySchemaV3 = {
  ...historySchema,
  searches: "++id, searchRunId, query, timestamp, source, pinnedAt, results",
};

class HistoryDatabase extends Dexie {
  searches!: Table<SearchEntry>;
  llmResponses!: Table<LLMResponse>;
  chatHistory!: Table<ChatHistoryMessage>;

  constructor() {
    super("History");

    this.version(1).stores(historySchema);
    this.version(2).stores(historySchema).upgrade(dropRowsNoSearchOwns);
    this.version(3).stores(historySchemaV3).upgrade(indexPinnedEntries);
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
    await measurePerformance("Update search results", () =>
      // One transaction, so a text write and an image write that overlap
      // cannot each put back the other's old field.
      historyDatabase.transaction("rw", historyDatabase.searches, async () => {
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
      }),
    );
  } catch (error) {
    addLogEntry(`Error updating search results: ${error}`);
  }
}

/**
 * Adds `results` to the images stored for the search instead of replacing them.
 * Every image write goes through here: the screen can lack images the stored
 * list has (a late first search merged after the user left and came back), so
 * replacing it with the screen's list would drop them. A URL is stored once.
 * With `newFirst`, the new images go ahead of the stored ones; otherwise after.
 */
export async function mergeSearchImageResults(
  searchRunId: string,
  results: ImageResults,
  { newFirst = true } = {},
): Promise<void> {
  if (!isHistoryEnabled()) return;
  try {
    await measurePerformance("Merge image results", () =>
      historyDatabase.transaction("rw", historyDatabase.searches, async () => {
        const latest = await historyDatabase.searches
          .where("searchRunId")
          .equals(searchRunId)
          .first();
        if (latest?.id === undefined) return;

        const storedItems =
          (
            latest.imageResults ??
            (latest.results?.type === "image" ? latest.results : undefined)
          )?.items ?? [];
        const newUrls = new Set(results.items.map((item) => item.url));
        const keptItems = storedItems.filter((item) => !newUrls.has(item.url));
        await historyDatabase.searches.update(latest.id, {
          imageResults: {
            type: "image",
            items: newFirst
              ? [...results.items, ...keptItems]
              : [...keptItems, ...results.items],
          },
        });
      }),
    );
  } catch (error) {
    addLogEntry(`Error merging image results: ${error}`);
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

/** What the analytics need of a saved search: when it happened and where it came from. */
export interface SearchActivityRecord {
  timestamp: number;
  source?: string;
}

/**
 * Every saved search as a timestamp and a source, read from the two indexes
 * alone, so the result payloads (which dominate a row's size) are never
 * loaded. The analytics have to see the whole table, and a table can hold
 * 10,000 rows. A search saved without a source has no entry in the `source`
 * index, so it comes back without one.
 */
export async function getSearchActivityRecords(): Promise<
  SearchActivityRecord[]
> {
  return measurePerformance("Get search activity", () =>
    historyDatabase.transaction("r", historyDatabase.searches, async () => {
      const byTime = historyDatabase.searches.orderBy("timestamp");
      const [timestamps, ids, distinctSources] = await Promise.all([
        byTime.keys(),
        byTime.primaryKeys(),
        historyDatabase.searches.orderBy("source").uniqueKeys(),
      ]);

      // A handful of sources exist ("user", "followup", "suggestion"), so one
      // index lookup per source is far cheaper than walking the whole index.
      const sourceById = new Map<unknown, string>();
      await Promise.all(
        distinctSources.map(async (source) => {
          const sourceIds = await historyDatabase.searches
            .where("source")
            .equals(source)
            .primaryKeys();
          for (const id of sourceIds) sourceById.set(id, String(source));
        }),
      );

      return ids.map((id, index) => ({
        timestamp: Number(timestamps[index]),
        source: sourceById.get(id),
      }));
    }),
  ).catch((error) => {
    addLogEntry(`Error fetching search activity: ${error}`);
    return [];
  });
}

/**
 * Every pinned search, newest first, however old. Cleanup never deletes a
 * pinned entry, so a window of recent searches would sooner or later leave
 * some out. Only pinned entries have a `pinnedAt`, so its index reads them
 * alone, without scanning the table.
 */
export async function getPinnedSearches(): Promise<SearchEntry[]> {
  return measurePerformance("Get pinned searches", async () => {
    const pinned = await historyDatabase.searches.orderBy("pinnedAt").toArray();
    return pinned.sort((a, b) => b.timestamp - a.timestamp);
  }).catch((error) => {
    addLogEntry(`Error fetching pinned searches: ${error}`);
    return [];
  });
}

export async function saveLlmResponseForQuery(
  query: string,
  response: string,
  model: string = "",
  searchRunId = getCurrentSearchRunId(),
): Promise<void> {
  if (!isHistoryEnabled()) return;
  try {
    await historyDatabase.transaction(
        "rw",
      historyDatabase.searches,
      historyDatabase.llmResponses,
      async () => {
          const latest = await historyDatabase.searches
                .where("searchRunId")
          .equals(searchRunId)
          .first();
    if (latest?.id === undefined) return;
    
        await historyDatabase.llmResponses.add({
          searchRunId,
          prompt: query,
          response,
          model,
          timestamp: Date.now(),
          searchId: latest.id,
        });
      }  ,
  );
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

/**
 * The only chat write: makes `messages` the stored follow-up conversation of
 * `conversationId`. Regenerate and edit rewrite the conversation rather than
 * append to it, so one transaction deletes the conversation's rows and adds
 * the new ones, with increasing timestamps to keep their order. Other
 * conversations are untouched, and an empty list removes the conversation.
 */
export async function replaceChatConversation(
  conversationId: string,
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  if (!isHistoryEnabled()) return;
  const firstTimestamp = Date.now();
  await historyDatabase.transaction(
    "rw",
    historyDatabase.chatHistory,
    async () => {
      await historyDatabase.chatHistory
        .where("conversationId")
        .equals(conversationId)
        .delete();
      await historyDatabase.chatHistory.bulkAdd(
        messages.map((message, index) => ({
          role: message.role,
          content: message.content,
          timestamp: firstTimestamp + index,
          conversationId,
        })),
      );
    },
  );
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
