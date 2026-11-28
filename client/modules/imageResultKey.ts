import type { ImageSearchResult } from "./types";

/**
 * Identifies an image result by its full-size source, falling back to the
 * thumbnail. The page URL is not enough: one gallery page holds many images.
 */
export function imageResultKey([
  ,
  ,
  thumbnailUrl,
  sourceUrl,
]: ImageSearchResult): string {
  return sourceUrl || thumbnailUrl;
}
