/**
 * Identity of an image result: its full-size image when the result carries
 * one, otherwise its thumbnail, otherwise its page. The page URL alone cannot
 * tell images apart, since one gallery page can hold many different images.
 */
export function getImageIdentity(
  sourceUrl: string | undefined,
  thumbnailUrl: string | undefined,
  pageUrl: string,
): string {
  return sourceUrl || thumbnailUrl || pageUrl;
}
