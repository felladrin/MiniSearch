import { describe, expect, it, vi } from "vitest";
import { shikiAdapter } from "./shiki";

const { createHighlighterMock, loadLanguageMock, getLoadedLanguagesMock } =
  vi.hoisted(() => ({
    createHighlighterMock: vi.fn(),
    loadLanguageMock: vi.fn(async () => undefined),
    getLoadedLanguagesMock: vi.fn(() => [] as string[]),
  }));

// Tracks whether anything ever touched the full bundle; it must stay false.
const fullBundleAccessed = vi.hoisted(() => ({ value: false }));

const fakeHighlighter = {
  loadLanguage: loadLanguageMock,
  getLoadedLanguages: getLoadedLanguagesMock,
};

// A small stand-in for the real web-subset registry: ids and aliases only,
// as lazy import thunks. "ruby" is deliberately absent (full-bundle only).
vi.mock("shiki/bundle/web", () => ({
  createHighlighter: createHighlighterMock,
  bundledLanguages: {
    python: () => Promise.resolve({}),
    javascript: () => Promise.resolve({}),
    gql: () => Promise.resolve({}),
  },
}));

vi.mock("shiki/bundle/full", () => {
  fullBundleAccessed.value = true;
  return { createHighlighter: vi.fn() };
});

describe("shiki adapter", () => {
  it("creates the highlighter with zero languages preloaded", async () => {
    createHighlighterMock.mockResolvedValueOnce(fakeHighlighter);

    await shikiAdapter.loadContext?.();

    expect(createHighlighterMock).toHaveBeenCalledTimes(1);
    expect(createHighlighterMock).toHaveBeenCalledWith({
      langs: [],
      themes: [],
    });
  });

  it("loads from the web subset, never the full bundle", async () => {
    createHighlighterMock.mockResolvedValueOnce(fakeHighlighter);

    await shikiAdapter.loadContext?.();

    expect(fullBundleAccessed.value).toBe(false);
  });

  it("loads a language on demand, passing the name through unchanged", async () => {
    createHighlighterMock.mockResolvedValueOnce(fakeHighlighter);

    const ctx = await shikiAdapter.loadContext?.();
    expect(ctx).toBe(fakeHighlighter);

    await shikiAdapter.loadLanguage?.(ctx, "python");

    expect(loadLanguageMock).toHaveBeenCalledTimes(1);
    expect(loadLanguageMock).toHaveBeenCalledWith("python");
  });

  it("loads a web-subset alias on demand", async () => {
    createHighlighterMock.mockResolvedValueOnce(fakeHighlighter);

    const ctx = await shikiAdapter.loadContext?.();

    await shikiAdapter.loadLanguage?.(ctx, "gql");

    expect(loadLanguageMock).toHaveBeenCalledTimes(1);
    expect(loadLanguageMock).toHaveBeenCalledWith("gql");
  });

  it("does not attempt a grammar load for a language outside the subset, and does not throw", async () => {
    createHighlighterMock.mockResolvedValueOnce(fakeHighlighter);

    const ctx = await shikiAdapter.loadContext?.();

    // Mantine returns synchronously (no Promise) when resolveLanguage
    // declines: the grammar load is never even attempted.
    expect(() => shikiAdapter.loadLanguage?.(ctx, "ruby")).not.toThrow();

    expect(loadLanguageMock).not.toHaveBeenCalled();
  });
});
