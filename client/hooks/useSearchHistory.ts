import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addSearchToHistory,
  clearAllHistory,
  getRecentSearches,
  historyDatabase,
  type ImageResults,
  type SearchEntry,
  type TextResults,
} from "../modules/history";
import { addLogEntry } from "../modules/logEntries";
import { getSettings } from "../modules/pubSub";
import {
  groupSearchResultsByDate,
  searchWithFuzzy,
} from "../modules/stringFormatters";

interface UseSearchHistoryOptions {
  limit?: number;
  threshold?: number;
  enableGrouping?: boolean;
  enablePagination?: boolean;
  pageSize?: number;
}

interface UseSearchHistoryReturn {
  recentSearches: SearchEntry[];
  llmResponseCount: number;
  chatMessageCount: number;
  filteredSearches: SearchEntry[];
  groupedSearches: Record<string, SearchEntry[]>;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  retryLastOperation: () => Promise<void>;
  clearError: () => void;
  searchHistory: (query: string) => void;
  addToHistory: (
    query: string,
    results: TextResults | ImageResults,
    source?: "user" | "followup" | "suggestion",
  ) => Promise<void>;
  togglePin: (searchId: number) => Promise<void>;
  deleteEntry: (searchId: number) => Promise<void>;
  clearAll: () => Promise<void>;
  refreshHistory: () => Promise<void>;

  nextPage: () => void;
  previousPage: () => void;
  goToPage: (page: number) => void;
}

/** A burst of keystrokes settles into a single fuzzy pass after this quiet period. */
export const FILTER_DEBOUNCE_MS = 200;

/** Background re-read cadence; the interval is the only periodic IndexedDB access. */
export const REFRESH_INTERVAL_MS = 30_000;

/** Search history with fuzzy filtering, date grouping, and optional pagination. */
export function useSearchHistory(
  options: UseSearchHistoryOptions = {},
): UseSearchHistoryReturn {
  const {
    limit = 50,
    enableGrouping = true,
    enablePagination = false,
    pageSize = 20,
  } = options;

  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [llmResponseCount, setLlmResponseCount] = useState(0);
  const [chatMessageCount, setChatMessageCount] = useState(0);
  const [filteredSearches, setFilteredSearches] = useState<SearchEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedOperation, setLastFailedOperation] = useState<
    (() => Promise<void>) | null
  >(null);

  const [currentPage, setCurrentPage] = useState(0);
  const [settledQuery, setSettledQuery] = useState("");
  const [matchedCount, setMatchedCount] = useState(0);

  const isLoadingRef = useRef(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The only function that reads IndexedDB. Its identity is stable while the
  // user types: the query is deliberately absent from its dependencies, so a
  // keystroke can never re-fire the mount effect or rebuild the interval.
  const refreshHistory = useCallback(async () => {
    try {
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);

      const searches = await getRecentSearches(
        enablePagination ? 1000 : limit * 2,
      );

      const [llmCount, chatCount] = await Promise.all([
        historyDatabase.llmResponses.count(),
        historyDatabase.chatHistory.count(),
      ]);
      setLlmResponseCount(llmCount);
      setChatMessageCount(chatCount);
      setEntries(searches);
    } catch (err) {
      const errorMsg = `Failed to load search history: ${err}`;
      setError(errorMsg);
      addLogEntry(errorMsg);
      setLastFailedOperation(() => refreshHistory);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [limit, enablePagination]);

  // Typing only schedules a debounced settle of the query; it never reaches
  // IndexedDB. The derive effect below does the filtering from memory.
  const searchHistory = useCallback((query: string) => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setSettledQuery(query);
    }, FILTER_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const recentSearches = useMemo(() => {
    if (enablePagination) {
      const startIndex = currentPage * pageSize;
      return entries.slice(startIndex, startIndex + pageSize);
    }
    return entries.slice(0, limit);
  }, [entries, enablePagination, currentPage, pageSize, limit]);

  // Re-filter the entries already held in memory whenever the settled query or
  // the loaded entries change. Each settled query is a fresh full scan, never a
  // narrowing of the previous keystroke's matches: this setup's per-length
  // uFuzzy error rules let a match appear past its prefix ("wet" misses
  // "weather", "weth" hits it), so narrowing would drop it forever.
  useEffect(() => {
    const query = settledQuery.trim();

    if (!query) {
      setFilteredSearches(recentSearches);
      setMatchedCount(entries.length);
      return;
    }

    const matched = searchWithFuzzy(
      entries,
      query,
      (search) => search.query,
      enablePagination ? entries.length : limit,
    ).map((result) => result.item);

    setMatchedCount(matched.length);

    if (enablePagination) {
      const startIndex = currentPage * pageSize;
      setFilteredSearches(matched.slice(startIndex, startIndex + pageSize));
    } else {
      setFilteredSearches(matched.slice(0, limit));
    }
  }, [
    settledQuery,
    entries,
    recentSearches,
    enablePagination,
    limit,
    pageSize,
    currentPage,
  ]);

  const addToHistory = useCallback(
    async (
      query: string,
      results: TextResults | ImageResults,
      source: "user" | "followup" | "suggestion" = "user",
    ) => {
      try {
        await addSearchToHistory(query, results, source);
        await refreshHistory();
      } catch (err) {
        const errorMsg = `Failed to add search to history: ${err}`;
        setError(errorMsg);
        addLogEntry(errorMsg);
        setLastFailedOperation(
          () => () => addToHistory(query, results, source),
        );
      }
    },
    [refreshHistory],
  );

  const togglePin = useCallback(
    async (searchId: number) => {
      try {
        const search = await historyDatabase.searches.get(searchId);
        if (search) {
          await historyDatabase.searches.update(searchId, {
            pinned: !search.pinned,
          });
          await refreshHistory();
          addLogEntry(
            `${search.pinned ? "Unpinned" : "Pinned"} search: ${search.query}`,
          );
        }
      } catch (err) {
        const errorMsg = `Failed to toggle pin: ${err}`;
        setError(errorMsg);
        addLogEntry(errorMsg);
        setLastFailedOperation(() => () => togglePin(searchId));
      }
    },
    [refreshHistory],
  );

  const deleteEntry = useCallback(
    async (searchId: number) => {
      try {
        const search = await historyDatabase.searches.get(searchId);
        await historyDatabase.searches.delete(searchId);
        await refreshHistory();

        if (search) {
          addLogEntry(`Deleted search: ${search.query}`);
        }
      } catch (err) {
        const errorMsg = `Failed to delete search entry: ${err}`;
        setError(errorMsg);
        addLogEntry(errorMsg);
        setLastFailedOperation(() => () => deleteEntry(searchId));
      }
    },
    [refreshHistory],
  );

  const clearAll = useCallback(async () => {
    try {
      await clearAllHistory();
      setEntries([]);
      setFilteredSearches([]);
      setMatchedCount(0);
      setLlmResponseCount(0);
      setChatMessageCount(0);
      addLogEntry("All search history cleared");
    } catch (err) {
      const errorMsg = `Failed to clear history: ${err}`;
      setError(errorMsg);
      addLogEntry(errorMsg);
      setLastFailedOperation(() => () => clearAll());
    }
  }, []);

  const groupedSearches = useMemo(() => {
    const globalSettings = getSettings();
    if (
      !enableGrouping ||
      !globalSettings.historyGroupByDate ||
      !filteredSearches.length
    ) {
      return {};
    }

    const searchesWithTimestamp = filteredSearches.map((search) => ({
      item: search,
      timestamp: search.timestamp,
    }));

    const grouped = groupSearchResultsByDate(searchesWithTimestamp);

    const result: Record<string, SearchEntry[]> = {};
    for (const [key, value] of Object.entries(grouped)) {
      result[key] = value.map((item) => item.item);
    }

    return result;
  }, [filteredSearches, enableGrouping]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Depends only on the stable refreshHistory: a keystroke never tears this
  // interval down or rebuilds it. The in-flight guard lives in a ref so the
  // loading state cannot re-trigger the effect either.
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!isLoadingRef.current) {
        refreshHistory();
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [refreshHistory]);

  const retryLastOperation = useCallback(async () => {
    if (lastFailedOperation) {
      setError(null);
      try {
        await lastFailedOperation();
        setLastFailedOperation(null);
      } catch (err) {
        const errorMsg = `Retry failed: ${err}`;
        setError(errorMsg);
        addLogEntry(errorMsg);
      }
    }
  }, [lastFailedOperation]);

  const clearError = useCallback(() => {
    setError(null);
    setLastFailedOperation(null);
  }, []);

  const nextPage = useCallback(() => {
    if (enablePagination) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [enablePagination]);

  const previousPage = useCallback(() => {
    if (enablePagination && currentPage > 0) {
      setCurrentPage((prev) => prev - 1);
    }
  }, [enablePagination, currentPage]);

  const goToPage = useCallback(
    (page: number) => {
      if (enablePagination && page >= 0) {
        setCurrentPage(page);
      }
    },
    [enablePagination],
  );

  const totalPages = enablePagination ? Math.ceil(matchedCount / pageSize) : 1;
  const hasNextPage = enablePagination && currentPage < totalPages - 1;
  const hasPreviousPage = enablePagination && currentPage > 0;

  return {
    recentSearches,
    llmResponseCount,
    chatMessageCount,
    filteredSearches,
    groupedSearches,
    isLoading,
    error,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    retryLastOperation,
    clearError,
    searchHistory,
    addToHistory,
    togglePin,
    deleteEntry,
    clearAll,
    refreshHistory,
    nextPage,
    previousPage,
    goToPage,
  };
}
