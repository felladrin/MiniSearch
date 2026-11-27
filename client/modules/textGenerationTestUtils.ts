import { vi } from "vitest";

/**
 * The `./textGenerationUtilities` override shared by the per-engine generation
 * tests. The helpers that read pubSub state become mocks, so a generation test
 * does not have to drive the UI channels; everything else (`ChatGenerationError`,
 * `defaultContextSize`) stays real, so `instanceof` checks still work.
 *
 * Returns the factory rather than the object so a `vi.mock` call can stay a
 * one-liner. The call is deferred to factory time, which is after this module
 * has been evaluated: the mocked module is only reached through the dynamic
 * `await import(...)` of the module under test.
 */
export function textGenerationUtilitiesMock(
  overrides: Record<string, unknown> = {},
) {
  return async (
    importOriginal: () => Promise<typeof import("./textGenerationUtilities")>,
  ) => ({
    ...(await importOriginal()),
    canStartResponding: vi.fn().mockResolvedValue(undefined),
    getFormattedSearchResults: vi.fn().mockReturnValue("None."),
    ...overrides,
  });
}
