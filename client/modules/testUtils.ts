import { vi } from "vitest";

/**
 * Common mock setup for text generation tests
 */
const createCommonMocks = () => ({
  pubSub: {
    getSettings: vi.fn(),
    updateModelLoadingProgress: vi.fn(),
    updateModelSizeInMegabytes: vi.fn(),
    updateTextGenerationState: vi.fn(),
    updateResponse: vi.fn(),
    canStartResponding: vi.fn(),
  },
  textGenerationUtilities: {
    canStartResponding: vi.fn(),
    defaultContextSize: 128,
    getDefaultChatMessages: vi.fn(() => []),
    getFormattedSearchResults: vi.fn(() => []),
    getDefaultChatCompletionCreateParamsStreaming: vi.fn(),
  },
});

/**
 * Setup common vi.mocks for text generation tests
 */
export const setupCommonTextGenerationMocks = () => {
  vi.mock("@root/package.json", () => ({
    repository: { url: "https://github.com/owner/repo" },
    version: "1.0.0",
  }));
};

/**
 * Mock pubSub module with specific settings
 */
export const mockPubSub = (settings: Record<string, unknown> = {}) => {
  const commonMocks = createCommonMocks();
  return {
    ...commonMocks.pubSub,
    getSettings: vi.fn(() => settings),
    getQuery: vi.fn(() => "test query"),
    getQuerySuggestions: vi.fn(() => []),
    updateQuerySuggestions: vi.fn(),
    queryPubSub: [vi.fn(), vi.fn(), vi.fn()],
    settingsPubSub: [vi.fn(), vi.fn(), vi.fn()],
    updateTextGenerationState: vi.fn(),
    getTextGenerationState: vi.fn(() => "idle"),
  };
};

/**
 * Mock textGenerationUtilities module
 */
export const mockTextGenerationUtilities = (
  overrides: Record<string, unknown> = {},
) => {
  const commonMocks = createCommonMocks();
  return {
    ...commonMocks.textGenerationUtilities,
    ...overrides,
  };
};

/**
 * Helper function to test common text generation behavior
 */
export const testTextGenerationBehavior = async (
  generateFunction: () => Promise<void>,
  expectedResponse: string,
) => {
  await generateFunction();
  const utils = await import("./textGenerationUtilities");
  const pubSub = await import("./pubSub");

  expect(utils.canStartResponding).toHaveBeenCalled();
  expect(pubSub.updateTextGenerationState).toHaveBeenCalledWith(
    "preparingToGenerate",
  );
  expect(pubSub.updateResponse).toHaveBeenCalledWith(expectedResponse);
};
