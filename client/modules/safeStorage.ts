/**
 * localStorage accessors that never throw. Browsers that block site data
 * (Safari "Block All Cookies", Chrome "sites can't save data") raise
 * SecurityError on any property access; callers get a soft failure instead
 * of a blank page.
 */
export function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort when storage is blocked.
  }
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as setItem: ignore when storage is unavailable.
  }
}
