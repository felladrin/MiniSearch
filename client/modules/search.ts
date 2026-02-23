import Dexie, { type Table } from "dexie";
import { addLogEntry } from "./logEntries";
import { getSearchTokenHash } from "./searchTokenHash";
import type { ImageSearchResults, TextSearchResults } from "./types";

/**
 * Configuration constants for search caching
 */
const CACHE_CONFIG = {
  /** Time to live for cache entries in milliseconds */
  TTL: 15 * 60 * 1000,
  /** Maximum number of entries to cache */
  MAX_ENTRIES: 100,
  /** Whether caching is enabled */
  ENABLED: true,
  /** Cache write operations before pruning */
  PRUNE_INTERVAL: 10,
  /** Metrics logging interval */
  METRICS_LOG_INTERVAL: 10,
  /** Request timeout in milliseconds */
  REQUEST_TIMEOUT: 30000,
  /** Maximum query length */
  MAX_QUERY_LENGTH: 2000,
} as const;

const cacheConfig: {
  ttl: number;
  maxEntries: number;
  enabled: boolean;
} = {
  /** Time to live for cache entries in milliseconds */
  ttl: CACHE_CONFIG.TTL,
  /** Maximum number of entries to cache */
  maxEntries: CACHE_CONFIG.MAX_ENTRIES,
  /** Whether caching is enabled */
  enabled: CACHE_CONFIG.ENABLED,
};

/**
 * Metrics for tracking cache performance
 */
const cacheMetrics = {
  textHits: 0,
  textMisses: 0,
  imageHits: 0,
  imageMisses: 0,
  totalOperations: 0,
  maxMetricsValue: Number.MAX_SAFE_INTEGER - 1000,

  /**
   * Calculates the text search cache hit rate
   * @returns Hit rate as a percentage between 0 and 1
   */
  getTextHitRate(): number {
    const total = this.textHits + this.textMisses;
    return total > 0 ? this.textHits / total : 0;
  },

  /**
   * Calculates the image search cache hit rate
   * @returns Hit rate as a percentage between 0 and 1
   */
  getImageHitRate(): number {
    const total = this.imageHits + this.imageMisses;
    return total > 0 ? this.imageHits / total : 0;
  },

  /**
   * Logs current cache performance metrics
   */
  logPerformance(): void {
    addLogEntry(
      `Cache performance - Text: ${(this.getTextHitRate() * 100).toFixed(1)}% hits, ` +
        `Image: ${(this.getImageHitRate() * 100).toFixed(1)}% hits`,
    );
  },

  /**
   * Resets all metrics to prevent overflow
   */
  resetMetrics(): void {
    this.textHits = 0;
    this.textMisses = 0;
    this.imageHits = 0;
    this.imageMisses = 0;
    this.totalOperations = 0;
  },

  /**
   * Increments total operations counter
   */
  incrementTotalOperations(): void {
    this.totalOperations = this.safeIncrement(this.totalOperations);
  },

  /**
   * Checks if metrics should be logged and potentially reset
   */
  shouldLogAndReset(): boolean {
    return (
      this.totalOperations % CACHE_CONFIG.METRICS_LOG_INTERVAL === 0 &&
      this.totalOperations > 0
    );
  },

  /**
   * Safely increments a metric value, preventing overflow
   */
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
  hashQuery: (query: string) => string;
  performSearch: (
    endpoint: "text" | "images",
    query: string,
    limit?: number,
  ) => Promise<T>;
}

async function executeCachedSearch<T extends SearchResults>(
  query: string,
  limit: number | undefined,
  context: SearchExecutionConfig,
  operations: SearchOperations<T>,
): Promise<T> {
  await db.cleanExpiredCache(context.storeName);

  const key = operations.hashQuery(query);
  const cachedData = await db.getCachedResult<T>(context.storeName, key);

  if (cachedData?.fresh) {
    incrementCacheMetric(context.hitMetric);
    cacheMetrics.incrementTotalOperations();

    addLogEntry(
      `${context.logLabel}: Reused ${cachedData.results.length} results from the cache`,
    );

    logAndMaybeResetMetrics();
    return cachedData.results;
  }

  incrementCacheMetric(context.missMetric);
  cacheMetrics.incrementTotalOperations();

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

  return results;
}

/**
 * Base interface for search cache entries
 */
interface SearchCacheEntry {
  /** Unique key for the cache entry */
  key: string;
  /** Timestamp when the entry was created */
  timestamp: number;
}

/**
 * Interface for text search cache entries
 */
interface TextSearchCache extends SearchCacheEntry {
  /** Cached text search results */
  results: TextSearchResults;
}

/**
 * Interface for image search cache entries
 */
interface ImageSearchCache extends SearchCacheEntry {
  /** Cached image search results */
  results: ImageSearchResults;
}

/**
 * IndexedDB database for search cache management
 */
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

  /**
   * Resets the cache write counter
   */
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
    timeToLive: number = cacheConfig.ttl,
  ): Promise<void> {
    const currentTime = Date.now();
    const store = this[storeName];

    try {
      const expiredItems = await store
        .where("timestamp")
        .below(currentTime - timeToLive)
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
  ): Promise<{ results: T; fresh: boolean } | null> {
    if (!cacheConfig.enabled) return null;

    try {
      const store = this[storeName] as Table<
        { key: string; results: T; timestamp: number },
        string
      >;
      const cachedItem = await store.get(key);

      if (!cachedItem) return null;

      const fresh = Date.now() - cachedItem.timestamp < cacheConfig.ttl;
      return { results: cachedItem.results, fresh };
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
   * Generates a hash for query caching
   * Uses a more robust hashing algorithm to minimize collisions
   */
  hashQuery(query: string): string {
    // Use a combination of hash algorithms to reduce collision risk
    const djb2 = (str: string) => {
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) + hash + char;
      }
      return hash >>> 0;
    };

    const murmur = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 0x5bd1e9);
        hash = Math.imul(hash ^ (hash >>> 6), 0x5bd1e9);
      }
      return (hash >>> 0) ^ 0x5bd1e9;
    };

    // Combine multiple hash algorithms for better distribution
    const combined = djb2(query) ^ murmur(query);
    return combined.toString(36);
  },

  async performSearch<T>(
    endpoint: "text" | "images",
    query: string,
    limit?: number,
  ): Promise<T> {
    // Validate endpoint type
    if (!["text", "images"].includes(endpoint)) {
      throw new Error(
        `Invalid endpoint type: ${endpoint}. Must be "text" or "images"`,
      );
    }

    // Validate query
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

  async searchText(query: string, limit?: number): Promise<TextSearchResults> {
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
      addLogEntry(
        `Text search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  },

  async searchImages(
    query: string,
    limit?: number,
  ): Promise<ImageSearchResults> {
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
      addLogEntry(
        `Image search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  },

  async clearSearchCache(): Promise<void> {
    try {
      // Close existing connection before deletion
      await db.close();

      // Delete and recreate database
      await db.delete();

      // Reset cache write counter
      db.resetCacheWriteCount();

      // Reopen database with same schema
      await db.open();

      // Reset metrics
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
    // Validate configuration values
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
