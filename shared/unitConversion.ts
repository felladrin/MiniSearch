/**
 * Carries the unit conversion SearXNG's own `unit_converter` plugin computed
 * for the query, on `/search/text`. The value is the plugin's answer text (for
 * example `16.4041994751 ft`), percent-encoded so that any character survives
 * a header. The header is absent whenever the plugin answered nothing, so a
 * search without a conversion carries nothing new.
 *
 * The plugin needs no search engine, so it answers even where every engine is
 * blocked, which is why the header can arrive on a search with no results.
 */
export const SEARCH_UNIT_CONVERSION_HEADER = "X-Search-Unit-Conversion";

/** The answer as it travels in the header. */
export function encodeUnitConversion(answer: string): string {
  return encodeURIComponent(answer);
}

/**
 * The answer back from the header, or nothing when the value is not a valid
 * encoding or holds no text. The conversion is an extra on top of the results,
 * so a header mangled on the way drops the card and never fails the search.
 */
export function decodeUnitConversion(value: string): string | undefined {
  try {
    const answer = decodeURIComponent(value);
    return answer.trim() ? answer : undefined;
  } catch {
    return undefined;
  }
}
