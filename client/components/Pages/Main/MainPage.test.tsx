import { describe, expect, it } from "vitest";

describe("MainPage component logic", () => {
  it("should show results only when query is not empty", () => {
    const isQueryEmpty = (query: string) => query.length === 0;

    expect(isQueryEmpty("")).toBe(true);
    expect(isQueryEmpty("test query")).toBe(false);
    expect(isQueryEmpty("   ")).toBe(false);
  });

  it("should determine when to show search results section", () => {
    const shouldShowSearchResults = (
      textSearchState: string,
      imageSearchState: string,
    ) => textSearchState !== "idle" || imageSearchState !== "idle";

    expect(shouldShowSearchResults("idle", "idle")).toBe(false);
    expect(shouldShowSearchResults("loading", "idle")).toBe(true);
    expect(shouldShowSearchResults("idle", "loading")).toBe(true);
    expect(shouldShowSearchResults("success", "success")).toBe(true);
  });

  it("should determine when to show AI response section", () => {
    const shouldShowAiResponse = (
      textGenerationState: string,
      showEnableAiResponsePrompt: boolean,
    ) => !showEnableAiResponsePrompt && textGenerationState !== "idle";

    expect(shouldShowAiResponse("idle", false)).toBe(false);
    expect(shouldShowAiResponse("generating", false)).toBe(true);
    expect(shouldShowAiResponse("generating", true)).toBe(false);
    expect(shouldShowAiResponse("complete", false)).toBe(true);
  });

  it("should determine when to show enable AI prompt", () => {
    const shouldShowEnablePrompt = (showEnableAiResponsePrompt: boolean) =>
      showEnableAiResponsePrompt;

    expect(shouldShowEnablePrompt(true)).toBe(true);
    expect(shouldShowEnablePrompt(false)).toBe(false);
  });

  it("should combine conditions correctly for full page state", () => {
    interface PageState {
      query: string;
      textSearchState: string;
      imageSearchState: string;
      textGenerationState: string;
      showEnableAiResponsePrompt: boolean;
    }

    const getVisibleSections = (state: PageState) => {
      const isQueryEmpty = state.query.length === 0;
      return {
        showResults:
          !isQueryEmpty &&
          (state.textSearchState !== "idle" ||
            state.imageSearchState !== "idle"),
        showAiResponse:
          !isQueryEmpty &&
          !state.showEnableAiResponsePrompt &&
          state.textGenerationState !== "idle",
        showEnablePrompt: !isQueryEmpty && state.showEnableAiResponsePrompt,
      };
    };

    expect(
      getVisibleSections({
        query: "",
        textSearchState: "success",
        imageSearchState: "idle",
        textGenerationState: "generating",
        showEnableAiResponsePrompt: false,
      }),
    ).toEqual({
      showResults: false,
      showAiResponse: false,
      showEnablePrompt: false,
    });

    expect(
      getVisibleSections({
        query: "test",
        textSearchState: "success",
        imageSearchState: "idle",
        textGenerationState: "generating",
        showEnableAiResponsePrompt: false,
      }),
    ).toEqual({
      showResults: true,
      showAiResponse: true,
      showEnablePrompt: false,
    });

    expect(
      getVisibleSections({
        query: "test",
        textSearchState: "idle",
        imageSearchState: "idle",
        textGenerationState: "idle",
        showEnableAiResponsePrompt: true,
      }),
    ).toEqual({
      showResults: false,
      showAiResponse: false,
      showEnablePrompt: true,
    });
  });
});
