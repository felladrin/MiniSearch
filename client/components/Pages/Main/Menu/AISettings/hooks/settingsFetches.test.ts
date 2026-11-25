import { listOpenAiCompatibleModels } from "@shared/openaiModels";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "@/modules/logEntries";
import { defaultSettings } from "@/modules/settings";
import {
  aiHordeDefaultApiKey,
  fetchHordeModels,
  fetchHordeUserInfo,
} from "@/modules/textGenerationWithHorde";
import { useHordeModels } from "./useHordeModels";
import { useHordeUserInfo } from "./useHordeUserInfo";
import { useOpenAiModels } from "./useOpenAiModels";

vi.mock("@shared/openaiModels", () => ({
  listOpenAiCompatibleModels: vi.fn(),
}));
vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("@/modules/textGenerationWithHorde", () => ({
  aiHordeDefaultApiKey: "0000000000",
  fetchHordeUserInfo: vi.fn(),
  fetchHordeModels: vi.fn(),
}));

type Settings = typeof defaultSettings;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Records the signal of each call and lets the test settle calls in any order. */
function controlled<T>(mock: ReturnType<typeof vi.fn>, signalArg: number) {
  const calls: { signal: AbortSignal; resolve: (v: T) => void }[] = [];
  mock.mockImplementation((...args: unknown[]) => {
    const d = deferred<T>();
    calls.push({ signal: args[signalArg] as AbortSignal, resolve: d.resolve });
    return d.promise;
  });
  return calls;
}

/** Replaces `AbortSignal.timeout` with timeouts the test fires by hand. */
function manualTimeouts() {
  const timeouts: { ms: number; fire: () => void }[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const c = new AbortController();
    timeouts.push({
      ms,
      fire: () => c.abort(new DOMException("Timed out", "TimeoutError")),
    });
    return c.signal;
  });
  return timeouts;
}

const openAi = (patch: Partial<Settings>): Settings => ({
  ...defaultSettings,
  inferenceType: "openai",
  ...patch,
});
const horde = (patch: Partial<Settings>): Settings => ({
  ...defaultSettings,
  inferenceType: "horde",
  ...patch,
});

beforeEach(() => {
  vi.mocked(addLogEntry).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOpenAiModels", () => {
  it("keeps the latest server's list when an older response arrives last", async () => {
    const calls = controlled<{ id: string }[]>(
      vi.mocked(listOpenAiCompatibleModels),
      2,
    );
    const { result, rerender } = renderHook(
      (s: Settings) => useOpenAiModels(s),
      {
        initialProps: openAi({ openAiApiBaseUrl: "http://old" }),
      },
    );
    rerender(openAi({ openAiApiBaseUrl: "http://new" }));

    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);

    calls[1].resolve([{ id: "new-model" }]);
    await waitFor(() =>
      expect(result.current.openAiModels).toEqual([
        { label: "new-model", value: "new-model" },
      ]),
    );
    calls[0].resolve([{ id: "old-model" }]);
    await Promise.resolve();

    expect(result.current.openAiModels).toEqual([
      { label: "new-model", value: "new-model" },
    ]);
    expect(result.current.useTextInput).toBe(false);
  });

  it("does not log an error for a request aborted by a newer keystroke", async () => {
    vi.mocked(listOpenAiCompatibleModels).mockImplementation(
      (_url, _key, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    const { rerender } = renderHook((s: Settings) => useOpenAiModels(s), {
      initialProps: openAi({ openAiApiBaseUrl: "http://a" }),
    });
    rerender(openAi({ openAiApiBaseUrl: "http://ab" }));
    await Promise.resolve();

    expect(addLogEntry).not.toHaveBeenCalled();
  });

  it("forgets the previous server's models when the base URL is cleared", async () => {
    vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([{ id: "m" }]);
    const { result, rerender } = renderHook(
      (s: Settings) => useOpenAiModels(s),
      {
        initialProps: openAi({ openAiApiBaseUrl: "http://a" }),
      },
    );
    await waitFor(() => expect(result.current.openAiModels).toHaveLength(1));

    rerender(openAi({ openAiApiBaseUrl: "" }));

    expect(result.current.openAiModels).toEqual([]);
    expect(result.current.useTextInput).toBe(false);
  });
});

describe("useHordeUserInfo", () => {
  it("stays cleared when the key is cleared while a lookup is in flight", async () => {
    const calls = controlled<{ username: string; kudos: number } | null>(
      vi.mocked(fetchHordeUserInfo),
      1,
    );
    const { result, rerender } = renderHook(
      (s: Settings) => useHordeUserInfo(s),
      {
        initialProps: horde({ hordeApiKey: "secret-key" }),
      },
    );
    rerender(horde({ hordeApiKey: "" }));

    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve({ username: "old#1", kudos: 5 });
    await Promise.resolve();

    expect(result.current).toBeNull();
  });

  it("gives up on a /find_user that never answers after 10 seconds", () => {
    const timeouts = manualTimeouts();
    const calls = controlled<null>(vi.mocked(fetchHordeUserInfo), 1);
    renderHook(() => useHordeUserInfo(horde({ hordeApiKey: "secret-key" })));

    expect(timeouts.map((t) => t.ms)).toEqual([10_000]);
    expect(calls[0].signal.aborted).toBe(false);
    timeouts[0].fire();
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("does not look up the anonymous key", () => {
    vi.mocked(fetchHordeUserInfo).mockClear();
    renderHook(() =>
      useHordeUserInfo(horde({ hordeApiKey: aiHordeDefaultApiKey })),
    );
    expect(fetchHordeUserInfo).not.toHaveBeenCalled();
  });
});

describe("useHordeModels", () => {
  it("aborts the request when another backend is selected", () => {
    const calls = controlled<never[]>(vi.mocked(fetchHordeModels), 0);
    const { rerender } = renderHook((s: Settings) => useHordeModels(s), {
      initialProps: horde({}),
    });
    rerender(openAi({}));

    expect(calls[0].signal.aborted).toBe(true);
  });

  it("gives up on a /status/models that never answers after 10 seconds", () => {
    const timeouts = manualTimeouts();
    const calls = controlled<never[]>(vi.mocked(fetchHordeModels), 0);
    renderHook(() => useHordeModels(horde({})));

    expect(timeouts.map((t) => t.ms)).toEqual([10_000]);
    timeouts[0].fire();
    expect(calls[0].signal.aborted).toBe(true);
  });
});
