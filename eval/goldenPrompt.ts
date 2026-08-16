import {
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "../client/modules/textGenerationUtilities.ts";
import { DEFAULT_SYSTEM_PROMPT } from "../shared/defaultSystemPrompt.ts";
import { goldenQueries } from "./goldenSet.ts";

/** The mockable pubSub state the answer eval drives. */
export interface EvalState {
  query: string;
  searchResults: [string, string, string][];
  pageContents: Record<string, string>;
  settings: {
    systemPrompt: string;
    inferenceType?: string;
    openAiContextLength?: number;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Builds the messages the app would send for one golden query, mutating the
 * passed-in pubSub mock state. Shared by promptConstruction.test.ts (default
 * suite) and answer.integration.test.ts (eval config) so both build the prompt
 * the same way; a drifted copy in one would let that copy grade a different
 * prompt than the other. The vi.mock factory itself has to stay per-file
 * (vitest hoists it above imports), but the prompt-building logic does not.
 */
export function buildMessagesForGolden(
  state: EvalState,
  goldenId: string,
): ChatMessage[] {
  const golden = goldenQueries.find((g) => g.id === goldenId);
  if (!golden) throw new Error(`Unknown golden id: ${goldenId}`);

  state.query = golden.query;
  state.searchResults = golden.results.map(({ title, snippet, url }) => [
    title,
    snippet,
    url,
  ]);
  state.pageContents = {};
  state.settings = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    inferenceType: "openai",
    openAiContextLength: 4096,
  };

  const formatted = getFormattedSearchResults(true);
  return getDefaultChatMessages(formatted);
}
