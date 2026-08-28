import Dexie, { type Table } from "dexie";
import { sha256 } from "hash-wasm";
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
    return newValue > maxValue ? maxValue : newValue;
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
  hashQuery: (query: string, limit?: number) => Promise<string>;
  performSearch: (
    endpoint: "text" | "images",
    query: string,
    limit?: number,
  ) => Promise<T>;
}

interface CachedSearchOutcome<T> {
  results: T;
  stale: boolean;
}

async function executeCachedSearch<T extends SearchResults>(
  query: string,
  limit: number | undefined,
  context: SearchExecutionConfig,
  operations: SearchOperations<T>,
): Promise<CachedSearchOutcome<T>> {
  await db.cleanExpiredCache(context.storeName);

  const key = await operations.hashQuery(query, limit);
  const cachedData = await db.getCachedResult<T>(context.storeName, key);

  if (cachedData?.fresh) {
    incrementCacheMetric(context.hitMetric);
    cacheMetrics.incrementTotalOperations();

    addLogEntry(
      `${context.logLabel}: Reused ${cachedData.results.length} results from the cache`,
    );

    logAndMaybeResetMetrics();
    return { results: cachedData.results, stale: false };
  }

  incrementCacheMetric(context.missMetric);
  cacheMetrics.incrementTotalOperations();

  try {
    const results = await operations.performSearch(
      context.endpoint,
      query,
      limit,
    );

    await db.cacheResult(context.storeName, key, results);
    logAndMaybeResetMetrics();

    addLogEntry(
      `${context.logLabel}: Fetched ${results.length} results from the API`,
    );

    return { results, stale: false };
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
      return { results: cachedData.results, stale: true };
    }
    throw error;
  }
}

interface SearchCacheEntry {
  key: string;
  timestamp: number;
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
  ): Promise<{ results: T; fresh: boolean; timestamp: number } | null> {
    if (!cacheConfig.enabled) return null;

    try {
      const store = this[storeName] as Table<
        { key: string; results: T; timestamp: number },
        string
      >;
      const cachedItem = await store.get(key);

      if (!cachedItem) return null;

      const fresh = Date.now() - cachedItem.timestamp < cacheConfig.ttl;
      return {
        results: cachedItem.results,
        fresh,
        timestamp: cachedItem.timestamp,
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
  ): Promise<void> {
    if (!cacheConfig.enabled) return;

    try {
      const store = this[storeName] as Table<
        { key: string; results: T; timestamp: number },
        string
      >;
      await store.put({
        key,
        results,
        timestamp: Date.now(),
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
   * Generates a SHA-256 hash for query caching.
   * Includes the limit in the hash input so that different limits
   * produce different cache keys (fixes stale results when limit changes).
   */
  async hashQuery(query: string, limit?: number): Promise<string> {
    const input = limit !== undefined ? `${query}::limit=${limit}` : query;
    const hash = await sha256(input);
    // Return first 16 hex chars — enough for cache keys, shorter than full 64
    return hash.slice(0, 16);
  },

  async performSearch<T>(
    endpoint: "text" | "images",
    query: string,
    limit?: number,
  ): Promise<T> {
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

    const searchUrl = new URL(`/search/${endpoint}`, self.location.origin);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("token", await getSearchTokenHash());
    if (limit) searchUrl.searchParams.set("limit", limit.toString());

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
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      try {
        return await response.json();
      } catch (parseError) {
        throw new Error(
          `JSON parsing error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            "Request timeout - server did not respond within 30 seconds",
          );
        }
        if (error.message.includes("network")) {
          throw new Error(`Network error: ${error.message}`);
        }
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async searchText(
    query: string,
    limit?: number,
  ): Promise<CachedSearchOutcome<TextSearchResults>> {
    try {
      return await executeCachedSearch<TextSearchResults>(
        query,
        limit,
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
  ): Promise<CachedSearchOutcome<ImageSearchResults>> {
    try {
      return await executeCachedSearch<ImageSearchResults>(
        query,
        limit,
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
