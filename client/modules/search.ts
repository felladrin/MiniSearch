import {
  resolveSearchLanguage,
  SEARCH_LANGUAGE_APPLIED_HEADER,
  type SearchLanguage,
} from "@shared/searchLanguage";
import {
  SEARCH_TIME_RANGE_APPLIED_HEADER,
  type SearchTimeRange,
} from "@shared/searchTimeRange";
import { SEARCH_UNIT_CONVERSION_HEADER } from "@shared/unitConversion";
import Dexie, { type Table } from "dexie";
import { sha256 } from "hash-wasm";
import { invalidateConfig } from "./config";
import { addLogEntry } from "./logEntries";
import { getSearchTokenHash } from "./searchTokenHash";
import type { ImageSearchResults, TextSearchResults } from "./types";

const CACHE_CONFIG = {
  TTL: 15 * 60 * 1000,
  MAX_ENTRIES: 100,
  ENABLED: true,
  PRUNE_INTERVAL: 10,
  METRICS_LOG_INTERVAL: 10,
  REQUEST_TIMEOUT: 30000,
  MAX_QUERY_LENGTH: 2000,
  MAX_STALE_RETENTION: 24 * 60 * 60 * 1000,
} as const;

const cacheConfig: {
  ttl: number;
  maxEntries: number;
  enabled: boolean;
} = {
  ttl: CACHE_CONFIG.TTL,
  maxEntries: CACHE_CONFIG.MAX_ENTRIES,
  enabled: CACHE_CONFIG.ENABLED,
};

const cacheMetrics = {
  textHits: 0,
  textMisses: 0,
  imageHits: 0,
  imageMisses: 0,
  totalOperations: 0,
  maxMetricsValue: Number.MAX_SAFE_INTEGER - 1000,

  getTextHitRate(): number {
    const total = this.textHits + this.textMisses;
    return total > 0 ? this.textHits / total : 0;
  },

  getImageHitRate(): number {
    const total = this.imageHits + this.imageMisses;
    return total > 0 ? this.imageHits / total : 0;
  },

  logPerformance(): void {
    addLogEntry(
      `Cache performance - Text: ${(this.getTextHitRate() * 100).toFixed(1)}% hits, ` +
        `Image: ${(this.getImageHitRate() * 100).toFixed(1)}% hits`,
    );
  },

  resetMetrics(): void {
    this.textHits = 0;
    this.textMisses = 0;
    this.imageHits = 0;
    this.imageMisses = 0;
    this.totalOperations = 0;
  },

  incrementTotalOperations(): void {
    this.totalOperations = this.safeIncrement(this.totalOperations);
  },

  shouldLogAndReset(): boolean {
    return (
      this.totalOperations % CACHE_CONFIG.METRICS_LOG_INTERVAL === 0 &&
      this.totalOperations > 0
    );
  },

  safeIncrement(current: number, increment: number = 1): number {
    const maxValue = this.maxMetricsValue;
    if (current >= maxValue) {
      return maxValue;
    }
    const newValue = current + increment;
    return Math.min(newValue, maxValue);
  },
};

const CACHE_METRIC_COUNTERS = [
  "textHits",
  "textMisses",
  "imageHits",
  "imageMisses",
] as const;

type CacheMetricCounterKey = (typeof CACHE_METRIC_COUNTERS)[number];

function incrementCacheMetric(key: CacheMetricCounterKey): void {
  cacheMetrics[key] = cacheMetrics.safeIncrement(cacheMetrics[key]);
}

function logAndMaybeResetMetrics(): void {
  if (!cacheMetrics.shouldLogAndReset()) {
    return;
  }

  cacheMetrics.logPerformance();
  if (cacheMetrics.totalOperations >= cacheMetrics.maxMetricsValue) {
    cacheMetrics.resetMetrics();
  }
}

type CacheStoreName = "textSearchHistory" | "imageSearchHistory";

type SearchResults = TextSearchResults | ImageSearchResults;

interface SearchExecutionConfig {
  storeName: CacheStoreName;
  endpoint: "text" | "images";
  logLabel: string;
  hitMetric: CacheMetricCounterKey;
  missMetric: CacheMetricCounterKey;
}

interface SearchOperations<T extends SearchResults> {
  hashQuery: (
    query: string,
    limit?: number,
    timeRange?: SearchTimeRange,
    language?: string,
  ) => Promise<string>;
  performSearch: (
    endpoint: "text" | "images",
    query: string,
    limit?: number,
    timeRange?: SearchTimeRange,
    language?: string,
  ) => Promise<SearchFetch<T>>;
}

/** What one request answered: its results, and what the server said about them. */
interface SearchFetch<T> {
  results: T;
  /** The server answered from a source that could not apply the time range. */
  timeFilterNotApplied: boolean;
  /**
   * The server answered from a source that could not apply the language. Left
   * out rather than set false, so a search that applied one reads back as it
   * did before the setting existed, in the cache and in the outcome alike.
   */
  languageNotApplied?: boolean;
  /**
   * The unit conversion SearXNG's own plugin computed for the query, kept out
   * of the result array by the header it arrives in. Left out when it answered
   * nothing, the same way the two notes above are.
   */
  unitConversion?: string;
}

interface CachedSearchOutcome<T> {
  results: T;
  stale: boolean;
  /**
   * Set when the results carry no time filter although one was asked for. Left
   * out rather than set false, so a cache entry written before the flag
   * existed reads back as "applied" instead of failing to say anything.
   */
  timeFilterNotApplied?: boolean;
  /**
   * The same, for a search that asked for a language, and left out the same way
   * when the language was applied.
   */
  languageNotApplied?: boolean;
  /** The unit conversion that came with these results, if there was one. */
  unitConversion?: string;
}

async function executeCachedSearch<T extends SearchResults>(
  query: string,
  limit: number | undefined,
  timeRange: SearchTimeRange | undefined,
  language: SearchLanguage | undefined,
  context: SearchExecutionConfig,
  operations: SearchOperations<T>,
): Promise<CachedSearchOutcome<T>> {
  await db.cleanExpiredCache(context.storeName);

  // Resolved here, at search time, so the cache key and the request agree on
  // the locale actually asked for, and "Browser language" keeps following the
  // browser when its locale changes.
  const requestLanguage = resolveSearchLanguage(language, navigator.language);

  const key = await operations.hashQuery(
    query,
    limit,
    timeRange,
    requestLanguage,
  );
  const cachedData = await db.getCachedResult<T>(context.storeName, key);

  if (cachedData?.fresh) {
    incrementCacheMetric(context.hitMetric);
    cacheMetrics.incrementTotalOperations();

    addLogEntry(
      `${context.logLabel}: Reused ${cachedData.results.length} results from the cache`,
    );

    logAndMaybeResetMetrics();
    return {
      results: cachedData.results,
      stale: false,
      timeFilterNotApplied: cachedData.timeFilterNotApplied,
      languageNotApplied: cachedData.languageNotApplied,
      unitConversion: cachedData.unitConversion,
    };
  }

  incrementCacheMetric(context.missMetric);
  cacheMetrics.incrementTotalOperations();

  try {
    const {
      results,
      timeFilterNotApplied,
      languageNotApplied,
      unitConversion,
    } = await operations.performSearch(
      context.endpoint,
      query,
      limit,
      timeRange,
      requestLanguage,
    );

    await db.cacheResult(
      context.storeName,
      key,
      results,
      timeFilterNotApplied,
      languageNotApplied,
      unitConversion,
    );
    logAndMaybeResetMetrics();

    addLogEntry(
      `${context.logLabel}: Fetched ${results.length} results from the API`,
    );

    return {
      results,
      stale: false,
      timeFilterNotApplied,
      languageNotApplied,
      unitConversion,
    };
  } catch (error) {
    if (
      cachedData &&
      cachedData.results.length > 0 &&
      Date.now() - cachedData.timestamp < CACHE_CONFIG.MAX_STALE_RETENTION
    ) {
      logAndMaybeResetMetrics();
      addLogEntry(
        `${context.logLabel}: Live search failed (${
          error instanceof Error ? error.message : String(error)
        }); serving ${cachedData.results.length} result(s) from a previous search`,
      );
      return {
        results: cachedData.results,
        stale: true,
        timeFilterNotApplied: cachedData.timeFilterNotApplied,
        languageNotApplied: cachedData.languageNotApplied,
        unitConversion: cachedData.unitConversion,
      };
    }
    throw error;
  }
}

/** The status the server answers a search with when the token is not its own. */
const UNAUTHORIZED_STATUS = 401;

type SearchAttempt<T> =
  | {
      ok: true;
      results: T;
      timeFilterNotApplied: boolean;
      languageNotApplied?: boolean;
      unitConversion?: string;
    }
  | { ok: false; status: number };

async function buildSearchUrl(
  endpoint: "text" | "images",
  query: string,
  limit: number | undefined,
  timeRange: SearchTimeRange | undefined,
  language: string | undefined,
): Promise<URL> {
  const searchUrl = new URL(`/search/${endpoint}`, self.location.origin);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("token", await getSearchTokenHash());
  if (limit) searchUrl.searchParams.set("limit", limit.toString());
  // Anytime sends no parameter at all, so an unfiltered search asks the server
  // for exactly what it asked before the filter existed. A search with no
  // language does the same, which keeps SearXNG on its own default.
  if (timeRange && timeRange !== "any") {
    searchUrl.searchParams.set("time_range", timeRange);
  }
  if (language) searchUrl.searchParams.set("language", language);
  return searchUrl;
}

/**
 * Names a failed request at the point of failure, where the cause is still
 * known. The timer is the only thing that aborts the controller, so an aborted
 * signal is a timeout whatever rejected, the fetch before the headers or
 * `json()` mid-body. The Fetch spec rejects a network failure with a
 * TypeError in every browser, whatever the wording, and a body that is not
 * JSON fails with a SyntaxError.
 */
function labelSearchFailure(error: unknown, signal: AbortSignal): Error {
  if (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new Error(
      "Request timeout - server did not respond within 30 seconds",
      { cause: error },
    );
  }
  if (error instanceof SyntaxError) {
    return new Error(`JSON parsing error: ${error.message}`, { cause: error });
  }
  if (error instanceof TypeError) {
    return new Error(`Network error: ${error.message}`, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * One request, with the timeout covering the body as well as the response, so
 * a server that answers and then stalls mid-stream still aborts.
 */
async function attemptSearch<T>(searchUrl: URL): Promise<SearchAttempt<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CACHE_CONFIG.REQUEST_TIMEOUT,
  );

  try {
    const response = await fetch(searchUrl.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const results = (await response.json()) as T;

    // Read after the body: a response that dies mid-body is the failure it
    // died on, not a missing header. The server percent-encodes the answer, so
    // this cannot fail on a header it sent; a mangled one fails the search
    // outright rather than showing a conversion nobody asked for.
    const unitConversion = response.headers.get(SEARCH_UNIT_CONVERSION_HEADER);

    return {
      ok: true,
      results,
      timeFilterNotApplied:
        response.headers.get(SEARCH_TIME_RANGE_APPLIED_HEADER) === "false",
      languageNotApplied:
        response.headers.get(SEARCH_LANGUAGE_APPLIED_HEADER) === "false"
          ? true
          : undefined,
      unitConversion: unitConversion
        ? decodeURIComponent(unitConversion)
        : undefined,
    };
  } catch (error) {
    throw labelSearchFailure(error, controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

interface SearchCacheEntry {
  key: string;
  timestamp: number;
  /**
   * Kept with the results so a search served from this cache can still say the
   * time filter was not applied. Absent on every entry written before it.
   */
  timeFilterNotApplied?: boolean;
  /** The same, for a search that asked for a language. */
  languageNotApplied?: boolean;
  /** The same, for the unit conversion that came with these results. */
  unitConversion?: string;
}

interface TextSearchCache extends SearchCacheEntry {
  results: TextSearchResults;
}

interface ImageSearchCache extends SearchCacheEntry {
  results: ImageSearchResults;
}

class SearchCacheDatabase extends Dexie {
  textSearchHistory!: Table<TextSearchCache, string>;
  imageSearchHistory!: Table<ImageSearchCache, string>;
  private _cacheWriteCount: number = 0;

  constructor() {
    super("SearchCache");
    this.version(1).stores({
      textSearchHistory: "key, timestamp",
      imageSearchHistory: "key, timestamp",
    });
  }

  resetCacheWriteCount(): void {
    this._cacheWriteCount = 0;
  }

  async ensureIntegrity(): Promise<void> {
    try {
      await this.textSearchHistory.count();
    } catch (error) {
      addLogEntry(
        `Database integrity check failed, rebuilding: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await this.delete();
        await this.open();
      } catch (recoveryError) {
        addLogEntry(
          `Failed to recover database: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        );
        cacheConfig.enabled = false;
      }
    }
  }

  async cleanExpiredCache(
    storeName: "textSearchHistory" | "imageSearchHistory",
    retention: number = Math.max(
      cacheConfig.ttl,
      CACHE_CONFIG.MAX_STALE_RETENTION,
    ),
  ): Promise<void> {
    const currentTime = Date.now();
    const store = this[storeName];

    try {
      const expiredItems = await store
        .where("timestamp")
        .below(currentTime - retention)
        .toArray();

      if (expiredItems.length > 0) {
        await store.bulkDelete(expiredItems.map((item) => item.key));
        addLogEntry(
          `Removed ${expiredItems.length} expired items from ${storeName}`,
        );
      }
    } catch (error) {
      addLogEntry(
        `Error cleaning expired cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async pruneCache(
    storeName: "textSearchHistory" | "imageSearchHistory",
    maxEntries: number = cacheConfig.maxEntries,
  ): Promise<void> {
    try {
      const store = this[storeName];
      const count = await store.count();

      if (count > maxEntries) {
        const excess = count - maxEntries;
        const oldestEntries = await store
          .orderBy("timestamp")
          .limit(excess)
          .primaryKeys();

        if (oldestEntries.length > 0) {
          await store.bulkDelete(oldestEntries);
          addLogEntry(
            `Pruned ${oldestEntries.length} oldest entries from ${storeName}`,
          );
        }
      }
    } catch (error) {
      addLogEntry(
        `Error pruning cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getCachedResult<T extends TextSearchResults | ImageSearchResults>(
    storeName: "textSearchHistory" | "imageSearchHistory",
    key: string,
  ): Promise<{
    results: T;
    fresh: boolean;
    timestamp: number;
    timeFilterNotApplied?: boolean;
    languageNotApplied?: boolean;
    unitConversion?: string;
  } | null> {
    if (!cacheConfig.enabled) return null;

    try {
      const store = this[storeName] as Table<
        {
          key: string;
          results: T;
          timestamp: number;
          timeFilterNotApplied?: boolean;
          languageNotApplied?: boolean;
          unitConversion?: string;
        },
        string
      >;
      const cachedItem = await store.get(key);

      if (!cachedItem) return null;

      const fresh = Date.now() - cachedItem.timestamp < cacheConfig.ttl;
      return {
        results: cachedItem.results,
        fresh,
        timestamp: cachedItem.timestamp,
        timeFilterNotApplied: cachedItem.timeFilterNotApplied,
        languageNotApplied: cachedItem.languageNotApplied,
        unitConversion: cachedItem.unitConversion,
      };
    } catch (error) {
      addLogEntry(
        `Error retrieving from cache: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async cacheResult<T extends TextSearchResults | ImageSearchResults>(
    storeName: "textSearchHistory" | "imageSearchHistory",
    key: string,
    results: T,
    timeFilterNotApplied?: boolean,
    languageNotApplied?: boolean,
    unitConversion?: string,
  ): Promise<void> {
    if (!cacheConfig.enabled) return;

    try {
      const store = this[storeName] as Table<
        {
          key: string;
          results: T;
          timestamp: number;
          timeFilterNotApplied?: boolean;
          languageNotApplied?: boolean;
          unitConversion?: string;
        },
        string
      >;
      await store.put({
        key,
        results,
        timestamp: Date.now(),
        timeFilterNotApplied,
        languageNotApplied,
        unitConversion,
      });

      const cacheWrites = this._cacheWriteCount;
      this._cacheWriteCount = cacheWrites + 1;

      if (this._cacheWriteCount % CACHE_CONFIG.PRUNE_INTERVAL === 0) {
        this.pruneCache(storeName).catch((error) => {
          addLogEntry(
            `Error during cache pruning: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    } catch (error) {
      addLogEntry(
        `Error caching results: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const db = new SearchCacheDatabase();

db.ensureIntegrity().catch((error) => {
  addLogEntry(
    `Database initialization error: ${error instanceof Error ? error.message : String(error)}`,
  );
});

const searchService = {
  /**
   * The limit, the time range and the language are part of the key, so neither
   * a different limit nor a different period nor a different language can read
   * another one's results. A search with no language and an Anytime search add
   * nothing, so they keep reading the entries cached before those settings
   * existed.
   */
  async hashQuery(
    query: string,
    limit?: number,
    timeRange?: SearchTimeRange,
    language?: string,
  ): Promise<string> {
    let input = limit !== undefined ? `${query}::limit=${limit}` : query;
    if (timeRange && timeRange !== "any") input += `::time_range=${timeRange}`;
    if (language) input += `::language=${language}`;
    const hash = await sha256(input);
    // 16 hex chars are enough for a cache key.
    return hash.slice(0, 16);
  },

  async performSearch<T>(
    endpoint: "text" | "images",
    query: string,
    limit?: number,
    timeRange?: SearchTimeRange,
    language?: string,
  ): Promise<SearchFetch<T>> {
    if (!["text", "images"].includes(endpoint)) {
      throw new Error(
        `Invalid endpoint type: ${endpoint}. Must be "text" or "images"`,
      );
    }

    if (!query || query.trim() === "") {
      throw new Error("Query cannot be empty or whitespace only");
    }

    if (query.length > CACHE_CONFIG.MAX_QUERY_LENGTH) {
      throw new Error(
        `Query length exceeds maximum of ${CACHE_CONFIG.MAX_QUERY_LENGTH} characters`,
      );
    }

    let attempt = await attemptSearch<T>(
      await buildSearchUrl(endpoint, query, limit, timeRange, language),
    );

    // Every server process mints its own search token, so a restart leaves
    // this page hashing one the server never issued. Drop the cached config,
    // take the token the server is handing out now, and try once more. The
    // retry runs once per request: a second rejection is a real one, and is
    // reported as the failure it is.
    if (!attempt.ok && attempt.status === UNAUTHORIZED_STATUS) {
      addLogEntry(
        "Search token was rejected; refreshing it and retrying the search",
      );
      invalidateConfig();
      attempt = await attemptSearch<T>(
        await buildSearchUrl(endpoint, query, limit, timeRange, language),
      );
    }

    if (!attempt.ok) {
      throw new Error(`HTTP error! status: ${attempt.status}`);
    }

    return {
      results: attempt.results,
      timeFilterNotApplied: attempt.timeFilterNotApplied,
      languageNotApplied: attempt.languageNotApplied,
      unitConversion: attempt.unitConversion,
    };
  },

  async searchText(
    query: string,
    limit?: number,
    timeRange?: SearchTimeRange,
    language?: SearchLanguage,
  ): Promise<CachedSearchOutcome<TextSearchResults>> {
    try {
      return await executeCachedSearch<TextSearchResults>(
        query,
        limit,
        timeRange,
        language,
        {
          storeName: "textSearchHistory",
          endpoint: "text",
          logLabel: "Text search",
          hitMetric: "textHits",
          missMetric: "textMisses",
        },
        {
          hashQuery: this.hashQuery,
          performSearch: this.performSearch,
        },
      );
    } catch (error) {
      // Rethrow so the caller can tell a failed search apart from one that
      // genuinely has no results; an empty array means zero results only.
      addLogEntry(
        `Text search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  },

  async searchImages(
    query: string,
    limit?: number,
    timeRange?: SearchTimeRange,
    language?: SearchLanguage,
  ): Promise<CachedSearchOutcome<ImageSearchResults>> {
    try {
      return await executeCachedSearch<ImageSearchResults>(
        query,
        limit,
        timeRange,
        language,
        {
          storeName: "imageSearchHistory",
          endpoint: "images",
          logLabel: "Image search",
          hitMetric: "imageHits",
          missMetric: "imageMisses",
        },
        {
          hashQuery: this.hashQuery,
          performSearch: this.performSearch,
        },
      );
    } catch (error) {
      // Rethrow so the caller can tell a failed search apart from one that
      // genuinely has no results; an empty array means zero results only.
      addLogEntry(
        `Image search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  },

  async clearSearchCache(): Promise<void> {
    try {
      await db.close();
      await db.delete();
      db.resetCacheWriteCount();
      await db.open();
      cacheMetrics.resetMetrics();

      addLogEntry("Search cache cleared successfully");
    } catch (error) {
      addLogEntry(
        `Failed to clear search cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  getCacheStats() {
    return {
      textHitRate: cacheMetrics.getTextHitRate(),
      imageHitRate: cacheMetrics.getImageHitRate(),
      textHits: cacheMetrics.textHits,
      textMisses: cacheMetrics.textMisses,
      imageHits: cacheMetrics.imageHits,
      imageMisses: cacheMetrics.imageMisses,
      config: { ...cacheConfig },
    };
  },

  updateCacheConfig(newConfig: Partial<typeof cacheConfig>) {
    if (newConfig.ttl !== undefined && newConfig.ttl < 0) {
      throw new Error(
        `Invalid TTL value: ${newConfig.ttl}. TTL must be non-negative`,
      );
    }
    if (newConfig.maxEntries !== undefined && newConfig.maxEntries < 0) {
      throw new Error(
        `Invalid maxEntries value: ${newConfig.maxEntries}. maxEntries must be non-negative`,
      );
    }

    Object.assign(cacheConfig, newConfig);
    addLogEntry(
      `Cache configuration updated: TTL=${cacheConfig.ttl}ms, maxEntries=${cacheConfig.maxEntries}, enabled=${cacheConfig.enabled}`,
    );
  },
};

export const searchText = searchService.searchText.bind(searchService);
export const searchImages = searchService.searchImages.bind(searchService);
export const searchServiceInstance = searchService;
