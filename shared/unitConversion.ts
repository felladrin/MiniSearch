/**
 * Carries the unit conversion SearXNG's own `unit_converter` plugin computed
 * for the query, on `/search/text`. The value is the plugin's answer text (for
 * example `16.4041994751 ft`), percent-encoded with `encodeURIComponent` so
 * that any character survives a header, and the client reads it back with
 * `decodeURIComponent`. The header is absent whenever the plugin answered
 * nothing, so a search without a conversion carries nothing new.
 *
 * The plugin needs no search engine, so it answers even where every engine is
 * blocked, which is why the header can arrive on a search with no results.
 */
export const SEARCH_UNIT_CONVERSION_HEADER = "X-Search-Unit-Conversion";
