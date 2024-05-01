export const querySuggestions: string[] = [];

export function getRandomQuerySuggestion() {
  if (querySuggestions.length === 0) refillQuerySuggestions();

  return querySuggestions.pop() as string;
}

function refillQuerySuggestions() {
  querySuggestions.push(
    ...VITE_QUERY_SUGGESTIONS.slice().sort(() => Math.random() - 0.5),
  );
}
