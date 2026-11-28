import { getImageIdentity } from "@shared/imageIdentity";
import type { ImageSearchResult } from "./types";

/** The identity of an image result tuple, as `getImageIdentity` defines it. */
export function imageResultKey([
  ,
  url,
  thumbnailUrl,
  sourceUrl,
]: ImageSearchResult): string {
  return getImageIdentity(sourceUrl, thumbnailUrl, url);
}
