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

// The hook's connect goes through the pinned request, so that is the seam
// under test here; the capped reader stays real so the size-cap semantics
// this file asserts are the shipped ones. The pin itself is covered by
// pinnedFetch.test.ts.
const pinnedRequestMock = vi.hoisted(() => vi.fn());

vi.mock("./utils/pinnedFetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./utils/pinnedFetch.ts")>();
  return {
    ...actual,
    requestPinnedToVettedAddress: pinnedRequestMock,
  };
});

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

// Shaped like the IncomingMessage the pinned request resolves with: the
// fields the hook reads, plus the async iteration readCappedStream drives.
function fakeIncoming(
  bytes: Uint8Array,
  statusCode: number,
  headers: Record<string, string>,
): IncomingMessage {
  return {
    statusCode,
    headers,
    destroy: vi.fn(),
    async *[Symbol.asyncIterator]() {
      if (bytes.byteLength > 0) yield bytes;
    },
  } as unknown as IncomingMessage;
}

function imageResponse(
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]),
  contentType = "image/jpeg",
): IncomingMessage {
  return fakeIncoming(bytes, 200, { "content-type": contentType });
}

describe("thumbnailEndpointServerHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pinnedRequestMock.mockReset();
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
    expect(pinnedRequestMock).not.toHaveBeenCalled();
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

    expect(pinnedRequestMock).not.toHaveBeenCalled();
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
    expect(pinnedRequestMock).not.toHaveBeenCalled();
    expect(recordThumbnailRequested).not.toHaveBeenCalled();
  });

  it("serves a fetched image with its normalized content type and a private cache", async () => {
    pinnedRequestMock.mockResolvedValue(
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
    pinnedRequestMock.mockResolvedValue(imageResponse());
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
    // A fresh response per call: a body can only be read once.
    pinnedRequestMock.mockImplementation(async () => imageResponse());
    const handler = getRegisteredHandler();

    await handler(createRequest(requestUrlFor(url)), createResponse(), vi.fn());
    await handler(createRequest(requestUrlFor(url)), createResponse(), vi.fn());

    expect(pinnedRequestMock).toHaveBeenCalledTimes(1);
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
    expect(pinnedRequestMock).not.toHaveBeenCalled();
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
    expect(pinnedRequestMock).not.toHaveBeenCalled();
    expect(recordThumbnailBlocked).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("refuses a URL longer than the cap", async () => {
    const handler = getRegisteredHandler();
    const response = createResponse();
    const longUrl = `https://thumbs.example.com/${"a".repeat(2050)}`;

    await handler(createRequest(requestUrlFor(longUrl)), response, vi.fn());

    expect(response.statusCode).toBe(400);
    expect(pinnedRequestMock).not.toHaveBeenCalled();
    expect(recordThumbnailRequested).not.toHaveBeenCalled();
  });

  it("pins the address vetted at the first DNS answer, never the rebound one", async () => {
    // The rebinding attack: the first answer is public, the second — the
    // one a re-resolving fetch would get at connect time — is private.
    // The pinned connect must use the vetted answer, and the private one
    // must never be dialed.
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
    pinnedRequestMock.mockResolvedValue(imageResponse());
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(pinnedRequestMock).toHaveBeenCalledTimes(1);
    expect(pinnedRequestMock.mock.calls[0][1]).toBe("93.184.216.34");
    expect(
      pinnedRequestMock.mock.calls.some((call) => call[1] === "10.0.0.7"),
    ).toBe(false);
  });

  it("does not follow a redirect into a private address", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
    pinnedRequestMock.mockResolvedValueOnce(
      fakeIncoming(new Uint8Array(), 302, {
        location: "http://10.0.0.7/thumb.jpg",
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
    // The redirect target was refused at validation: its socket was never
    // opened, so the private address was never connected to.
    expect(pinnedRequestMock).toHaveBeenCalledTimes(1);
    expect(pinnedRequestMock.mock.calls[0][1]).toBe("93.184.216.34");
    expect(recordThumbnailBlocked).toHaveBeenCalledTimes(1);
  });

  it("answers 502 with no-store when the upstream returns an error status", async () => {
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new Uint8Array(), 404, {}),
    );
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
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new TextEncoder().encode("<html></html>"), 200, {
        "content-type": "text/html",
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
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(
        new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
        200,
        { "content-type": "image/svg+xml" },
      ),
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
    pinnedRequestMock.mockResolvedValueOnce(
      fakeIncoming(new Uint8Array(), 302, { location: "http://[" }),
    );
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(
      createRequest(requestUrlFor(publicThumbnailUrl())),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(502);
    expect(pinnedRequestMock).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next load retries the upstream", async () => {
    const url = publicThumbnailUrl();
    pinnedRequestMock
      .mockResolvedValueOnce(fakeIncoming(new Uint8Array(), 404, {}))
      .mockResolvedValueOnce(imageResponse());
    const handler = getRegisteredHandler();

    const first = createResponse();
    await handler(createRequest(requestUrlFor(url)), first, vi.fn());
    expect(first.statusCode).toBe(502);

    const second = createResponse();
    await handler(createRequest(requestUrlFor(url)), second, vi.fn());
    expect(second.statusCode).toBe(200);
    expect(pinnedRequestMock).toHaveBeenCalledTimes(2);
  });

  it("answers 502 when the upstream body is empty", async () => {
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new Uint8Array(), 200, { "content-type": "image/jpeg" }),
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
      expect(pinnedRequestMock).not.toHaveBeenCalled();
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
      pinnedRequestMock.mockImplementation(
        (_url: URL, _address: string, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
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
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new Uint8Array(), 302, {
        location: "https://thumbs.example.com/loop.jpg",
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
    expect(pinnedRequestMock).toHaveBeenCalledTimes(4);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("truncates an oversized body to the byte cap", async () => {
    const bigBody = new Uint8Array(600_000).fill(7);
    pinnedRequestMock.mockResolvedValue(imageResponse(bigBody));
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
    // A fresh response per call: a body can only be read once.
    pinnedRequestMock.mockImplementation(async () => imageResponse());
    const handler = getRegisteredHandler();
    // A clean slate, so the eviction side is exactly where this test puts it.
    resetThumbnailCache();
    const firstUrl = publicThumbnailUrl();
    const secondUrl = publicThumbnailUrl();
    const maxEntries = getThumbnailCacheLimits().entries;
    const load = (url: string) =>
      handler(createRequest(requestUrlFor(url)), createResponse(), vi.fn());
    const fetched = (url: string) =>
      pinnedRequestMock.mock.calls.filter((call) => String(call[0]) === url)
        .length;

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
