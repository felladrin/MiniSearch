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

export function setReducedMotionPreference(matches: boolean) {
  mockReducedMotionPreference(matches);
}

export function resetReducedMotionPreference() {
  mockReducedMotionPreference(false);
}
