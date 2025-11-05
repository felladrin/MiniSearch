import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addSearchToHistory,
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

export function useSearchHistory(
  options: UseSearchHistoryOptions = {},
): UseSearchHistoryReturn {
  const {
    limit = 50,
    enableGrouping = true,
    enablePagination = false,
    pageSize = 20,
  } = options;

  const [recentSearches, setRecentSearches] = useState<SearchEntry[]>([]);
  const [filteredSearches, setFilteredSearches] = useState<SearchEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuery, setCurrentQuery] = useState("");
  const [lastFailedOperation, setLastFailedOperation] = useState<
    (() => Promise<void>) | null
  >(null);

  const [currentPage, setCurrentPage] = useState(0);
  const [allSearches, setAllSearches] = useState<SearchEntry[]>([]);

  const refreshHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const searches = await getRecentSearches(
        enablePagination ? 1000 : limit * 2,
      );

      if (enablePagination) {
        setAllSearches(searches);
      } else {
        setRecentSearches(searches);
      }

      if (currentQuery) {
        const filtered = searchWithFuzzy(
          searches,
          currentQuery,
          (search) => search.query,
          enablePagination ? searches.length : limit,
        ).map((result) => result.item);

        if (enablePagination) {
          const startIndex = currentPage * pageSize;
          const endIndex = startIndex + pageSize;
          setFilteredSearches(filtered.slice(startIndex, endIndex));
        } else {
          setFilteredSearches(filtered.slice(0, limit));
        }
      } else {
        if (enablePagination) {
          const startIndex = currentPage * pageSize;
          const endIndex = startIndex + pageSize;
          const pageResults = searches.slice(startIndex, endIndex);
          setRecentSearches(pageResults);
          setFilteredSearches(pageResults);
        } else {
          const results = searches.slice(0, limit);
          setRecentSearches(results);
          setFilteredSearches(results);
        }
      }
    } catch (err) {
      const errorMsg = `Failed to load search history: ${err}`;
      setError(errorMsg);
      addLogEntry(errorMsg);
      setLastFailedOperation(() => refreshHistory);
    } finally {
      setIsLoading(false);
    }
  }, [limit, currentQuery, enablePagination, pageSize, currentPage]);

  const searchHistory = useCallback(
    (query: string) => {
      setCurrentQuery(query);

      if (!query.trim()) {
        setFilteredSearches(recentSearches);
        return;
      }

      const results = searchWithFuzzy(
        recentSearches,
        query,
        (search) => search.query,
        limit,
      ).map((result) => result.item);

      setFilteredSearches(results);
    },
    [recentSearches, limit],
  );

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
            isPinned: !search.isPinned,
          });
          await refreshHistory();
          addLogEntry(
            `${search.isPinned ? "Unpinned" : "Pinned"} search: ${search.query}`,
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
      await historyDatabase.searches.clear();
      setRecentSearches([]);
      setFilteredSearches([]);
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

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!isLoading) {
        refreshHistory();
      }
    }, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [refreshHistory, isLoading]);

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

  const dataSource = currentQuery
    ? filteredSearches
    : enablePagination
      ? allSearches
      : recentSearches;
  const totalPages = enablePagination
    ? Math.ceil(dataSource.length / pageSize)
    : 1;
  const hasNextPage = enablePagination && currentPage < totalPages - 1;
  const hasPreviousPage = enablePagination && currentPage > 0;

  return {
    recentSearches,
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
