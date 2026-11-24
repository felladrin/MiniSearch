/**
 * Splits a response that may carry a reasoning block into the reasoning and
 * the answer. Text counts as reasoning only when it starts with the start
 * marker after trimming, and the end marker is searched after the start
 * marker; without an end marker the reasoning runs to the end of the text and
 * `isOpen` reports the unterminated block. This is the single parser shared by
 * the UI hook and plain modules like text-to-speech, which cannot import a
 * React hook.
 */
export function splitReasoning(
  text: string,
  startMarker: string,
  endMarker: string,
): { reasoning: string; answer: string; isOpen: boolean } {
  if (!text) return { reasoning: "", answer: "", isOpen: false };

  const trimmedText = text.trim();

  if (!trimmedText.startsWith(startMarker))
    return { reasoning: "", answer: text, isOpen: false };

  const startIndex = trimmedText.indexOf(startMarker);
  const endIndex = trimmedText.indexOf(
    endMarker,
    startIndex + startMarker.length,
  );

  if (endIndex === -1) {
    return {
      reasoning: trimmedText.slice(startIndex + startMarker.length),
      answer: "",
      isOpen: true,
    };
  }

  return {
    reasoning: trimmedText.slice(startIndex + startMarker.length, endIndex),
    answer: trimmedText.slice(endIndex + endMarker.length),
    isOpen: false,
  };
}
