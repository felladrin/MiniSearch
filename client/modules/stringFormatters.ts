/**
 * Get the hostname of a URL.
 * @param url - The URL to get the hostname of.
 * @returns The hostname of the URL.
 */
export function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

/**
 * Get the semantic version of a date.
 * @param date - The date to get the semantic version of.
 * @returns The semantic version of the date.
 */
export function getSemanticVersion(date: number | string | Date) {
  const targetDate = new Date(date);
  return `${targetDate.getFullYear()}.${targetDate.getMonth() + 1}.${targetDate.getDate()}`;
}

export function formatThinkingTime(ms: number): string {
  if (ms < 1000) return "Thought for a second.";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `Thought for ${minutes} minute${minutes > 1 ? "s" : ""} ${remainingSeconds} second${remainingSeconds !== 1 ? "s" : ""}.`;
  }

  return `Thought for ${seconds} second${seconds !== 1 ? "s" : ""}.`;
}
