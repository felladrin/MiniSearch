import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTokenVerification } from "./handleTokenVerification";
import { getRequestAuthorizationStats } from "./rejectionsSinceLastRestart";
import {
  RATE_LIMIT_DURATION_SECONDS,
  RATE_LIMIT_POINTS,
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

function makeRequest(url: string) {
  return { url } as IncomingMessage;
}

/** Every count the assertions below compare against, flattened for readability. */
function counts() {
  const stats = getRequestAuthorizationStats();
  return {
    requests: stats.requests,
    authorized: stats.authorized,
    ...stats.reasons,
    surfaces: stats.bySurface,
  };
}

async function verify(url: string, result: TokenVerificationResult) {
  verifyMock.mockResolvedValue(result);
  const response = makeResponse();
  const outcome = await handleTokenVerification(
    "token",
    response,
    makeRequest(url),
  );
  return { response, ...outcome };
}

describe("handleTokenVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts an authorized request and lets it through", async () => {
    const before = counts();

    const { shouldContinue, response } = await verify("/search/text", {
      isAuthorized: true,
    });

    expect(shouldContinue).toBe(true);
    expect(response.end).not.toHaveBeenCalled();
    expect(counts().authorized).toBe(before.authorized + 1);
    expect(counts().requests).toBe(before.requests + 1);
  });

  it.each([
    ["/search/text", "search"],
    ["/search/images", "search"],
    ["/page-content", "pageContent"],
    ["/inference", "inference"],
    ["/something-else", "other"],
  ] as const)(
    "counts a rejected %s request under the %s surface",
    async (url, surface) => {
      const before = counts();

      const { shouldContinue, response } = await verify(
        url,
        REJECTIONS.invalidToken,
      );

      expect(shouldContinue).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(response.end).toHaveBeenCalledWith(
        JSON.stringify({ error: "Invalid token." }),
      );
      expect(counts().surfaces[surface]).toBe(before.surfaces[surface] + 1);
      expect(counts().authorized).toBe(before.authorized);
    },
  );

  it.each(["rateLimited", "missingToken", "invalidToken"] as const)(
    "counts a %s rejection under its own reason",
    async (reason) => {
      const before = counts();

      await verify("/search/text", REJECTIONS[reason]);

      expect(counts()[reason]).toBe(before[reason] + 1);
    },
  );

  it("keeps the totals closed across a mixed run", async () => {
    await verify("/search/text", { isAuthorized: true });
    await verify("/page-content", REJECTIONS.rateLimited);
    await verify("/inference", REJECTIONS.missingToken);
    await verify("/whatever", REJECTIONS.invalidToken);

    const stats = getRequestAuthorizationStats();
    const rejected = Object.values(stats.reasons).reduce(
      (total, count) => total + count,
      0,
    );
    const perSurface = Object.values(stats.bySurface).reduce(
      (total, count) => total + count,
      0,
    );

    expect(stats.authorized + rejected).toBe(stats.requests);
    expect(perSurface).toBe(rejected);
  });

  it("reports the limiter's settings alongside the counts", async () => {
    await verify("/search/text", REJECTIONS.rateLimited);

    expect(getRequestAuthorizationStats().limiter).toEqual({
      points: RATE_LIMIT_POINTS,
      durationSeconds: RATE_LIMIT_DURATION_SECONDS,
    });
  });

  it("exposes nothing that could identify a client", async () => {
    await verify("/search/text?q=borogoves+outgrabe", REJECTIONS.invalidToken);

    const stats = getRequestAuthorizationStats();

    // A per-client or per-query dimension would have to arrive as a new key,
    // so pinning the shape is what keeps one from being added by accident.
    expect(Object.keys(stats).sort()).toEqual([
      "authorized",
      "bySurface",
      "limiter",
      "reasons",
      "rejectedRate",
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
    ]);
    expect(JSON.stringify(stats)).not.toContain("borogoves");
  });

  it("answers with a snapshot that later requests do not mutate", async () => {
    const snapshot = getRequestAuthorizationStats();
    const rateLimitedBefore = snapshot.reasons.rateLimited;

    await verify("/search/text", REJECTIONS.rateLimited);

    expect(snapshot.reasons.rateLimited).toBe(rateLimitedBefore);
    expect(getRequestAuthorizationStats().reasons.rateLimited).toBe(
      rateLimitedBefore + 1,
    );
  });
});
