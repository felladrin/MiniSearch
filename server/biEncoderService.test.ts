import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCORE_TIMEOUT_MS,
  scorePassages,
  startBiEncoderService,
  stopBiEncoderService,
} from "./biEncoderService";
import type { BiEncoderRequest } from "./biEncoderWorkerProtocol";

const { FakeWorker } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");

  /**
   * Stands in for the worker thread: it reports nothing on its own, so each
   * test decides whether a request gets a reply, a late reply or none at all.
   */
  class FakeWorker extends EventEmitter {
    static latest: FakeWorker;
    readonly requests: BiEncoderRequest[] = [];

    constructor() {
      super();
      FakeWorker.latest = this;
    }

    postMessage(request: BiEncoderRequest) {
      this.requests.push(request);
    }

    async terminate() {
      return 0;
    }

    reply(id: number, scores: number[]) {
      this.emit("message", { type: "scores", id, scores });
    }
  }

  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({ Worker: FakeWorker }));

async function startWithFakeWorker() {
  const started = startBiEncoderService();
  FakeWorker.latest.emit("message", { type: "ready" });
  await started;
  return FakeWorker.latest;
}

/** Settles a promise without awaiting it, so a test can see it is pending. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T } = { settled: false };
  promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

describe("scorePassages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopBiEncoderService();
    vi.useRealTimers();
  });

  it("answers empty scores when a ready worker never replies", async () => {
    await startWithFakeWorker();

    const result = track(scorePassages("query", ["a", "b"]));
    await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS - 1);
    expect(result.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ settled: true, value: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves with the reply's scores and clears its timer", async () => {
    const fakeWorker = await startWithFakeWorker();

    const scores = scorePassages("query", ["a", "b"]);
    fakeWorker.reply(fakeWorker.requests[0].id, [0.25, 0.75]);

    await expect(scores).resolves.toEqual([0.25, 0.75]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a reply after the timeout and still serves the next request", async () => {
    const fakeWorker = await startWithFakeWorker();

    const timedOut = scorePassages("query", ["a"]);
    await vi.advanceTimersByTimeAsync(SCORE_TIMEOUT_MS);
    await expect(timedOut).resolves.toEqual([]);
    fakeWorker.reply(fakeWorker.requests[0].id, [0.5]);

    const next = scorePassages("query", ["b"]);
    fakeWorker.reply(fakeWorker.requests[1].id, [0.9]);
    await expect(next).resolves.toEqual([0.9]);
  });

  it("answers empty scores and clears timers when the service stops", async () => {
    await startWithFakeWorker();

    const scores = scorePassages("query", ["a"]);
    await stopBiEncoderService();

    await expect(scores).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers empty scores and clears timers when the worker exits", async () => {
    const fakeWorker = await startWithFakeWorker();

    const scores = scorePassages("query", ["a"]);
    fakeWorker.emit("exit", 1);

    await expect(scores).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
