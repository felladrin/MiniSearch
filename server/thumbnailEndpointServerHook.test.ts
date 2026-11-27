import type { IncomingMessage } from "node:http";
import debug from "debug";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jscpd:ignore-start
// vi.mock is hoisted above the imports, so each file registers its own mocks;
// only the factory bodies could be shared, and the ones that differ do.
const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));
// jscpd:ignore-end

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
  createRequest,
  createRequestWithBadHost,
  createResponse,
  expectBadHostRejected,
  getRegisteredHookHandler,
} from "./hookTestUtils";

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

function getRegisteredHandler() {
  return getRegisteredHookHandler(thumbnailEndpointServerHook);
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

/**
 * Sends `path` through the hook; returns the response and the `next` it was
 * given. Registers a fresh hook per call; the cache is module state, so calls
 * still share it.
 */
async function requestPath(path: string) {
  const response = createResponse();
  const next = vi.fn();
  await getRegisteredHandler()(createRequest(path), response, next);
  return { response, next };
}

/**
 * Requests the thumbnail at `thumbnailUrl` through the hook; returns the
 * response. The default is a new URL each time, so it never hits the cache.
 */
async function requestThumbnail(thumbnailUrl = publicThumbnailUrl()) {
  return (await requestPath(requestUrlFor(thumbnailUrl))).response;
}

// Matches THUMBNAIL_TIMEOUT_MS in thumbnailEndpointServerHook.ts, which does
// not export it.
const THUMBNAIL_TIMEOUT_MS = 3000;

/**
 * Requests a thumbnail and lets `ms` of fake time pass while the hook waits.
 * Needs `vi.useFakeTimers()`.
 */
async function requestThumbnailPast(ms: number) {
  const response = createResponse();
  const handled = getRegisteredHandler()(
    createRequest(requestUrlFor(publicThumbnailUrl())),
    response,
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(ms);
  await handled;
  return response;
}

/** Refused at validation: no socket opened, counted as blocked and dropped. */
function expectRefusedBeforeFetch(response: ReturnType<typeof createResponse>) {
  expect(response.statusCode).toBe(403);
  expect(pinnedRequestMock).not.toHaveBeenCalled();
  expect(recordThumbnailBlocked).toHaveBeenCalledTimes(1);
  expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
}

/** The generic 502, never cached by the browser, counted as dropped. */
function expectCouldNotFetch(response: ReturnType<typeof createResponse>) {
  expect(response.statusCode).toBe(502);
  expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(response.end).toHaveBeenCalledWith(
    JSON.stringify({ error: "Thumbnail could not be fetched" }),
  );
  expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
}

/** The first load of `url` fails; the second fetches again and succeeds. */
async function expectFailureIsRetried(url: string) {
  const first = await requestThumbnail(url);
  expect(first.statusCode).toBe(502);
  const second = await requestThumbnail(url);
  expect(second.statusCode).toBe(200);
  expect(pinnedRequestMock).toHaveBeenCalledTimes(2);
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
  let logLines: string[];
  let originalLog: typeof debug.log;

  beforeEach(() => {
    vi.clearAllMocks();
    pinnedRequestMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
    logLines = [];
    originalLog = debug.log;
    debug.log = (...args: unknown[]) => {
      logLines.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    debug.log = originalLog;
    vi.restoreAllMocks();
  });

  it("passes through requests that aren't under /thumbnail", async () => {
    const { next } = await requestPath("/status");

    expect(next).toHaveBeenCalled();
    expect(pinnedRequestMock).not.toHaveBeenCalled();
  });

  it.each([
    "/thumbnails",
    "/thumbnailX?token=abc",
    "/thumbnail/extra?token=abc",
  ])("passes through %s, which is not the /thumbnail route", async (url) => {
    const { response, next } = await requestPath(url);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.end).not.toHaveBeenCalled();
    expect(handleTokenVerification).not.toHaveBeenCalled();
    expect(pinnedRequestMock).not.toHaveBeenCalled();
  });

  it("stops processing when token verification fails", async () => {
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: false,
    });

    await requestThumbnail();

    expect(pinnedRequestMock).not.toHaveBeenCalled();
    expect(recordThumbnailRequested).not.toHaveBeenCalled();
  });

  it("responds 400 when the thumbnail URL is missing", async () => {
    const { response } = await requestPath("/thumbnail?token=abc");

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
    const response = await requestThumbnail();

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

    await requestThumbnail();

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

    await requestThumbnail(url);
    await requestThumbnail(url);

    expect(pinnedRequestMock).toHaveBeenCalledTimes(1);
    // Both requests are demand, so both count even though only one fetched.
    expect(recordThumbnailRequested).toHaveBeenCalledTimes(2);
  });

  it("refuses a URL that resolves into a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.5", family: 4 }]);
    const response = await requestThumbnail();

    expectRefusedBeforeFetch(response);
  });

  it("refuses a URL with a non-HTTP scheme", async () => {
    const response = await requestThumbnail("file:///etc/passwd");

    expectRefusedBeforeFetch(response);
  });

  it("refuses a URL longer than the cap", async () => {
    const response = await requestThumbnail(
      `https://thumbs.example.com/${"a".repeat(2050)}`,
    );

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
    const response = await requestThumbnail();

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
    const response = await requestThumbnail();

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
    const response = await requestThumbnail();

    expectCouldNotFetch(response);
  });

  it("logs why a fetch failed, never the thumbnail URL or its host", async () => {
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new Uint8Array(), 403, {}),
    );
    const thumbnailUrl = publicThumbnailUrl();

    await requestThumbnail(thumbnailUrl);

    const output = logLines.join("\n");
    expect(output).toContain("Thumbnail fetch failed: HTTP 403");
    expect(output).not.toContain(new URL(thumbnailUrl).hostname);
  });

  it("answers 502 when the upstream answer is not an accepted image type", async () => {
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new TextEncoder().encode("<html></html>"), 200, {
        "content-type": "text/html",
      }),
    );
    const response = await requestThumbnail();

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
    const response = await requestThumbnail();

    expect(response.statusCode).toBe(502);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect with a malformed Location", async () => {
    pinnedRequestMock.mockResolvedValueOnce(
      fakeIncoming(new Uint8Array(), 302, { location: "http://[" }),
    );
    const response = await requestThumbnail();

    expect(response.statusCode).toBe(502);
    expect(pinnedRequestMock).toHaveBeenCalledTimes(1);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next load retries the upstream", async () => {
    const url = publicThumbnailUrl();
    pinnedRequestMock
      .mockResolvedValueOnce(fakeIncoming(new Uint8Array(), 404, {}))
      .mockResolvedValueOnce(imageResponse());

    await expectFailureIsRetried(url);
  });

  it("answers 502 when the upstream body is empty", async () => {
    pinnedRequestMock.mockResolvedValue(
      fakeIncoming(new Uint8Array(), 200, { "content-type": "image/jpeg" }),
    );
    const response = await requestThumbnail();

    expect(response.statusCode).toBe(502);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("bounds a hanging DNS lookup with the same deadline", async () => {
    // A resolver that never settles must not add its own timeout on top of
    // the documented one.
    lookupMock.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const response = await requestThumbnailPast(THUMBNAIL_TIMEOUT_MS);

      expect(response.statusCode).toBe(502);
      expect(pinnedRequestMock).not.toHaveBeenCalled();
      expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 502 when the host never answers within the timeout", async () => {
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
      const response = await requestThumbnailPast(THUMBNAIL_TIMEOUT_MS);

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
    const response = await requestThumbnail();

    expect(response.statusCode).toBe(502);
    // One request per hop, four hops for three redirects.
    expect(pinnedRequestMock).toHaveBeenCalledTimes(4);
    expect(recordThumbnailDropped).toHaveBeenCalledTimes(1);
  });

  it("answers 502 instead of serving a body over the byte cap cut off", async () => {
    // The cap is 500_000 bytes; the first 500_000 of this body would decode
    // as a damaged image.
    const bigBody = new Uint8Array(600_000).fill(7);
    pinnedRequestMock.mockResolvedValue(imageResponse(bigBody));
    const response = await requestThumbnail();

    expectCouldNotFetch(response);
    expect(logLines.join("\n")).toContain(
      "Thumbnail fetch failed: larger than 500000 bytes",
    );
  });

  it("does not cache a body over the byte cap, so the next load fetches again", async () => {
    const url = publicThumbnailUrl();
    pinnedRequestMock
      .mockResolvedValueOnce(imageResponse(new Uint8Array(600_000).fill(7)))
      .mockResolvedValueOnce(imageResponse());

    await expectFailureIsRetried(url);
  });

  it("serves a body of exactly the byte cap", async () => {
    const capSizedBody = new Uint8Array(500_000).fill(7);
    pinnedRequestMock.mockResolvedValue(imageResponse(capSizedBody));
    const response = await requestThumbnail();

    expect(response.statusCode).toBe(200);
    const body = response.end.mock.calls[0][0] as Buffer;
    expect(body.length).toBe(500_000);
    expect(recordThumbnailDropped).not.toHaveBeenCalled();
  });

  it("evicts the least recently used entry, not the least recently loaded one", async () => {
    // A fresh response per call: a body can only be read once.
    pinnedRequestMock.mockImplementation(async () => imageResponse());
    // A clean slate, so the eviction side is exactly where this test puts it.
    resetThumbnailCache();
    const firstUrl = publicThumbnailUrl();
    const secondUrl = publicThumbnailUrl();
    const maxEntries = getThumbnailCacheLimits().entries;
    const fetched = (url: string) =>
      pinnedRequestMock.mock.calls.filter((call) => String(call[0]) === url)
        .length;

    await requestThumbnail(firstUrl);
    await requestThumbnail(secondUrl);

    // Re-reading firstUrl promotes it, so secondUrl is the eviction candidate.
    await requestThumbnail(firstUrl);

    for (let i = 0; i < maxEntries - 2; i += 1) {
      await requestThumbnail(publicThumbnailUrl());
    }
    // This insert pushes the cache past the cap: exactly one entry is evicted.
    await requestThumbnail(publicThumbnailUrl());

    // firstUrl (promoted by the re-read) survived and serves from the cache.
    // A cache without promote-on-hit would have evicted it, being the oldest
    // load.
    await requestThumbnail(firstUrl);
    expect(fetched(firstUrl)).toBe(1);
    await requestThumbnail(secondUrl);
    expect(fetched(secondUrl)).toBe(2);
  });
});

describe("thumbnailEndpointServerHook with a malformed Host header", () => {
  it("answers 400 instead of 500", async () => {
    vi.mocked(handleTokenVerification).mockClear();
    await expectBadHostRejected(
      getRegisteredHandler(),
      "/thumbnail?u=https%3A%2F%2Fexample.com%2Fa.png&token=abc",
      handleTokenVerification,
    );
  });
});
