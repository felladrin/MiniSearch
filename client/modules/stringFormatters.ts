import uFuzzy from "@leeoniya/ufuzzy";

/**
 * Extracts hostname from a URL, removing www. prefix
 * @param url - The URL to extract hostname from
 * @returns The hostname without www. prefix, or the original string if parsing fails
 */
export function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

/**
 * Converts a date to semantic version format (YYYY.MM.DD)
 * @param date - The date to convert
 * @returns Semantic version string
 */
export function getSemanticVersion(date: number | string | Date) {
  const targetDate = new Date(date);
  return `${targetDate.getFullYear()}.${targetDate.getMonth() + 1}.${targetDate.getDate()}`;
}

/**
 * Formats a timestamp as relative time (e.g., "2h ago", "3d ago")
 * @param timestamp - The timestamp to format
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

const uf = new uFuzzy({
  intraMode: 1,
  intraIns: 1,
  intraSub: 1,
  intraDel: 1,
  intraTrn: 1,
  intraChars: "[\\w-]",
  interChars: "[^a-z\\d]",
});

const infoThresh = 1000;

/**
 * Fuzzy search implementation using uFuzzy library
 * @param items - Array of items to search through
 * @param query - Search query string
 * @param extractText - Function to extract searchable text from each item
 * @param limit - Maximum number of results to return
 * @returns Array of items with their search scores
 */
export function searchWithFuzzy<T>(
  items: T[],
  query: string,
  extractText: (item: T) => string,
  limit?: number,
): Array<{ item: T; score: number }> {
  if (!query.trim()) {
    return items.slice(0, limit).map((item) => ({ item, score: 0 }));
  }

  const haystack = items.map(extractText);
  const needle = query.trim();
  const [idxs, info, order] = uf.search(haystack, needle, 0, infoThresh);

  if (!idxs || idxs.length === 0) {
    return [];
  }

  let orderedIdxs: number[] = [];
  if (info && order) {
    orderedIdxs = order.map((i) => info.idx[i]);
  } else {
    orderedIdxs = idxs;
  }

  const finalIdxs = orderedIdxs.slice(0, limit ?? orderedIdxs.length);
  return finalIdxs.map((idx, rank) => ({
    item: items[idx],
    score: 1 - rank / finalIdxs.length,
  }));
}

/**
 * Groups search results by date categories (Today, Yesterday, This Week, etc.)
 * @param items - Array of items with timestamps to group
 * @returns Object with date group keys as properties and arrays of items as values
 */
export function groupSearchResultsByDate<T>(
  items: Array<{ item: T; timestamp: number }>,
): Record<string, Array<{ item: T; timestamp: number }>> {
  const groups: Record<string, Array<{ item: T; timestamp: number }>> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const result of items) {
    const date = new Date(result.timestamp);
    let groupKey: string;

    if (date >= today) {
      groupKey = "Today";
    } else if (date >= yesterday) {
      groupKey = "Yesterday";
    } else if (date >= weekAgo) {
      groupKey = "This Week";
    } else {
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      groupKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(result);
  }

  return groups;
}
