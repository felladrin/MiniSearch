import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(),
}));

vi.mock("./pageContentService", () => ({
  fetchPageContents: vi.fn(),
}));

import { handleTokenVerification } from "./handleTokenVerification";
import {
  createRequest,
  createRequestWithBadHost,
  createResponse,
  expectBadHostRejected,
  getRegisteredHookHandler,
} from "./hookTestUtils";

import { pageContentEndpointServerHook } from "./pageContentEndpointServerHook";
import { fetchPageContents } from "./pageContentService";

function callEndpoint(requestUrl: string) {
  const response = createResponse();
  const next = vi.fn();

  return {
    response,
    next,
    handled: getRegisteredHookHandler(pageContentEndpointServerHook)(
      createRequest(requestUrl),
      response,
      next,
    ),
  };
}

function parseBody(response: ReturnType<typeof createResponse>): unknown {
  return JSON.parse(response.end.mock.calls[0][0]);
}

describe("pageContentEndpointServerHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    vi.mocked(fetchPageContents).mockResolvedValue([]);
  });

  it("serves the endpoint", async () => {
    const { handled } = callEndpoint(
      "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&token=abc",
    );
    await handled;

    expect(fetchPageContents).toHaveBeenCalled();
  });

  it("reads a repeated URL once", async () => {
    const { handled } = callEndpoint(
      "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&url=https%3A%2F%2Fa.example%2F&url=https%3A%2F%2Fb.example%2F&token=abc",
    );
    await handled;

    expect(fetchPageContents).toHaveBeenCalledWith("cats", [
      "https://a.example/",
      "https://b.example/",
    ]);
  });

  it("counts the repeats against the URL limit before deduping them", async () => {
    // Deduping first would let a caller send any number of `url` params and
    // still get a full batch of reads out of the endpoint.
    const url = "&url=https%3A%2F%2Fa.example%2F";
    const { response, handled } = callEndpoint(
      `/page-content?q=cats${url.repeat(7)}&token=abc`,
    );
    await handled;

    expect(response.statusCode).toBe(400);
    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("passes through a path that only starts like the endpoint", async () => {
    const { next, handled } = callEndpoint("/page-content-something-else");
    await handled;

    expect(next).toHaveBeenCalled();
    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("passes through requests for other paths", async () => {
    const { next, handled } = callEndpoint("/status");
    await handled;

    expect(next).toHaveBeenCalled();
    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("answers with the extracted text keyed by URL", async () => {
    vi.mocked(fetchPageContents).mockResolvedValue([
      { url: "https://a.example/", content: "text from a" },
    ]);

    const { response, handled } = callEndpoint(
      "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&url=https%3A%2F%2Fb.example%2F&token=abc",
    );
    await handled;

    expect(fetchPageContents).toHaveBeenCalledWith("cats", [
      "https://a.example/",
      "https://b.example/",
    ]);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(parseBody(response)).toEqual({
      "https://a.example/": "text from a",
    });
  });

  it("rejects a request without a query", async () => {
    const { response, handled } = callEndpoint(
      "/page-content?url=https%3A%2F%2Fa.example%2F&token=abc",
    );
    await handled;

    expect(response.statusCode).toBe(400);
    expect(parseBody(response)).toEqual({ error: "Missing query parameter" });
    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("rejects a request without any URL", async () => {
    const { response, handled } = callEndpoint(
      "/page-content?q=cats&token=abc",
    );
    await handled;

    expect(response.statusCode).toBe(400);
    expect(parseBody(response)).toEqual({ error: "Missing url parameter" });
  });

  it("rejects a URL the browser would never have produced", async () => {
    const { response, handled } = callEndpoint(
      "/page-content?q=cats&url=javascript%3Aalert(1)&token=abc",
    );
    await handled;

    expect(response.statusCode).toBe(400);
    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("refuses to read more pages than the prompt can hold", async () => {
    const urls = Array.from(
      { length: 7 },
      (_, index) => `url=https%3A%2F%2Fexample.com%2F${index}`,
    ).join("&");

    const { response, handled } = callEndpoint(
      `/page-content?q=cats&${urls}&token=abc`,
    );
    await handled;

    expect(response.statusCode).toBe(400);
    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("stops when token verification fails", async () => {
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: false,
    });

    const { handled } = callEndpoint(
      "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&token=bad",
    );
    await handled;

    expect(fetchPageContents).not.toHaveBeenCalled();
  });

  it("answers 500 when reading throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchPageContents).mockRejectedValue(new Error("boom"));

    const { response, handled } = callEndpoint(
      "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&token=abc",
    );
    await handled;

    expect(response.statusCode).toBe(500);
    expect(parseBody(response)).toEqual({ error: "Internal server error" });
  });
  it("records whether a page-content request got anything to ground on", async () => {
    const { getPageReadStats } = await import("./pageReadsSinceLastRestart");
    const before = getPageReadStats().grounding;
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });

    const url = "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&token=abc";

    vi.mocked(fetchPageContents).mockResolvedValue([
      { url: "https://a.example/", content: "text worth quoting" },
    ]);
    await callEndpoint(url).handled;

    expect(getPageReadStats().grounding.withContent).toBe(
      before.withContent + 1,
    );
    expect(getPageReadStats().grounding.withoutContent).toBe(
      before.withoutContent,
    );

    vi.mocked(fetchPageContents).mockResolvedValue([]);
    await callEndpoint(url).handled;

    expect(getPageReadStats().grounding.withoutContent).toBe(
      before.withoutContent + 1,
    );
    expect(getPageReadStats().grounding.requests).toBe(before.requests + 2);
  });
});

describe("pageContentEndpointServerHook with a malformed Host header", () => {
  it("answers 400 and keeps the handler promise from rejecting", async () => {
    vi.clearAllMocks();
    await expectBadHostRejected(
      getRegisteredHookHandler(pageContentEndpointServerHook),
      "/page-content?url=http://example.com&token=abc",
      handleTokenVerification,
    );
  });
});
