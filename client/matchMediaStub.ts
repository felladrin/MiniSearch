import { vi } from "vitest";

/** The only media query the app's components ask about by name. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * A `MediaQueryList` for `query`, matching or not. `setupTests.ts` installs it
 * as the global `matchMedia` mock and the result tests override that mock with
 * it to toggle the reduced-motion preference.
 */
export function matchMediaStub(query: string, matches = false) {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
}
