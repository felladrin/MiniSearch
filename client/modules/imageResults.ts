import { getImageIdentity } from "@shared/imageIdentity";
import type { ImageSearchResults } from "./types";

function imageResultIdentity([
  ,
  url,
  thumbnailUrl,
  sourceUrl,
]: ImageSearchResults[number]): string {
  return getImageIdentity(sourceUrl, thumbnailUrl, url);
}

/** The `candidates` whose image is not already in `listed`. */
export function imagesNotIn(
  listed: ImageSearchResults,
  candidates: ImageSearchResults,
): ImageSearchResults {
  const listedIdentities = new Set(listed.map(imageResultIdentity));
  return candidates.filter(
    (result) => !listedIdentities.has(imageResultIdentity(result)),
  );
}
