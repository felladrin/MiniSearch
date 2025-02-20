import { name } from "../../package.json";
import { addLogEntry } from "./logEntries";
import { getSearchTokenHash } from "./searchTokenHash";
import type { ImageSearchResults, TextSearchResults } from "./types";

/**
 * Creates a cached version of a search function using IndexedDB for storage.
 *
 * @param fn - The original search function to be cached.
 * @returns A new function that wraps the original, adding caching functionality.
 *
 * This function implements a caching mechanism for search results using IndexedDB.
 * It stores search results with a 15-minute time-to-live (TTL) to improve performance
 * for repeated searches. The cache is automatically cleaned of expired entries.
 *
 * The returned function behaves as follows:
 * 1. Checks IndexedDB for a cached result matching the query.
 * 2. If a valid (non-expired) cached result exists, it is returned immediately.
 * 3. Otherwise, the original search function is called, and its result is both
 *    returned and stored in the cache for future use.
 *
 * If IndexedDB is not available, the function falls back to using the original
 * search function without caching.
 */
function cacheSearchWithIndexedDB<
  T extends ImageSearchResults | TextSearchResults,
>(
  fn: (query: string, limit?: number) => Promise<T>,
  storeName: string,
): (query: string, limit?: number) => Promise<T> {
  const databaseVersion = 2;
  const timeToLive = 15 * 60 * 1000;

  async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request = indexedDB.open(name, databaseVersion);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        if (
          !db.objectStoreNames.contains("textSearches") ||
          !db.objectStoreNames.contains("imageSearches")
        ) {
          db.close();
          request = indexedDB.open(name, databaseVersion);
          request.onupgradeneeded = createStores;
          request.onsuccess = () => {
            const upgradedDb = request.result;
            cleanExpiredCache(upgradedDb);
            resolve(upgradedDb);
          };
          request.onerror = () => reject(request.error);
        } else {
          cleanExpiredCache(db);
          resolve(db);
        }
      };

      request.onupgradeneeded = createStores;
    });
  }

  function createStores(event: IDBVersionChangeEvent): void {
    const db = (event.target as IDBOpenDBRequest).result;
    if (!db.objectStoreNames.contains("textSearches")) {
      db.createObjectStore("textSearches");
    }
    if (!db.objectStoreNames.contains("imageSearches")) {
      db.createObjectStore("imageSearches");
    }
  }

  async function cleanExpiredCache(db: IDBDatabase): Promise<void> {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const currentTime = Date.now();

    return new Promise((resolve) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          if (currentTime - cursor.value.timestamp >= timeToLive) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  /**
   * Generates a hash for a given query string.
   *
   * This function implements a simple hash algorithm:
   * 1. It iterates through each character in the query string.
   * 2. For each character, it updates the hash value using bitwise operations.
   * 3. The final hash is converted to a 32-bit integer.
   * 4. The result is returned as a base-36 string representation.
   *
   * @param query - The input string to be hashed.
   * @returns A string representation of the hash in base-36.
   */
  function hashQuery(query: string): string {
    return query
      .split("")
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
      .toString(36);
  }

  const dbPromise = openDB();

  return async (query: string, limit?: number): Promise<T> => {
    if (!indexedDB) return fn(query, limit);

    const db = await dbPromise;
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const key = hashQuery(query);
    const cachedResult = await new Promise<
      | {
          results: T;
          timestamp: number;
        }
      | undefined
    >((resolve) => {
      const request = store.get(key);
      request.onerror = () => resolve(undefined);
      request.onsuccess = () => resolve(request.result);
    });

    if (cachedResult && Date.now() - cachedResult.timestamp < timeToLive) {
      addLogEntry(
        `IndexedDB ${storeName}: Search cache hit, returning cached results containing ${cachedResult.results.length} items`,
      );
      return cachedResult.results;
    }

    addLogEntry(
      `IndexedDB ${storeName}: Search cache miss, fetching new results`,
    );

    const results = await fn(query, limit);

    const writeTransaction = db.transaction(storeName, "readwrite");
    const writeStore = writeTransaction.objectStore(storeName);
    writeStore.put({ results, timestamp: Date.now() }, key);

    addLogEntry(
      `IndexedDB ${storeName}: Search completed with ${results.length} items`,
    );

    return results;
  };
}

async function performSearch<T>(
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
}

export const searchText = cacheSearchWithIndexedDB<TextSearchResults>(
  async (query: string, limit?: number): Promise<TextSearchResults> => {
    try {
      return performSearch<TextSearchResults>("text", query, limit);
    } catch (error) {
      addLogEntry(
        `Text search failed: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  },
  "textSearches",
);

export const searchImages = cacheSearchWithIndexedDB<ImageSearchResults>(
  async (query: string, limit?: number): Promise<ImageSearchResults> => {
    try {
      return performSearch<ImageSearchResults>("images", query, limit);
    } catch (error) {
      addLogEntry(
        `Image search failed: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  },
  "imageSearches",
);
