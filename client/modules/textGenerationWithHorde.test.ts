import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { defaultSettings } from "./settings";
import { sleep } from "./sleep";
import { canStartResponding } from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("./pubSub", () => ({
  getSettings: vi.fn(),
  getTextGenerationState: vi.fn().mockReturnValue("idle"),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("./sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// canStartResponding/getDefaultChatMessages/getFormattedSearchResults depend
// on pubSub state we don't want to drive here; ChatGenerationError and
// defaultContextSize have no such dependency, so keep them real.
vi.mock("./textGenerationUtilities", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./textGenerationUtilities")>();
  return {
    ...actual,
    canStartResponding: vi.fn().mockResolvedValue(undefined),
    getDefaultChatMessages: vi
      .fn()
      .mockReturnValue([{ role: "user", content: "hi" }]),
    getFormattedSearchResults: vi.fn().mockReturnValue("None."),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function mockSettings(overrides: Partial<typeof defaultSettings> = {}) {
  vi.mocked(getSettings).mockReturnValue({ ...defaultSettings, ...overrides });
}

describe("textGenerationWithHorde", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The module caches the model ranking; each test starts from a clean slate.
    vi.resetModules();
    mockSettings({ hordeModel: "chosen-model" });
    vi.mocked(getTextGenerationState).mockReturnValue("idle");
  });

  describe("generateTextWithHorde", () => {
    it("starts a generation, polls until done, and streams the response", async () => {
      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-1" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: true,
            is_possible: true,
            generations: [{ text: "Hello world", model: "chosen-model" }],
          }),
        );

      await generateTextWithHorde();

      expect(canStartResponding).toHaveBeenCalled();
      expect(updateTextGenerationState).toHaveBeenCalledWith(
        "preparingToGenerate",
      );
      expect(updateResponse).toHaveBeenCalledWith("Hello world");

      const [startUrl, startInit] = mockFetch.mock.calls[0];
      expect(startUrl).toContain("/generate/text/async");
      expect(JSON.parse(startInit.body).models).toEqual(["chosen-model"]);
    });

    it("throws ChatGenerationError when the generation is faulted", async () => {
      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-2" }))
        .mockResolvedValueOnce(jsonResponse({ done: true, faulted: true }));

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation failed",
      );
    });

    it("throws ChatGenerationError when the model reports generation is not possible", async () => {
      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-3" }))
        .mockResolvedValueOnce(
          jsonResponse({ done: true, is_possible: false }),
        );

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation not possible with the selected model",
      );
    });

    it("stops polling and throws once the user interrupts generation", async () => {
      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-4" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: false,
            is_possible: true,
            generations: [{ text: "partial", model: "chosen-model" }],
          }),
        );
      vi.mocked(getTextGenerationState).mockReturnValue("interrupted");

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation interrupted",
      );
      expect(sleep).toHaveBeenCalled();
    });

    it("includes the configured model in the generation request body", async () => {
      mockSettings({ hordeModel: "custom-model" });
      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-5" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: true,
            is_possible: true,
            generations: [{ text: "With model", model: "custom-model" }],
          }),
        );

      await generateTextWithHorde();

      const [, startInit] = mockFetch.mock.calls[0];
      expect(JSON.parse(startInit.body).models).toEqual(["custom-model"]);
    });
  });

  describe("generateChatWithHorde", () => {
    it("streams partial responses to the provided callback without touching the response pubsub", async () => {
      const { generateChatWithHorde } = await import(
        "./textGenerationWithHorde"
      );

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-6" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: true,
            is_possible: true,
            generations: [{ text: "Chat response", model: "chosen-model" }],
          }),
        );

      const onUpdate = vi.fn();
      const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
      const result = await generateChatWithHorde(messages, onUpdate);

      expect(result).toBe("Chat response");
      expect(onUpdate).toHaveBeenCalledWith("Chat response");
      expect(canStartResponding).not.toHaveBeenCalled();
      expect(updateResponse).not.toHaveBeenCalled();
    });
  });

  describe("automatic model selection when no model is pinned", () => {
    const doneResponse = {
      done: true,
      is_possible: true,
      generations: [{ text: "Top model answer", model: "m-f" }],
    };

    function routeHordeFetch({
      workerModels,
      monthStats,
      statsFails = false,
      statusResponder,
    }: {
      workerModels: Array<{ name: string; count: number }>;
      monthStats?: Record<string, number>;
      statsFails?: boolean;
      statusResponder: (pollIndex: number) => unknown;
    }) {
      let idCounter = 0;
      let pollCounter = 0;
      mockFetch.mockImplementation(
        async (url: string, init?: { method?: string; body?: string }) => {
          if (url.includes("/status/models")) {
            return jsonResponse(
              workerModels.map((model) => ({
                performance: 1,
                queued: 0,
                jobs: 0,
                eta: 0,
                type: "text",
                ...model,
              })),
            );
          }
          if (url.includes("/stats/text/models")) {
            return statsFails
              ? jsonResponse({}, 500)
              : jsonResponse({ day: {}, month: monthStats ?? {}, total: {} });
          }
          if (url.includes("/generate/text/async")) {
            return jsonResponse({ id: `gen-${++idCounter}` });
          }
          if (init?.method === "DELETE") {
            return jsonResponse({});
          }
          return jsonResponse(statusResponder(pollCounter++));
        },
      );
    }

    function generationRequestBodies() {
      return mockFetch.mock.calls
        .filter(([url]) => String(url).includes("/generate/text/async"))
        .map(([, init]) => JSON.parse((init as { body: string }).body));
    }

    beforeEach(() => {
      mockSettings({ hordeModel: "" });
    });

    it("asks for the models with workers ranked by requests this month", async () => {
      routeHordeFetch({
        workerModels: [
          { name: "m-a", count: 1 },
          { name: "m-b", count: 2 },
          { name: "m-c", count: 1 },
          { name: "m-d", count: 1 },
          { name: "m-e", count: 1 },
          { name: "m-f", count: 1 },
          { name: "m-offline", count: 0 },
        ],
        monthStats: {
          "m-a": 400,
          "m-b": 500,
          "m-c": 600,
          "m-d": 700,
          "m-e": 800,
          "m-f": 900,
          "m-offline": 9999,
        },
        statusResponder: () => doneResponse,
      });

      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      await generateTextWithHorde();

      const bodies = generationRequestBodies();
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.models).toEqual(["m-f", "m-e", "m-d", "m-c", "m-b"]);
      }
    });

    it("falls back to any available model when the statistics fetch fails", async () => {
      routeHordeFetch({
        workerModels: [{ name: "m-a", count: 1 }],
        statsFails: true,
        statusResponder: () => doneResponse,
      });

      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      await generateTextWithHorde();

      const bodies = generationRequestBodies();
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.models).toBeUndefined();
      }
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("falling back to any available model"),
      );
    });

    it("retries with any available model when the top models cannot take the job", async () => {
      routeHordeFetch({
        workerModels: [{ name: "m-a", count: 1 }],
        monthStats: { "m-a": 10 },
        statusResponder: (pollIndex) =>
          pollIndex < 2 ? { done: true, is_possible: false } : doneResponse,
      });

      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      await generateTextWithHorde();

      expect(updateResponse).toHaveBeenCalledWith("Top model answer");
      const bodies = generationRequestBodies();
      expect(bodies).toHaveLength(4);
      expect(bodies.slice(0, 2).map((body) => body.models)).toEqual([
        ["m-a"],
        ["m-a"],
      ]);
      expect(bodies.slice(2).map((body) => body.models)).toEqual([
        undefined,
        undefined,
      ]);
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("retrying with any available model"),
      );
    });

    it("reuses the cached ranking for the next generation", async () => {
      routeHordeFetch({
        workerModels: [{ name: "m-a", count: 1 }],
        monthStats: { "m-a": 10 },
        statusResponder: () => doneResponse,
      });

      const { generateTextWithHorde } = await import(
        "./textGenerationWithHorde"
      );
      await generateTextWithHorde();
      await generateTextWithHorde();

      const rankingFetches = mockFetch.mock.calls.filter(
        ([url]) =>
          String(url).includes("/status/models") ||
          String(url).includes("/stats/text/models"),
      );
      expect(rankingFetches).toHaveLength(2);
      expect(generationRequestBodies().map((body) => body.models)).toEqual([
        ["m-a"],
        ["m-a"],
        ["m-a"],
        ["m-a"],
      ]);
    });
  });

  describe("fetchHordeModels", () => {
    it("returns the models reported by the AI Horde API", async () => {
      const { fetchHordeModels } = await import("./textGenerationWithHorde");

      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            name: "test-model",
            count: 1,
            type: "text",
            performance: 1.0,
            queued: 0,
            jobs: 0,
            eta: 0,
          },
        ]),
      );

      const models = await fetchHordeModels();

      expect(models).toHaveLength(1);
      expect(models[0].name).toBe("test-model");
      expect(mockFetch.mock.calls[0][0]).toContain("/status/models");
    });

    it("throws when the AI Horde API responds with an error", async () => {
      const { fetchHordeModels } = await import("./textGenerationWithHorde");

      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

      await expect(fetchHordeModels()).rejects.toThrow(
        "Failed to fetch AI Horde models",
      );
    });
  });

  describe("fetchHordeUserInfo", () => {
    it("returns the username and kudos for the given API key", async () => {
      const { fetchHordeUserInfo } = await import("./textGenerationWithHorde");

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ username: "testuser", kudos: 1000 }),
      );

      const userInfo = await fetchHordeUserInfo("test-api-key");

      expect(userInfo).toEqual({ username: "testuser", kudos: 1000 });
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers.apikey).toBe("test-api-key");
    });
  });

  it("logs a message that names the model used once generation completes", async () => {
    mockSettings({ hordeModel: "chosen-model" });
    const { generateTextWithHorde } = await import("./textGenerationWithHorde");

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: "gen-7" }))
      .mockResolvedValueOnce(
        jsonResponse({
          done: true,
          is_possible: true,
          generations: [{ text: "Hello world", model: "chosen-model" }],
        }),
      );

    await generateTextWithHorde();

    expect(addLogEntry).toHaveBeenCalledWith(
      expect.stringContaining("chosen-model"),
    );
  });
});
