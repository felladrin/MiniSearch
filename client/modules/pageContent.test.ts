import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn().mockResolvedValue("token-hash"),
}));

import { fetchPageContents } from "./pageContent";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function getRequestedUrl(): URL {
  return new URL(fetchMock.mock.calls[0][0]);
}

describe("fetchPageContents", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("does not call the server when there is nothing to read", async () => {
    expect(await fetchPageContents("cats", [])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for every URL in one request and returns what came back", async () => {
    const contents = { "https://a.example/": "text from a" };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(contents), { status: 200 }),
    );

    const result = await fetchPageContents("cats", [
      "https://a.example/",
      "https://b.example/",
    ]);

    const requestedUrl = getRequestedUrl();
    expect(requestedUrl.pathname).toBe("/page-content");
    expect(requestedUrl.searchParams.get("q")).toBe("cats");
    expect(requestedUrl.searchParams.get("token")).toBe("token-hash");
    expect(requestedUrl.searchParams.getAll("url")).toEqual([
      "https://a.example/",
      "https://b.example/",
    ]);
    expect(result).toEqual(contents);
  });

  it("falls back to no page content when the server errors", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    expect(await fetchPageContents("cats", ["https://a.example/"])).toEqual({});
  });

  it("falls back to no page content when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    expect(await fetchPageContents("cats", ["https://a.example/"])).toEqual({});
  });

  it("gives up on a server that never answers", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("The operation was aborted")),
            );
          }),
      );

      const pending = fetchPageContents("cats", ["https://a.example/"]);
      await vi.advanceTimersByTimeAsync(20000);

      expect(await pending).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
