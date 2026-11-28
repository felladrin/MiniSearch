/**
 * The language choices the client offers, in the order the select lists them.
 * `browser` is MiniSearch's own value and is never sent: the client resolves it
 * to `navigator.language` at search time. `all` is SearXNG's own "no
 * preference", and every other value is a locale code, region included, since
 * SearXNG has no separate country parameter — `pt-BR` is Portuguese served by
 * Brazil's engine editions.
 *
 * Labels stay in their own language on purpose: a user who cannot read English
 * has to find their own language in this list.
 */
export const searchLanguageOptions = [
  { value: "browser", label: "Browser language" },
  { value: "all", label: "Any language" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "nl", label: "Nederlands" },
  { value: "pl", label: "Polski" },
  { value: "sv", label: "Svenska" },
  { value: "tr", label: "Türkçe" },
  { value: "ru", label: "Русский" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh-CN", label: "中文 (中国)" },
  { value: "zh-TW", label: "中文 (台灣)" },
] as const;

export type SearchLanguage = (typeof searchLanguageOptions)[number]["value"];

/**
 * SearXNG's own pattern for a locale, `VALID_LANGUAGE_CODE` in
 * `searx/webutils.py`: a language code with an optional region. Anything else
 * makes SearXNG raise a parameter error, so the server refuses it too rather
 * than pass it on.
 */
const searxngLanguageCode = /^[a-z]{2,3}(-[a-zA-Z]{2})?$/;

/** Whether SearXNG takes this value for its `language` parameter. */
export function isSearxngLanguage(value: string): boolean {
  // `all` matches the pattern above on its own; `auto` is the one other value
  // SearXNG accepts, and only a direct API caller sends it.
  return value === "auto" || searxngLanguageCode.test(value);
}

/**
 * The `language` to send for a saved setting, or nothing when the search has no
 * preference to state. "Browser language" is resolved here, at search time, so
 * the request carries the browser's own locale instead of the guess SearXNG
 * would have to make from the query text.
 *
 * A browser locale SearXNG cannot take is dropped rather than sent: the server
 * answers such a value 400, and a search that cannot state its preference is
 * better served unfiltered than refused outright.
 */
export function resolveSearchLanguage(
  setting: SearchLanguage | undefined,
  browserLanguage: string,
): string | undefined {
  if (setting === "browser") {
    return isSearxngLanguage(browserLanguage) ? browserLanguage : undefined;
  }
  return setting;
}

/**
 * Set to `false` on a search response whose requested language could not be
 * applied, which happens when a fallback provider answers a text search: those
 * take only a query and a count. The header is absent when the language was
 * applied, so a search that asked for none carries nothing new.
 */
export const SEARCH_LANGUAGE_APPLIED_HEADER = "X-Search-Language-Applied";
