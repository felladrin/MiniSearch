import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(),
}));

vi.mock("./pageContentService", () => ({
  fetchPageContents: vi.fn(),
}));

import { handleTokenVerification } from "./handleTokenVerification";
import { pageContentEndpointServerHook } from "./pageContentEndpointServerHook";
import { fetchPageContents } from "./pageContentService";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;

type RecordedResponse = ServerResponse & {
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function callEndpoint(requestUrl: string) {
  const use = vi.fn();
  pageContentEndpointServerHook({
    middlewares: { use },
  } as unknown as Parameters<typeof pageContentEndpointServerHook>[0]);

  const response = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as RecordedResponse;
  const next = vi.fn();
  const request = {
    url: requestUrl,
    headers: { host: "localhost:7860" },
  } as unknown as IncomingMessage;

  return {
    response,
    next,
    handled: (use.mock.calls[0][0] as Handler)(request, response, next),
  };
}

function parseBody(response: RecordedResponse): unknown {
  return JSON.parse(response.end.mock.calls[0][0]);
}

describe("pageContentEndpointServerHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PAGE_CONTENT_READING_ENABLED", "true");
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    vi.mocked(fetchPageContents).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["", "false", "0", "yes", "on"])(
    "answers 404 while the operator flag reads %o",
    async (flag) => {
      vi.stubEnv("PAGE_CONTENT_READING_ENABLED", flag);

      const { response, handled } = callEndpoint(
        "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&token=abc",
      );
      await handled;

      expect(response.statusCode).toBe(404);
      expect(handleTokenVerification).not.toHaveBeenCalled();
      expect(fetchPageContents).not.toHaveBeenCalled();
    },
  );

  it.each(["true", "TRUE", " 1 "])(
    "serves the endpoint while the operator flag reads %o",
    async (flag) => {
      vi.stubEnv("PAGE_CONTENT_READING_ENABLED", flag);

      const { handled } = callEndpoint(
        "/page-content?q=cats&url=https%3A%2F%2Fa.example%2F&token=abc",
      );
      await handled;

      expect(fetchPageContents).toHaveBeenCalled();
    },
  );

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
});
