/**
 * What makes an image or video result distinct: its full-size source, then its
 * thumbnail, then its page. The page alone is not enough, since one gallery page
 * holds many different images. The server, the screen and the history all
 * identify image results through this, so they agree on what counts as one.
 */
export function getImageIdentity(
  sourceUrl: string | undefined,
  thumbnailUrl: string | undefined,
  pageUrl: string,
): string {
  return sourceUrl || thumbnailUrl || pageUrl;
}
