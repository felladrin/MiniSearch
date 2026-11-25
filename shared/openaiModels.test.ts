import { afterEach, describe, expect, it, vi } from "vitest";
import { listOpenAiCompatibleModels } from "./openaiModels";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe("listOpenAiCompatibleModels", () => {
  it("skips entries without a usable id", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "a" }, { object: "model" }, { id: "" }, null, { id: 7 }],
        }),
      ),
    );

    await expect(listOpenAiCompatibleModels("http://x/v1/")).resolves.toEqual([
      { id: "a" },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://x/v1/models");
  });

  it("aborts with the caller's signal", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    const controller = new AbortController();

    await listOpenAiCompatibleModels("http://x", undefined, controller.signal);
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("gives up on a server that never answers after 10 seconds", async () => {
    const timeout = new AbortController();
    const spy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          ),
        ),
    );

    const listing = listOpenAiCompatibleModels("http://black-hole");
    expect(spy).toHaveBeenCalledWith(10_000);
    timeout.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(listing).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
