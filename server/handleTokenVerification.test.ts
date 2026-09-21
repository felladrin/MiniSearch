import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthorizationStats } from "./authorizationSinceLastRestart";
import { handleTokenVerification } from "./handleTokenVerification";
import {
  type TokenVerificationResult,
  verifyTokenAndRateLimit,
} from "./verifyTokenAndRateLimit";

vi.mock("./verifyTokenAndRateLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./verifyTokenAndRateLimit")>();
  return { ...actual, verifyTokenAndRateLimit: vi.fn() };
});

const verifyMock = vi.mocked(verifyTokenAndRateLimit);

const REJECTIONS: Record<string, TokenVerificationResult> = {
  rateLimited: {
    isAuthorized: false,
    statusCode: 429,
    error: "Too many requests.",
    reason: "rateLimited",
  },
  missingToken: {
    isAuthorized: false,
    statusCode: 400,
    error: "Missing token.",
    reason: "missingToken",
  },
  invalidToken: {
    isAuthorized: false,
    statusCode: 401,
    error: "Invalid token.",
    reason: "invalidToken",
  },
};

function makeResponse() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> };
}

async function verify(
  url: string,
  result: TokenVerificationResult,
  request: { headers?: Record<string, string>; token?: string } = {},
) {
  verifyMock.mockResolvedValue(result);
  const response = makeResponse();
  const outcome = await handleTokenVerification(
    request.token ?? "token",
    response,
    { url, headers: request.headers ?? {} } as IncomingMessage,
  );
  return { response, ...outcome };
}

/** What a browser sends when the address bar or a bookmark opens a URL. */
const BROWSER_NAVIGATION_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

function bodyOf(response: ReturnType<typeof makeResponse>): string {
  return response.end.mock.calls[0][0];
}

function contentTypeOf(response: ReturnType<typeof makeResponse>): string {
  const calls = vi.mocked(response.setHeader).mock.calls;
  const contentType = calls.find(([name]) => name === "Content-Type");
  return contentType ? String(contentType[1]) : "";
}

/**
 * The payload is integers all the way down. A per-client dimension would have
 * to arrive either as a new key or as a leaf that stopped being a number, so
 * checking both is what keeps one from being added by accident.
 */
function expectNumbersAllTheWayDown(value: unknown, path: string): void {
  if (typeof value === "number") return;
  expect(value, `${path} is neither a number nor an object`).toBeTypeOf(
    "object",
  );
  for (const [key, child] of Object.entries(value as object)) {
    expectNumbersAllTheWayDown(child, `${path}.${key}`);
  }
}

describe("handleTokenVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts an authorized request under its surface and lets it through", async () => {
    const before = getAuthorizationStats();

    const { shouldContinue, response } = await verify("/inference", {
      isAuthorized: true,
    });

    expect(shouldContinue).toBe(true);
    expect(response.end).not.toHaveBeenCalled();

    const after = getAuthorizationStats();
    expect(after.authorized).toBe(before.authorized + 1);
    expect(after.bySurface.inference.authorized).toBe(
      before.bySurface.inference.authorized + 1,
    );
  });

  it.each([
    ["/search/text", "search"],
    ["/search/images", "search"],
    ["/page-content", "pageContent"],
    ["/thumbnail", "thumbnail"],
    ["/inference", "inference"],
    ["/something-else", "other"],
  ] as const)(
    "counts a rejected %s request under the %s surface",
    async (url, surface) => {
      const before = getAuthorizationStats();

      const { shouldContinue, response } = await verify(
        url,
        REJECTIONS.invalidToken,
      );

      expect(shouldContinue).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({ error: "Invalid token." }),
      );

      const after = getAuthorizationStats();
      expect(after.bySurface[surface].rejected).toBe(
        before.bySurface[surface].rejected + 1,
      );
      expect(after.authorized).toBe(before.authorized);
    },
  );

  it.each(["rateLimited", "missingToken", "invalidToken"] as const)(
    "counts a %s rejection under its own reason",
    async (reason) => {
      const before = getAuthorizationStats();

      await verify("/search/text", REJECTIONS[reason]);

      expect(getAuthorizationStats().reasons[reason]).toBe(
        before.reasons[reason] + 1,
      );
    },
  );

  it("keeps the totals closed across a mixed run", async () => {
    const before = getAuthorizationStats();

    await verify("/search/text", { isAuthorized: true });
    await verify("/page-content", REJECTIONS.rateLimited);
    await verify("/inference", REJECTIONS.missingToken);
    await verify("/whatever", REJECTIONS.invalidToken);

    const stats = getAuthorizationStats();
    const total = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0);
    const perSurface = Object.values(stats.bySurface);
    const rejected = total(Object.values(stats.reasons));

    expect(stats.requests).toBe(before.requests + 4);
    expect(stats.authorized + rejected).toBe(stats.requests);
    expect(total(perSurface.map((counts) => counts.rejected))).toBe(rejected);
    expect(total(perSurface.map((counts) => counts.authorized))).toBe(
      stats.authorized,
    );
  });

  it("reports the limiter's settings alongside the counts", async () => {
    await verify("/search/text", REJECTIONS.rateLimited);

    // The literals rather than the imported constants: a moved limit has to
    // fail here, so that whoever moves it also revisits `docs/overview.md`.
    expect(getAuthorizationStats().limiter).toEqual({
      points: 10,
      durationSeconds: 10,
      thumbnail: {
        points: 60,
        durationSeconds: 10,
      },
    });
  });

  it("exposes nothing that could identify a client", async () => {
    await verify("/search/text?q=borogoves+outgrabe", REJECTIONS.invalidToken);

    const stats = getAuthorizationStats();

    expect(Object.keys(stats).sort()).toEqual([
      "authorized",
      "bySurface",
      "limiter",
      "reasons",
      "rejectedRate",
      "rejectedTokenCacheHits",
      "requests",
    ]);
    expect(Object.keys(stats.reasons).sort()).toEqual([
      "invalidToken",
      "missingToken",
      "rateLimited",
    ]);
    expect(Object.keys(stats.bySurface).sort()).toEqual([
      "inference",
      "other",
      "pageContent",
      "search",
      "thumbnail",
    ]);
    expect(Object.keys(stats.limiter).sort()).toEqual([
      "durationSeconds",
      "points",
      "thumbnail",
    ]);
    expectNumbersAllTheWayDown(stats, "authorization");
    expect(JSON.stringify(stats)).not.toContain("borogoves");
  });

  it("answers with a snapshot that later requests do not mutate", async () => {
    const snapshot = getAuthorizationStats();
    const rateLimitedBefore = snapshot.reasons.rateLimited;
    const searchRejectedBefore = snapshot.bySurface.search.rejected;

    await verify("/search/text", REJECTIONS.rateLimited);

    expect(snapshot.reasons.rateLimited).toBe(rateLimitedBefore);
    expect(snapshot.bySurface.search.rejected).toBe(searchRejectedBefore);
    expect(getAuthorizationStats().reasons.rateLimited).toBe(
      rateLimitedBefore + 1,
    );
  });

  describe("when the request looks like a browser navigation", () => {
    it("answers an invalid token with a page a person can read", async () => {
      const { shouldContinue, response } = await verify(
        "/search/text?q=hello&token=stale",
        REJECTIONS.invalidToken,
        { headers: { accept: BROWSER_NAVIGATION_ACCEPT } },
      );

      expect(shouldContinue).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(contentTypeOf(response)).toBe("text/html; charset=utf-8");

      const body = bodyOf(response);
      expect(body.startsWith("<!doctype html>")).toBe(true);
      expect(body).toContain("rotated its search token");
      expect(body).toContain("stops working");
      expect(body).toContain('href="/"');
      expect(body).not.toContain("<script");
    });

    it("answers a missing token the same way, keeping its own status", async () => {
      const { response } = await verify(
        "/search/text?q=hello",
        REJECTIONS.missingToken,
        { headers: { accept: BROWSER_NAVIGATION_ACCEPT } },
      );

      expect(response.statusCode).toBe(400);
      expect(contentTypeOf(response)).toBe("text/html; charset=utf-8");
      expect(bodyOf(response)).toContain('href="/"');
    });

    it("keeps the JSON body for a rate-limited request", async () => {
      const { response } = await verify(
        "/search/text",
        REJECTIONS.rateLimited,
        { headers: { accept: BROWSER_NAVIGATION_ACCEPT } },
      );

      expect(response.statusCode).toBe(429);
      expect(contentTypeOf(response)).toBe("application/json");
      expect(bodyOf(response)).toBe(
        JSON.stringify({ error: "Too many requests." }),
      );
    });

    it("is decided by an Accept header that names text/html", async () => {
      for (const accept of [
        "text/html",
        "TEXT/HTML",
        "text/html; charset=utf-8",
        "application/json, text/html;q=0.5",
      ]) {
        const { response } = await verify(
          "/search/text",
          REJECTIONS.invalidToken,
          { headers: { accept } },
        );

        expect(contentTypeOf(response), accept).toBe(
          "text/html; charset=utf-8",
        );
      }
    });

    it("carries no token, sets no cookie and redirects nowhere", async () => {
      const { response } = await verify(
        "/search/text?q=hello&token=stale",
        REJECTIONS.invalidToken,
        { headers: { accept: BROWSER_NAVIGATION_ACCEPT }, token: "stale" },
      );

      const headerNames = vi
        .mocked(response.setHeader)
        .mock.calls.map(([name]) => String(name).toLowerCase());
      expect(headerNames).toEqual(["content-type"]);
      expect(response.statusCode).toBe(401);
      expect(bodyOf(response)).not.toContain("token=");
      expect(bodyOf(response)).not.toContain("stale");
    });

    it("echoes nothing from the request", async () => {
      const marker = "borogoves";
      const { response: first } = await verify(
        `/search/text?q=${marker}&token=${marker}`,
        REJECTIONS.invalidToken,
        {
          headers: {
            accept: `text/html;${marker}=1`,
            referer: `https://${marker}.example/`,
          },
          token: marker,
        },
      );
      const { response: second } = await verify(
        "/page-content",
        REJECTIONS.missingToken,
        { headers: { accept: "text/html" } },
      );

      expect(bodyOf(first)).not.toContain(marker);
      expect(bodyOf(first)).toBe(bodyOf(second));
    });

    it("counts the rejection the same way as the JSON answer", async () => {
      const before = getAuthorizationStats();

      await verify("/search/text", REJECTIONS.invalidToken, {
        headers: { accept: BROWSER_NAVIGATION_ACCEPT },
      });

      const after = getAuthorizationStats();
      expect(after.requests).toBe(before.requests + 1);
      expect(after.authorized).toBe(before.authorized);
      expect(after.reasons.invalidToken).toBe(before.reasons.invalidToken + 1);
      expect(after.bySurface.search.rejected).toBe(
        before.bySurface.search.rejected + 1,
      );
    });
  });

  describe("when the request does not look like a browser navigation", () => {
    it.each([
      ["no Accept header", undefined],
      ["Accept: */*", "*/*"],
      ["Accept: application/json", "application/json"],
      ["an Accept list without text/html", "application/json, text/plain, */*"],
      ["text/html refused with q=0", "text/html;q=0, application/json"],
      ["text/* only", "text/*"],
    ])("keeps the JSON body byte for byte with %s", async (_, accept) => {
      const { shouldContinue, response } = await verify(
        "/search/text",
        REJECTIONS.invalidToken,
        { headers: accept === undefined ? {} : { accept } },
      );

      expect(shouldContinue).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
      expect(bodyOf(response)).toBe(
        JSON.stringify({ error: "Invalid token." }),
      );
    });
  });
});
