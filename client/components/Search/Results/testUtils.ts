import { vi } from "vitest";

function mockReducedMotionPreference(matches: boolean) {
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

/**
 * Set the reduced-motion media query result for component tests.
 */
export function setReducedMotionPreference(matches: boolean) {
  mockReducedMotionPreference(matches);
}

/**
 * Restore the default reduced-motion media query result for component tests.
 */
export function resetReducedMotionPreference() {
  mockReducedMotionPreference(false);
}
