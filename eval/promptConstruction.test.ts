import { describe, expect, it, vi } from "vitest";
import { goldenQueries } from "./goldenSet.ts";

/**
 * Prompt-construction tests for the answer eval. These run in the default
 * (jsdom) suite because they make no network calls and load no model: they
 * only build the prompt the app would send, using the real
 * getFormattedSearchResults + getDefaultChatMessages + systemPrompt (with the
 * pubSub state mocked to a golden query, the same way the client unit tests
 * do). The LLM-judged tests live in answer.integration.test.ts.
 *
 * buildMessagesForGolden is shared with that file (eval/goldenPrompt.ts) so
 * the prompt is built identically in both.
 */

const state = vi.hoisted(() => ({
  query: "",
  searchResults: [] as [string, string, string][],
  pageContents: {} as Record<string, string>,
  settings: {
    systemPrompt: "",
    inferenceType: "openai",
    openAiContextLength: 4096,
  } as {
    systemPrompt: string;
    inferenceType?: string;
    openAiContextLength?: number;
  },
}));

vi.mock("../client/modules/pubSub", () => ({
  getSettings: () => state.settings,
  getLlmTextSearchResults: () => state.searchResults,
  getPageContents: () => state.pageContents,
  getQuery: () => state.query,
  getSearchPromise: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

import { buildMessagesForGolden } from "./goldenPrompt.ts";

describe("answer eval: prompt construction", () => {
  it("builds a non-empty prompt that embeds the query and the results", () => {
    const golden = goldenQueries[0];
    const messages = buildMessagesForGolden(state, golden.id);

    // The app's shape: system prompt as a user turn, an "Ok!" acknowledgement,
    // then the question.
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("user");
    expect(messages[1].content).toBe("Ok!");
    expect(messages[2].content).toBe(golden.query);

    const systemTurn = messages[0].content;
    // The {{searchResults}} and {{currentDate}} placeholders are filled.
    expect(systemTurn).not.toContain("{{searchResults}}");
    expect(systemTurn).not.toContain("{{currentDate}}");
    // Every candidate result is present in the prompt.
    for (const { url } of golden.results) {
      expect(systemTurn).toContain(url);
    }
  });

  it("embeds a distinct prompt for every golden query", () => {
    const first = buildMessagesForGolden(state, goldenQueries[0].id);
    const second = buildMessagesForGolden(state, goldenQueries[1].id);
    expect(first[2].content).not.toBe(second[2].content);
    expect(first[0].content).not.toBe(second[0].content);
  });
});
