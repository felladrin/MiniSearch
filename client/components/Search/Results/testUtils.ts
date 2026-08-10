import { vi } from "vitest";

/**
 * Overrides the global `matchMedia` mock from `setupTests.ts`. Only
 * `(prefers-reduced-motion: reduce)` reports a match, so the other media
 * queries the result components rely on keep returning false.
 */
export function setReducedMotionPreference(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches: matches && query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  );
}
