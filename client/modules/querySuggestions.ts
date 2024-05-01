export const querySuggestions = __QUERY_SUGGESTIONS__;

export function getRandomQuerySuggestion() {
  return querySuggestions[Math.floor(Math.random() * querySuggestions.length)];
}
