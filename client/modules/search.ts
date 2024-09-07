import { getSearchTokenHash } from "./searchTokenHash";
import { name } from "../../package.json";

export type SearchResults = {
  textResults: [title: string, snippet: string, url: string][];
  imageResults: [
    title: string,
    url: string,
    thumbnailUrl: string,
    sourceUrl: string,
  ][];
};

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
function cacheSearchWithIndexedDB(
  fn: (query: string, limit?: number) => Promise<SearchResults>,
): (query: string, limit?: number) => Promise<SearchResults> {
  const storeName = "searches";
  const timeToLive = 15 * 60 * 1000;

  async function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        cleanExpiredCache(db);
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.createObjectStore(storeName);
      };
    });
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

  return async (query: string, limit?: number): Promise<SearchResults> => {
    if (!indexedDB) return fn(query, limit);

    const db = await dbPromise;
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const key = hashQuery(query);
    const cachedResult = await new Promise<
      | {
          results: SearchResults;
          timestamp: number;
        }
      | undefined
    >((resolve) => {
      const request = store.get(key);
      request.onerror = () => resolve(undefined);
      request.onsuccess = () => resolve(request.result);
    });

    if (cachedResult && Date.now() - cachedResult.timestamp < timeToLive) {
      return cachedResult.results;
    }

    const results = await fn(query, limit);

    const writeTransaction = db.transaction(storeName, "readwrite");
    const writeStore = writeTransaction.objectStore(storeName);
    writeStore.put({ results, timestamp: Date.now() }, key);

    return results;
  };
}

export const search = cacheSearchWithIndexedDB(
  async (query: string, limit?: number): Promise<SearchResults> => {
    const searchUrl = new URL("/search", self.location.origin);

    searchUrl.searchParams.set("q", query);

    searchUrl.searchParams.set("token", await getSearchTokenHash());

    if (limit && limit > 0) {
      searchUrl.searchParams.set("limit", limit.toString());
    }

    const response = await fetch(searchUrl.toString());

    return response.ok
      ? response.json()
      : { textResults: [], imageResults: [] };
  },
);
