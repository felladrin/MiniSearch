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
