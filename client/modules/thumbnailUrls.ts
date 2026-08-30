import { getSearchTokenHash } from "./searchTokenHash";

/**
 * The search token hash is stable for the server's lifetime, so the argon2
 * work happens once per session and every thumbnail reuses the promise. A
 * rejection clears the cache so the next thumbnail retries instead of
 * inheriting a permanently dead promise.
 */
let searchTokenPromise: Promise<string> | null = null;

function getSearchToken(): Promise<string> {
  searchTokenPromise ??= getSearchTokenHash().catch((error) => {
    searchTokenPromise = null;
    throw error;
  });
  return searchTokenPromise;
}

/**
 * Resolves the `src` of an image result's thumbnail.
 *
 * An empty string means the result carried no thumbnail and there is nothing
 * to load. A `data:` URL is used as is: entries cached by an older build
 * stored the thumbnail bytes in the result itself, and they would not pass
 * the server's URL checks. Everything else goes through the server's
 * `/thumbnail` endpoint, which applies the SSRF guard and caches the image,
 * so the browser never fetches a search-result URL directly.
 */
export async function getThumbnailSrc(
  thumbnailUrl: string,
): Promise<string | null> {
  if (!thumbnailUrl) return null;
  if (thumbnailUrl.startsWith("data:")) return thumbnailUrl;

  const endpointUrl = new URL("/thumbnail", self.location.origin);
  endpointUrl.searchParams.set("u", thumbnailUrl);
  endpointUrl.searchParams.set("token", await getSearchToken());

  return endpointUrl.toString();
}
