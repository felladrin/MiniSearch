import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "@shared/openaiModels";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "@/modules/logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "@/modules/pubSub";
import { canStartResponding } from "@/modules/textGenerationUtilities";
import { defaultSettings } from "./settings";

vi.mock("@/modules/logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("@/modules/pubSub", () => ({
  getSettings: vi.fn(),
  getTextGenerationState: vi.fn().mockReturnValue("idle"),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("@/modules/sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// canStartResponding/getDefaultChatMessages/getFormattedSearchResults depend
// on pubSub state we don't want to drive here; getDefaultChatCompletionCreateParamsStreaming
// is mocked too so tests don't depend on real settings-derived defaults.
vi.mock("@/modules/textGenerationUtilities", () => ({
  canStartResponding: vi.fn().mockResolvedValue(undefined),
  getDefaultChatMessages: vi
    .fn()
    .mockReturnValue([{ role: "user", content: "hi" }]),
  getFormattedSearchResults: vi.fn().mockReturnValue("None."),
  getDefaultChatCompletionCreateParamsStreaming: vi.fn().mockReturnValue({
    max_tokens: 1000,
    temperature: 0.35,
    top_p: 1.0,
  }),
}));

vi.mock("@shared/openaiModels", () => ({
  listOpenAiCompatibleModels: vi.fn().mockResolvedValue([]),
  selectRandomModel: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function sseResponse(lines: unknown[]) {
  const body = `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function mockSettings(overrides: Partial<typeof defaultSettings> = {}) {
  vi.mocked(getSettings).mockReturnValue({
    ...defaultSettings,
    openAiApiBaseUrl: "https://api.example.com/v1",
    openAiApiKey: "sk-test-key",
    openAiApiModel: "gpt-4",
    reasoningStartMarker: "<think>",
    reasoningEndMarker: "</think>",
    ...overrides,
  });
}

describe("textGenerationWithOpenAi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings();
    vi.mocked(getTextGenerationState).mockReturnValue("idle");
  });

  describe("generateTextWithOpenAi", () => {
    it("streams a text response and updates state", async () => {
      const { generateTextWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Hello" } }] }]),
      );

      await generateTextWithOpenAi();

      expect(canStartResponding).toHaveBeenCalled();
      expect(updateTextGenerationState).toHaveBeenCalledWith(
        "preparingToGenerate",
      );
      expect(updateTextGenerationState).toHaveBeenCalledWith("generating");
      expect(updateResponse).toHaveBeenCalledWith("Hello");
    });

    it("wraps reasoning content with the configured markers ahead of the text", async () => {
      const { generateTextWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([
          { choices: [{ delta: { reasoning_content: "Thinking..." } }] },
          { choices: [{ delta: { content: "Hello" } }] },
        ]),
      );

      await generateTextWithOpenAi();

      expect(updateResponse).toHaveBeenLastCalledWith(
        "<think>Thinking...</think>\n\nHello",
      );
    });
  });

  describe("generateChatWithOpenAi", () => {
    it("resolves with the generated text and streams it to the callback", async () => {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "Hello" } }] }]),
      );

      const onUpdate = vi.fn();
      const result = await generateChatWithOpenAi(
        [{ role: "user", content: "Hi" }],
        onUpdate,
      );

      expect(result).toBe("Hello");
      expect(onUpdate).toHaveBeenCalledWith("Hello");
      expect(canStartResponding).not.toHaveBeenCalled();
    });

    it("throws once generation is interrupted", async () => {
      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );

      mockFetch.mockResolvedValueOnce(
        sseResponse([{ choices: [{ delta: { content: "partial" } }] }]),
      );
      vi.mocked(getTextGenerationState).mockReturnValue("interrupted");

      await expect(
        generateChatWithOpenAi([{ role: "user", content: "Hi" }], vi.fn()),
      ).rejects.toThrow("Chat generation interrupted");
    });

    it("retries with a different model when the stream reports an error", async () => {
      mockSettings({ openAiApiModel: "" });
      vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
        { id: "model-a" },
        { id: "model-b" },
      ]);
      vi.mocked(selectRandomModel)
        .mockReturnValueOnce("model-a")
        .mockReturnValueOnce("model-b");

      let call = 0;
      mockFetch.mockImplementation(async () => {
        call++;
        if (call === 1) {
          return sseResponse([{ error: { message: "model overloaded" } }]);
        }
        return sseResponse([
          { choices: [{ delta: { content: "recovered" } }] },
        ]);
      });

      const { generateChatWithOpenAi } = await import(
        "./textGenerationWithOpenAi"
      );
      const result = await generateChatWithOpenAi(
        [{ role: "user", content: "Hi" }],
        vi.fn(),
      );

      expect(result).toBe("recovered");
      expect(call).toBe(2);
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining('retrying with "model-b"'),
      );
    });
  });
});
