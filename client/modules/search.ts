import Dexie, { type Table } from "dexie";
import { name } from "../../package.json";
import { addLogEntry } from "./logEntries";
import { getSearchTokenHash } from "./searchTokenHash";
import type { ImageSearchResults, TextSearchResults } from "./types";

const cacheConfig = {
  ttl: 15 * 60 * 1000,
  maxEntries: 100,
  enabled: true,
};

const cacheMetrics = {
  textHits: 0,
  textMisses: 0,
  imageHits: 0,
  imageMisses: 0,

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
};

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

class SearchDb extends Dexie {
  textSearchHistory!: Table<TextSearchCache, string>;
  imageSearchHistory!: Table<ImageSearchCache, string>;

  constructor() {
    super(name);
    this.version(1).stores({
      textSearchHistory: "key, timestamp",
      imageSearchHistory: "key, timestamp",
    });
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

      this.pruneCache(storeName).catch((error) => {
        addLogEntry(
          `Error during cache pruning: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    } catch (error) {
      addLogEntry(
        `Error caching results: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const db = new SearchDb();

db.ensureIntegrity().catch((error) => {
  addLogEntry(
    `Database initialization error: ${error instanceof Error ? error.message : String(error)}`,
  );
});

const searchService = {
  hashQuery(query: string): string {
    return query
      .split("")
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
      .toString(36);
  },

  async performSearch<T>(
    endpoint: "text" | "images",
    query: string,
    limit?: number,
  ): Promise<T> {
    const searchUrl = new URL(`/search/${endpoint}`, self.location.origin);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("token", await getSearchTokenHash());
    if (limit) searchUrl.searchParams.set("limit", limit.toString());

    const response = await fetch(searchUrl.toString());
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  },

  async searchText(query: string, limit?: number): Promise<TextSearchResults> {
    try {
      await db.cleanExpiredCache("textSearchHistory");

      const key = this.hashQuery(query);
      const cachedData = await db.getCachedResult<TextSearchResults>(
        "textSearchHistory",
        key,
      );

      if (cachedData?.fresh) {
        cacheMetrics.textHits++;
        addLogEntry(
          `Text search: Reused ${cachedData.results.length} results from the cache`,
        );
        return cachedData.results;
      }

      cacheMetrics.textMisses++;

      const results = await this.performSearch<TextSearchResults>(
        "text",
        query,
        limit,
      );

      await db.cacheResult("textSearchHistory", key, results);

      if ((cacheMetrics.textHits + cacheMetrics.textMisses) % 10 === 0) {
        cacheMetrics.logPerformance();
      }

      addLogEntry(
        `Text search: Fetched ${results.length} results from the API`,
      );

      return results;
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
      await db.cleanExpiredCache("imageSearchHistory");

      const key = this.hashQuery(query);
      const cachedData = await db.getCachedResult<ImageSearchResults>(
        "imageSearchHistory",
        key,
      );

      if (cachedData?.fresh) {
        cacheMetrics.imageHits++;
        addLogEntry(
          `Image search: Reused ${cachedData.results.length} results from the cache`,
        );
        return cachedData.results;
      }

      cacheMetrics.imageMisses++;

      const results = await this.performSearch<ImageSearchResults>(
        "images",
        query,
        limit,
      );

      await db.cacheResult("imageSearchHistory", key, results);

      if ((cacheMetrics.imageHits + cacheMetrics.imageMisses) % 10 === 0) {
        cacheMetrics.logPerformance();
      }

      addLogEntry(
        `Image search: Fetched ${results.length} results from the API`,
      );

      return results;
    } catch (error) {
      addLogEntry(
        `Image search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  },

  async clearSearchCache(): Promise<void> {
    try {
      await db.delete();
      db.version(1).stores({
        textSearchHistory: "key, timestamp",
        imageSearchHistory: "key, timestamp",
      });
      await db.open();

      cacheMetrics.textHits = 0;
      cacheMetrics.textMisses = 0;
      cacheMetrics.imageHits = 0;
      cacheMetrics.imageMisses = 0;

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
    Object.assign(cacheConfig, newConfig);
    addLogEntry(
      `Cache configuration updated: TTL=${cacheConfig.ttl}ms, maxEntries=${cacheConfig.maxEntries}, enabled=${cacheConfig.enabled}`,
    );
  },
};

export const searchText = searchService.searchText.bind(searchService);
export const searchImages = searchService.searchImages.bind(searchService);
