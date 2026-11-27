import { vi } from "vitest";
import { matchMediaStub, REDUCED_MOTION_QUERY } from "@/matchMediaStub";

/**
 * Overrides the global `matchMedia` mock from `setupTests.ts`. Only
 * `(prefers-reduced-motion: reduce)` reports a match, so the other media
 * queries the result components rely on keep returning false.
 */
export function setReducedMotionPreference(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query) =>
    matchMediaStub(query, matches && query === REDUCED_MOTION_QUERY),
  );
}
