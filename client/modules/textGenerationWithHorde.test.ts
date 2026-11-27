import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { defaultSettings } from "./settings";
import { sleep } from "./sleep";
import { textGenerationUtilitiesMock } from "./textGenerationTestUtils";
import { canStartResponding } from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("./pubSub", () => ({
  getSettings: vi.fn(),
  updateResponse: vi.fn(),
  updateTextGenerationState: vi.fn(),
}));

vi.mock("./sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./textGenerationUtilities", (importOriginal) =>
  textGenerationUtilitiesMock({
    getDefaultChatMessages: vi
      .fn()
      .mockReturnValue([{ role: "user", content: "hi" }]),
  })(importOriginal),
);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

/** The job ids that were cancelled, in order. */
function cancelledIds(): string[] {
  return mockFetch.mock.calls
    .filter(([, init]) => (init as { method?: string })?.method === "DELETE")
    .map(([url]) => String(url).slice(String(url).lastIndexOf("/") + 1));
}

function mockSettings(overrides: Partial<typeof defaultSettings> = {}) {
  vi.mocked(getSettings).mockReturnValue({ ...defaultSettings, ...overrides });
}

/** Loads the generator under test, after the fetch routes are in place. */
/** Queues a submit, one in-progress poll, and a final empty reply. */
function queueInterruptedPolling(id: string) {
  mockFetch
    .mockResolvedValueOnce(jsonResponse({ id }))
    .mockResolvedValueOnce(
      jsonResponse({ done: false, is_possible: true, generations: [] }),
    )
    .mockResolvedValueOnce(jsonResponse({}));
}

function abortWhenGenerating() {
  const controller = new AbortController();
  vi.mocked(updateTextGenerationState).mockImplementation((next) => {
    if (next === "generating") controller.abort();
  });
  return controller;
}

async function loadHordeGenerator() {
  return (await import("./textGenerationWithHorde")).generateTextWithHorde;
}

describe("textGenerationWithHorde", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The module caches the model ranking; each test starts from a clean slate.
    vi.resetModules();
    mockSettings({ hordeModel: "chosen-model" });
  });

  describe("generateTextWithHorde", () => {
    it("starts a generation, polls until done, and streams the response", async () => {
      const generateTextWithHorde = await loadHordeGenerator();

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-1" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: true,
            is_possible: true,
            generations: [{ text: "Hello world", model: "chosen-model" }],
          }),
        );

      await expect(generateTextWithHorde()).resolves.toBe("Hello world");

      expect(canStartResponding).toHaveBeenCalled();
      expect(vi.mocked(updateTextGenerationState).mock.calls).toEqual([
        ["preparingToGenerate"],
        ["generating"],
      ]);
      // "generating" is entered before the first status poll, so the Stop
      // button is there for the whole queue wait.
      const generatingOrder = vi.mocked(updateTextGenerationState).mock
        .invocationCallOrder[1];
      const firstStatusPollOrder = mockFetch.mock.invocationCallOrder[1];
      expect(generatingOrder).toBeLessThan(firstStatusPollOrder);
      expect(updateResponse).toHaveBeenCalledWith("Hello world");

      const [startUrl, startInit] = mockFetch.mock.calls[0];
      expect(startUrl).toContain("/generate/text/async");
      expect(JSON.parse(startInit.body).models).toEqual(["chosen-model"]);
    });

    it("throws ChatGenerationError when the generation is faulted", async () => {
      const generateTextWithHorde = await loadHordeGenerator();

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-2" }))
        .mockResolvedValueOnce(jsonResponse({ done: true, faulted: true }));

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation failed",
      );
    });

    it("throws ChatGenerationError when the model reports generation is not possible", async () => {
      const generateTextWithHorde = await loadHordeGenerator();

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-3" }))
        .mockResolvedValueOnce(
          jsonResponse({ done: true, is_possible: false }),
        );

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation not possible with the selected model",
      );
    });

    it("stops polling and publishes nothing once the user interrupts generation", async () => {
      const controller = abortWhenGenerating();
      const generateTextWithHorde = await loadHordeGenerator();

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-4" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: false,
            is_possible: true,
            generations: [{ text: "partial", model: "chosen-model" }],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({}));

      await expect(generateTextWithHorde(controller.signal)).rejects.toThrow(
        "Generation interrupted",
      );
      expect(updateResponse).not.toHaveBeenCalledWith("partial");
      expect(sleep).not.toHaveBeenCalled();
      expect(cancelledIds()).toEqual(["gen-4"]);
    });

    it('submits nothing and never enters "generating" once a newer search aborted it', async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      const controller = new AbortController();
      controller.abort();

      await expect(generateTextWithHorde(controller.signal)).rejects.toThrow(
        "Generation interrupted",
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(updateTextGenerationState).not.toHaveBeenCalledWith("generating");
    });

    it("can be interrupted once it is generating, and cancels the queued job", async () => {
      // The UI only offers Stop while the state is "generating", so the
      // interrupt can only happen after the engine has entered it.
      const controller = abortWhenGenerating();
      const generateTextWithHorde = await loadHordeGenerator();

      queueInterruptedPolling("gen-queued");

      await expect(generateTextWithHorde(controller.signal)).rejects.toThrow(
        "Generation interrupted",
      );

      const [cancelUrl, cancelInit] = mockFetch.mock.calls[2];
      expect(cancelUrl).toContain("/generate/text/status/gen-queued");
      expect(cancelInit.method).toBe("DELETE");
    });

    it("cancels the job exactly once when the user interrupts", async () => {
      const controller = abortWhenGenerating();
      const generateTextWithHorde = await loadHordeGenerator();
      queueInterruptedPolling("gen-stop");

      await expect(generateTextWithHorde(controller.signal)).rejects.toThrow(
        "Generation interrupted",
      );
      expect(cancelledIds()).toEqual(["gen-stop"]);
    });

    it("cancels a pinned-model job that faults", async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-fault" }))
        .mockResolvedValueOnce(jsonResponse({ done: true, faulted: true }))
        .mockResolvedValueOnce(jsonResponse({}));

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation failed",
      );
      expect(cancelledIds()).toEqual(["gen-fault"]);
    });

    it("cancels a pinned-model job that the model cannot take", async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-offline" }))
        .mockResolvedValueOnce(jsonResponse({ done: true, is_possible: false }))
        .mockResolvedValueOnce(jsonResponse({}));

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation not possible",
      );
      expect(cancelledIds()).toEqual(["gen-offline"]);
    });

    it("does not cancel a job whose answer was returned", async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-ok" }))
        .mockResolvedValueOnce(
          jsonResponse({
            done: true,
            is_possible: true,
            generations: [{ text: "Fine", model: "chosen-model" }],
          }),
        );

      await expect(generateTextWithHorde()).resolves.toBe("Fine");
      expect(cancelledIds()).toEqual([]);
    });

    it("keeps the original error and logs once when the cancel fails", async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-x" }))
        .mockResolvedValueOnce(jsonResponse({ done: true, faulted: true }))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation failed",
      );
      // The cancel runs unawaited; let it settle before checking the log.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const cancelLogs = vi
        .mocked(addLogEntry)
        .mock.calls.filter(([entry]) =>
          String(entry).includes("Failed to cancel generation gen-x"),
        );
      expect(cancelLogs).toHaveLength(1);
    });

    it("sends the cancel with a timeout and keepalive", async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: "gen-k" }))
        .mockResolvedValueOnce(jsonResponse({ done: true, faulted: true }))
        .mockResolvedValueOnce(jsonResponse({}));

      await expect(generateTextWithHorde()).rejects.toThrow();
      const [, cancelInit] = mockFetch.mock.calls[2];
      expect(cancelInit.method).toBe("DELETE");
      expect(cancelInit.keepalive).toBe(true);
      expect(cancelInit.signal).toBeInstanceOf(AbortSignal);
    });

    it("includes the configured model in the generation request body", async () => {
      mockSettings({ hordeModel: "custom-model" });
      const generateTextWithHorde = await loadHordeGenerator();

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

    describe("status poll failures", () => {
      // clearAllMocks keeps queued responses and implementations, and a poll
      // that stops early would leave them for the next test.
      afterEach(() => {
        mockFetch.mockReset();
      });

      const done = (text: string) =>
        jsonResponse({
          done: true,
          is_possible: true,
          generations: [{ text, model: "chosen-model" }],
        });

      it("keeps polling through a rate limit and finishes the generation", async () => {
        const generateTextWithHorde = await loadHordeGenerator();
        mockFetch
          .mockResolvedValueOnce(jsonResponse({ id: "gen-rate" }))
          .mockResolvedValueOnce(
            jsonResponse({ message: "Too many requests" }, 429),
          )
          .mockResolvedValueOnce(done("After the rate limit"));

        await generateTextWithHorde();

        expect(updateResponse).toHaveBeenCalledWith("After the rate limit");
      });

      it("recovers when a gateway answers a poll with an HTML error page", async () => {
        const generateTextWithHorde = await loadHordeGenerator();
        mockFetch
          .mockResolvedValueOnce(jsonResponse({ id: "gen-gateway" }))
          .mockResolvedValueOnce(
            new Response("<html><body>502 Bad Gateway</body></html>", {
              status: 502,
            }),
          )
          .mockResolvedValueOnce(done("After the gateway error"));

        await generateTextWithHorde();

        expect(updateResponse).toHaveBeenCalledWith("After the gateway error");
      });

      it("gives up on a status check that keeps failing without calling the model impossible", async () => {
        const generateTextWithHorde = await loadHordeGenerator();
        mockFetch
          .mockResolvedValueOnce(jsonResponse({ id: "gen-down" }))
          .mockImplementation(async () =>
            jsonResponse({ message: "Service unavailable" }, 503),
          );

        const error = await generateTextWithHorde().catch(
          (caught: Error) => caught,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Service unavailable");
        expect((error as Error).message).not.toContain(
          "Generation not possible",
        );
        // One submit, the polls up to the consecutive-failure cap, then the
        // cancel of the job that will never be read.
        expect(mockFetch).toHaveBeenCalledTimes(7);
        expect(mockFetch.mock.calls[6][1].method).toBe("DELETE");
      });

      it("stops at once when the job is gone, with the server's message", async () => {
        const generateTextWithHorde = await loadHordeGenerator();
        mockFetch
          .mockResolvedValueOnce(jsonResponse({ id: "gen-gone" }))
          .mockResolvedValueOnce(
            jsonResponse({ message: "Generation not found" }, 404),
          );

        await expect(generateTextWithHorde()).rejects.toThrow(
          "Generation not found",
        );
        // Submit, the one poll, then the cancel.
        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(mockFetch.mock.calls[2][1].method).toBe("DELETE");
      });

      it("rejects a finished generation that carries no text", async () => {
        const generateTextWithHorde = await loadHordeGenerator();
        mockFetch
          .mockResolvedValueOnce(jsonResponse({ id: "gen-empty" }))
          .mockResolvedValueOnce(
            jsonResponse({ done: true, is_possible: true, generations: [] }),
          );

        const error = await generateTextWithHorde().catch(
          (caught: Error) => caught,
        );

        expect((error as Error).message).toContain("No text generated");
        expect((error as Error).message).not.toContain("TypeError");
      });
    });

    it("reports the server's reason when the job is refused at submit", async () => {
      const generateTextWithHorde = await loadHordeGenerator();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ message: "Invalid API key" }, 401),
      );

      await expect(generateTextWithHorde()).rejects.toThrow("Invalid API key");
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
      expect(updateTextGenerationState).not.toHaveBeenCalled();
    });
  });

  describe("automatic model selection when no model is pinned", () => {
    const doneResponse = {
      done: true,
      is_possible: true,
      generations: [{ text: "Top model answer", model: "m-f" }],
    };

    function routeHordeFetch({
      workers,
      monthStats,
      statsFails = false,
      statusResponder,
    }: {
      workers: Array<{ models: string[]; max_length: number }>;
      monthStats?: Record<string, number>;
      statsFails?: boolean;
      statusResponder: (pollIndex: number, url: string) => unknown;
    }) {
      let idCounter = 0;
      let pollCounter = 0;
      mockFetch.mockImplementation(
        async (url: string, init?: { method?: string; body?: string }) => {
          if (url.includes("/workers")) {
            return jsonResponse(workers);
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
          const reply = statusResponder(pollCounter++, url);
          return reply instanceof Response ? reply : jsonResponse(reply);
        },
      );
    }

    /** Routes a worker whose job faults and expects the generation to reject. */
    async function expectFaultedGenerationRejects() {
      routeSingleWorker(() => ({ done: true, faulted: true }));

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).rejects.toThrow(
        "Generation failed",
      );
    }

    /** Runs one generation to its end and returns the generation request bodies. */
    async function generationBodiesAfterOneRun() {
      const generateTextWithHorde = await loadHordeGenerator();
      await generateTextWithHorde();
      return generationRequestBodies();
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
        workers: [
          { models: ["m-a", "m-b"], max_length: 1024 },
          { models: ["m-b", "m-c"], max_length: 1024 },
          { models: ["m-d"], max_length: 1024 },
          { models: ["m-e", "m-f"], max_length: 2048 },
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

      const bodies = await generationBodiesAfterOneRun();
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.models).toEqual(["m-f", "m-e", "m-d", "m-c", "m-b"]);
      }
    });

    it("skips models whose workers all write fewer than 1024 tokens", async () => {
      routeHordeFetch({
        workers: [
          { models: ["m-short"], max_length: 512 },
          { models: ["m-mixed"], max_length: 256 },
          { models: ["m-mixed"], max_length: 1024 },
          { models: ["m-long"], max_length: 4096 },
        ],
        monthStats: { "m-short": 900, "m-mixed": 800, "m-long": 700 },
        statusResponder: () => doneResponse,
      });

      const generateTextWithHorde = await loadHordeGenerator();
      await generateTextWithHorde();

      for (const body of generationRequestBodies()) {
        expect(body.models).toEqual(["m-mixed", "m-long"]);
      }
    });

    it("falls back to any available model when the statistics fetch fails", async () => {
      routeHordeFetch({
        workers: [{ models: ["m-a"], max_length: 1024 }],
        statsFails: true,
        statusResponder: () => doneResponse,
      });

      const bodies = await generationBodiesAfterOneRun();
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.models).toBeUndefined();
      }
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("falling back to any available model"),
      );
    });

    it("retries with any available model when the top models cannot take the job", async () => {
      routeSingleWorker((pollIndex) =>
        pollIndex < 2 ? { done: true, is_possible: false } : doneResponse,
      );

      const generateTextWithHorde = await loadHordeGenerator();
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

    it("does not submit a second round when the status checks keep failing", async () => {
      routeSingleWorker(() =>
        jsonResponse({ message: "Too many requests" }, 429),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).rejects.toThrow(
        "Too many requests",
      );
      expect(generationRequestBodies()).toHaveLength(2);
    });

    it("does not retry when the generation faults", async () => {
      await expectFaultedGenerationRejects();
      expect(generationRequestBodies()).toHaveLength(2);
    });

    /** Answers each job's polls from its own script, by the job id in the URL. */
    /** One worker with ten monthly generations, the shape most tests need. */
    function routeSingleWorker(
      statusResponder: (pollIndex: number, url: string) => unknown,
    ) {
      routeHordeFetch({
        workers: [{ models: ["m-a"], max_length: 1024 }],
        monthStats: { "m-a": 10 },
        statusResponder,
      });
    }

    function perJobResponder(
      scripts: Record<string, (jobPollIndex: number) => unknown>,
    ) {
      const jobPolls: Record<string, number> = {};
      return (_pollIndex: number, url: string) => {
        const jobId = url.slice(url.lastIndexOf("/") + 1);
        const jobPollIndex = jobPolls[jobId] ?? 0;
        jobPolls[jobId] = jobPollIndex + 1;
        return scripts[jobId](jobPollIndex);
      };
    }

    const pendingResponse = { done: false, is_possible: true, generations: [] };

    it("serves the healthy job when its sibling faults first", async () => {
      routeSingleWorker(
        perJobResponder({
          "gen-1": () => ({ done: true, faulted: true }),
          "gen-2": (poll) => (poll === 0 ? pendingResponse : doneResponse),
        }),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).resolves.toBe("Top model answer");

      expect(updateResponse).toHaveBeenCalledWith("Top model answer");
      expect(generationRequestBodies()).toHaveLength(2);
    });

    it("still retries with any model when one job faults and the other cannot take the job", async () => {
      routeSingleWorker(
        perJobResponder({
          // The faulted job is first in submission order, so picking the
          // first error would hide the "not possible" that the retry needs.
          "gen-1": () => ({ done: true, faulted: true }),
          "gen-2": () => ({ done: true, is_possible: false }),
          "gen-3": () => doneResponse,
          "gen-4": () => doneResponse,
        }),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).resolves.toBe("Top model answer");

      expect(generationRequestBodies()).toHaveLength(4);
    });

    it("reports an interrupt during the race and submits no retry", async () => {
      const controller = new AbortController();
      routeSingleWorker(
        perJobResponder({
          "gen-1": () => ({ done: true, is_possible: false }),
          "gen-2": (poll) => {
            // The user presses Stop while this job is still queued, after its
            // sibling has already reported it cannot take the job.
            if (poll >= 1) controller.abort();
            return pendingResponse;
          },
        }),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde(controller.signal)).rejects.toThrow(
        "Generation interrupted",
      );

      expect(generationRequestBodies()).toHaveLength(2);
    });

    it("cancels the losing job and not the winner", async () => {
      routeSingleWorker(
        perJobResponder({
          "gen-1": () => doneResponse,
          "gen-2": () => pendingResponse,
        }),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).resolves.toBe("Top model answer");
      expect(cancelledIds()).toEqual(["gen-2"]);
    });

    it("cancels the loser whose submit was still in flight when the race ended", async () => {
      routeSingleWorker(
        perJobResponder({
          "gen-1": () => doneResponse,
          "gen-2": () => pendingResponse,
        }),
      );
      const routed = mockFetch.getMockImplementation();
      let submits = 0;
      let releaseSecondSubmit: () => void = () => {};
      // The second submit is held until the test releases it, and rejects
      // when its signal aborts, the way a real fetch does.
      mockFetch.mockImplementation(
        (url: string, init?: { method?: string; signal?: AbortSignal }) => {
          if (!url.includes("/generate/text/async") || ++submits === 1) {
            return routed?.(url, init);
          }
          return new Promise((resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
            releaseSecondSubmit = () => resolve(jsonResponse({ id: "gen-2" }));
          });
        },
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).resolves.toBe("Top model answer");
      expect(cancelledIds()).toEqual([]);

      releaseSecondSubmit();
      await vi.waitFor(() => expect(cancelledIds()).toEqual(["gen-2"]));
    });

    it("returns the winner's answer without waiting for the loser's cancel", async () => {
      routeSingleWorker(
        perJobResponder({
          "gen-1": () => doneResponse,
          "gen-2": () => pendingResponse,
        }),
      );
      const routed = mockFetch.getMockImplementation();
      // A Horde that never answers the DELETE.
      mockFetch.mockImplementation((url: string, init?: { method?: string }) =>
        init?.method === "DELETE" ? new Promise(() => {}) : routed?.(url, init),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).resolves.toBe("Top model answer");
      expect(cancelledIds()).toEqual(["gen-2"]);
    });

    it("cancels both jobs when the race fails", async () => {
      await expectFaultedGenerationRejects();
      expect(cancelledIds().sort()).toEqual(["gen-1", "gen-2"]);
    });

    it("cancels the first round before submitting the fallback round", async () => {
      routeSingleWorker(
        perJobResponder({
          "gen-1": () => ({ done: true, is_possible: false }),
          "gen-2": () => ({ done: true, is_possible: false }),
          "gen-3": () => doneResponse,
          "gen-4": () => pendingResponse,
        }),
      );

      const generateTextWithHorde = await loadHordeGenerator();
      await expect(generateTextWithHorde()).resolves.toBe("Top model answer");

      const calls = mockFetch.mock.calls.map(([url, init]) =>
        (init as { method?: string })?.method === "DELETE"
          ? `DELETE ${String(url).slice(String(url).lastIndexOf("/") + 1)}`
          : String(url).includes("/generate/text/async")
            ? "SUBMIT"
            : "",
      );
      const thirdSubmit = calls.indexOf(
        "SUBMIT",
        calls.indexOf("SUBMIT", calls.indexOf("SUBMIT") + 1) + 1,
      );
      expect(calls.indexOf("DELETE gen-1")).toBeLessThan(thirdSubmit);
      expect(calls.indexOf("DELETE gen-2")).toBeLessThan(thirdSubmit);
      expect(cancelledIds().sort()).toEqual(["gen-1", "gen-2", "gen-4"]);
    });

    it("reuses the cached ranking for the next generation", async () => {
      routeSingleWorker(() => doneResponse);

      const generateTextWithHorde = await loadHordeGenerator();
      await generateTextWithHorde();
      await generateTextWithHorde();

      const rankingFetches = mockFetch.mock.calls.filter(
        ([url]) =>
          String(url).includes("/workers") ||
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

    it("refetches the ranking after the cache expires", async () => {
      routeSingleWorker(() => doneResponse);
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

      const generateTextWithHorde = await loadHordeGenerator();
      await generateTextWithHorde();
      nowSpy.mockReturnValue(5 * 60 * 1000 + 1);
      await generateTextWithHorde();
      nowSpy.mockRestore();

      const rankingFetches = mockFetch.mock.calls.filter(
        ([url]) =>
          String(url).includes("/workers") ||
          String(url).includes("/stats/text/models"),
      );
      expect(rankingFetches).toHaveLength(4);
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

    it.each([
      ["kudos is missing", { username: "bob" }],
      ["username is missing", { kudos: 1000 }],
      ["kudos is not a number", { username: "bob", kudos: "1000" }],
      ["the body is null", null],
    ])("returns null and logs when %s", async (_, body) => {
      const { fetchHordeUserInfo } = await import("./textGenerationWithHorde");

      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      const userInfo = await fetchHordeUserInfo("test-api-key");

      expect(userInfo).toBeNull();
      expect(addLogEntry).toHaveBeenCalledWith(
        expect.stringContaining("malformed user info"),
      );
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
