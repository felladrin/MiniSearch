import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(),
}));

vi.mock("./searchesSinceLastRestart", () => ({
  recordThumbnailRequested: vi.fn(),
  recordThumbnailDropped: vi.fn(),
  recordThumbnailBlocked: vi.fn(),
}));

import { handleTokenVerification } from "./handleTokenVerification";
import {
  recordThumbnailBlocked,
  recordThumbnailDropped,
  recordThumbnailRequested,
} from "./searchesSinceLastRestart";
import {
  getThumbnailCacheLimits,
  resetThumbnailCache,
  thumbnailEndpointServerHook,
} from "./thumbnailEndpointServerHook";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:3000" },
  } as unknown as IncomingMessage;
}

function createResponse() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function getRegisteredHandler() {
  const use = vi.fn();
  thumbnailEndpointServerHook({
    middlewares: { use },
  } as unknown as Parameters<typeof thumbnailEndpointServerHook>[0]);
  return use.mock.calls[0][0] as (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => Promise<void>;
}

// The in-process cache is module state, so each test aims at its own URL and
// a hit can only come from the request the test itself made.
let urlCounter = 0;
function publicThumbnailUrl(): string {
  urlCounter += 1;
  return `https://thumbs.example.com/${urlCounter}/image.jpg`;
}

function requestUrlFor(thumbnailUrl: string): string {
  return `/thumbnail?u=${encodeURIComponent(thumbnailUrl)}&token=abc`;
}

function imageResponse(
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]),
  contentType = "image/jpeg",
): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("thumbnailEndpointServerHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through requests that aren't under /thumbnail", async () => {
    const handler = getRegisteredHandler();
    const next = vi.fn();

    await handler(createRequest("/status"), createResponse(), next);

    expect(next).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops processing when token verification fails", async () => {
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: false,
    });
    const handler = getRegisteredHandler();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      createResponse(),
      vi.fn(),
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordThumbnailRequested).not.toHaveBeenCalled();
  });

  it("responds 400 when the thumbnail URL is missing", async () => {
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(createRequest("/thumbnail?token=abc"), response, vi.fn());

    expect(response.statusCode).toBe(400);
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Missing thumbnail URL" }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordThumbnailRequested).not.toHaveBeenCalled();
  });

  it("serves a fetched image with its normalized content type and a private cache", async () => {
    mockFetch.mockResolvedValue(
      imageResponse(new Uint8Array([1, 2, 3]), "IMAGE/JPEG; charset=binary"),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "image/jpeg",
    );
    // The response is same-origin, so the browser must be barred from
    // interpreting the bytes as anything but the declared image type.
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "default-src 'none'; sandbox",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, max-age=3600",
    );
    expect(response.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(recordThumbnailRequested).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).not.toHaveBeenCalled();
    expect(recordThumbnailBlocked).not.toHaveBeenCalled();
  });

  it("verifies through the thumbnail's own rate-limit budget", async () => {
    mockFetch.mockResolvedValue(imageResponse());
    const { thumbnailRateLimiter } = await import("./verifyTokenAndRateLimit");
    const handler = getRegisteredHandler();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      createResponse(),
      vi.fn(),
    );

    // The whole separate-budget design rests on this wiring: delete the
    // options argument and the grid's 30 tile loads draw from the search
    // budget again.
    expect(vi.mocked(handleTokenVerification)).toHaveBeenCalledWith(
      "abc",
      expect.anything(),
      expect.anything(),
      { limiter: thumbnailRateLimiter },
    );
  });

  it("serves a repeat request from the cache without fetching again", async () => {
    const url = publicThumbnailUrl();
    // A fresh Response per call: a body can only be read once.
    mockFetch.mockImplementation(async () => imageResponse());
    const handler = getRegisteredHandler();

    await handler(createRequest(requestUrlFor(url)), createResponse(), vi.fn());
    await handler(createRequest(requestUrlFor(url)), createResponse(), vi.fn());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Both requests are demand, so both count even though only one fetched.
    expect(recordThumbnailRequested).toHaveBeenCalledTimes(2);
  });

  it("refuses a URL that resolves into a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.5", family: 4 }]);
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordThumbnailBlocked).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("refuses a URL with a non-HTTP scheme", async () => {
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor("file:///etc/passwd")),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordThumbnailBlocked).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("refuses a URL longer than the cap", async () => {
    const handler = getRegisteredHandler();
    const response = createResponse();
    const longUrl = `https://thumbs.example.com/${"a".repeat(2050)}`;

    await handler(createRequest(requestUrlFor(longUrl)), response, vi.fn());

    expect(response.statusCode).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(recordThumbnailRequested).not.toHaveBeenCalled();
  });

  it("does not follow a redirect into a private address", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://10.0.0.7/thumb.jpg" },
      }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(recordThumbnailBlocked).toHaveBeenCalledTimes(1);
  });

  it("answers 502 with no-store when the upstream returns an error status", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store",
    );
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Thumbnail could not be fetched" }),
    );
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when the upstream answer is not an accepted image type", async () => {
    mockFetch.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when the upstream answer is an SVG", async () => {
    // An SVG is a document: served same-origin it would run its scripts.
    mockFetch.mockResolvedValue(
      new Response("<svg><script>alert(1)</script></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect with a malformed Location", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://[" },
      }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next load retries the upstream", async () => {
    const url = publicThumbnailUrl();
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(imageResponse());
    const handler = getRegisteredHandler();

    const first = createResponse();
    await handler(createRequest(requestUrlFor(url)), first, vi.fn());
    expect(first.statusCode).toBe(502);

    const second = createResponse();
    await handler(createRequest(requestUrlFor(url)), second, vi.fn());
    expect(second.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("answers 502 when the upstream body is empty", async () => {
    mockFetch.mockResolvedValue(
      new Response(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("bounds a hanging DNS lookup with the same deadline", async () => {
    // A resolver that never settles must not add its own timeout on top of
    // the documented one. Matches THUMBNAIL_TIMEOUT_MS.
    const thumbnailTimeoutMs = 3000;
    lookupMock.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const handler = getRegisteredHandler();
      const response = createResponse();
      const handled = handler(
        createRequest(requestUrlFor(publicThumbnailUrl())),
        response,
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(thumbnailTimeoutMs);
      await handled;

      expect(response.statusCode).toBe(502);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 502 when the host never answers within the timeout", async () => {
    // Matches THUMBNAIL_TIMEOUT_MS in thumbnailEndpointServerHook.ts.
    const thumbnailTimeoutMs = 3000;
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("The operation was aborted")),
            );
          }),
      );
      const handler = getRegisteredHandler();
      const response = createResponse();
      const handled = handler(
        createRequest(requestUrlFor(publicThumbnailUrl())),
        response,
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(thumbnailTimeoutMs);
      await handled;

      expect(response.statusCode).toBe(502);
      expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 502 after the redirect budget is spent", async () => {
    mockFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://thumbs.example.com/loop.jpg" },
      }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    // One request per hop, four hops for three redirects.
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("truncates an oversized body to the byte cap", async () => {
    const bigBody = new Uint8Array(600_000).fill(7);
    mockFetch.mockResolvedValue(imageResponse(bigBody));
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    const body = response.end.mock.calls[0][0] as Buffer;
    // The cap is 500_000 bytes; a 600_000-byte body must be truncated.
    expect(body.length).toBe(500_000);
  });

  it("evicts the least recently used entry, not the least recently loaded one", async () => {
    // A fresh Response per call: a body can only be read once.
    mockFetch.mockImplementation(async () => imageResponse());
    const handler = getRegisteredHandler();
    // A clean slate, so the eviction side is exactly where this test puts it.
    resetThumbnailCache();
    const firstUrl = publicThumbnailUrl();
    const secondUrl = publicThumbnailUrl();
    const maxEntries = getThumbnailCacheLimits().entries;
    const load = (url: string) =>
      handler(createRequest(requestUrlFor(url)), createResponse(), vi.fn());
    const fetched = (url: string) =>
      mockFetch.mock.calls.filter((call) => String(call[0]) === url).length;

    await load(firstUrl);
    await load(secondUrl);

    // Re-reading firstUrl promotes it, so secondUrl is the eviction candidate.
    await load(firstUrl);

    for (let i = 0; i < maxEntries - 2; i += 1) {
      await load(publicThumbnailUrl());
    }
    // This insert pushes the cache past the cap: exactly one entry is evicted.
    await load(publicThumbnailUrl());

    // firstUrl (promoted by the re-read) survived and serves from the cache.
    // A cache without promote-on-hit would have evicted it, being the oldest
    // load.
    await load(firstUrl);
    expect(fetched(firstUrl)).toBe(1);
    // secondUrl (least recently used) was evicted and fetches again.
    await load(secondUrl);
    expect(fetched(secondUrl)).toBe(2);
  });
});
