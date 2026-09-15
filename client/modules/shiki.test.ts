import { describe, expect, it, vi } from "vitest";
import { shikiAdapter } from "./shiki";

const { createHighlighterMock, loadLanguageMock, getLoadedLanguagesMock } =
  vi.hoisted(() => ({
    createHighlighterMock: vi.fn(),
    loadLanguageMock: vi.fn(async () => undefined),
    getLoadedLanguagesMock: vi.fn(() => [] as string[]),
  }));

const fakeHighlighter = {
  loadLanguage: loadLanguageMock,
  getLoadedLanguages: getLoadedLanguagesMock,
};

vi.mock("shiki/bundle/full", () => ({
  createHighlighter: createHighlighterMock,
}));

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

  it("loads a language on demand, passing the name through unchanged", async () => {
    createHighlighterMock.mockResolvedValueOnce(fakeHighlighter);

    const ctx = await shikiAdapter.loadContext?.();
    expect(ctx).toBe(fakeHighlighter);

    await shikiAdapter.loadLanguage?.(ctx, "python");

    expect(loadLanguageMock).toHaveBeenCalledTimes(1);
    expect(loadLanguageMock).toHaveBeenCalledWith("python");
  });
});
