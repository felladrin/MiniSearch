import { describe, expect, it, vi } from "vitest";

/**
 * The counters are module state with no reset, so each test loads a fresh copy
 * of the module instead of untangling what an earlier test left behind.
 */
async function freshCounters() {
  vi.resetModules();
  return await import("./authorizationSinceLastRestart.ts");
}

describe("classifyRejectedClient", () => {
  it.each([
    ["curl/8.5.0 (x86_64-pc-linux-gnu)", "curl"],
    ["Wget/1.21", "wget"],
    ["python-requests/2.32.3", "python"],
    ["node", "node"],
    ["axios/1.7.2", "node"],
    ["undici", "node"],
    ["Java/21.0.4", "java"],
    ["okhttp/4.12.0", "java"],
    ["go-http-client/2.0", "go"],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      "browser",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "browser",
    ],
    [
      "Mozilla/5.0 (compatible; DataForBot/1.0; +https://dataforbot.com)",
      "bot",
    ],
    ["Googlebot/2.1 (+http://www.google.com/bot.html)", "bot"],
    ["Scrapy/2.11 (+https://scrapy.org)", "bot"],
    [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "bot",
    ],
    ["Java-http-client/21.0.4", "java"],
    ["", "other"],
    [undefined, "other"],
  ] as const)(
    "sorts a %s client into the published %s label",
    async (userAgent, kind) => {
      // The labels themselves are the published vocabulary, pinned by
      // `handleTokenVerification.test.ts`. A row here only checks that a client
      // reaches the label it already has.
      const { classifyRejectedClient } = await freshCounters();
      expect(classifyRejectedClient(userAgent)).toBe(kind);
    },
  );
});

describe("rejectedByClient", () => {
  it("counts rejections per client kind", async () => {
    const { recordRejectedRequest, getAuthorizationStats } =
      await freshCounters();

    recordRejectedRequest("search", "invalidToken", "curl/8.5.0");
    recordRejectedRequest("search", "invalidToken", "curl/8.5.0");
    recordRejectedRequest(
      "search",
      "invalidToken",
      "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0",
    );

    const { rejectedByClient } = getAuthorizationStats();
    expect(rejectedByClient.curl).toBe(2);
    expect(rejectedByClient.browser).toBe(1);
  });

  it("counts a crawler that presents a browser string as a crawler", async () => {
    const { recordRejectedRequest, getAuthorizationStats } =
      await freshCounters();

    recordRejectedRequest(
      "search",
      "invalidToken",
      "Mozilla/5.0 (compatible; GrabberBot/2.0)",
    );

    const { rejectedByClient } = getAuthorizationStats();
    expect(rejectedByClient.bot).toBe(1);
    expect(rejectedByClient.browser).toBe(0);
  });

  it("names no client for a request the limiter stopped", async () => {
    const { recordRejectedRequest, getAuthorizationStats } =
      await freshCounters();

    recordRejectedRequest("thumbnail", "rateLimited", "curl/8.5.0");

    const { rejectedByClient } = getAuthorizationStats();
    expect(rejectedByClient.curl).toBe(0);
    expect(rejectedByClient.other).toBe(0);
  });

  it("counts a request that sent no User-Agent as other", async () => {
    const { recordRejectedRequest, getAuthorizationStats } =
      await freshCounters();

    recordRejectedRequest("thumbnail", "missingToken");

    expect(getAuthorizationStats().rejectedByClient.other).toBe(1);
  });

  it("accounts for every token rejection across the client kinds", async () => {
    const { recordRejectedRequest, getAuthorizationStats } =
      await freshCounters();

    recordRejectedRequest("search", "invalidToken", "curl/8.5.0");
    recordRejectedRequest("search", "missingToken");
    recordRejectedRequest(
      "pageContent",
      "invalidToken",
      "python-requests/2.32",
    );
    recordRejectedRequest("inference", "rateLimited", "Mozilla/5.0 (X11)");

    const stats = getAuthorizationStats();
    const byClient = Object.values(stats.rejectedByClient).reduce(
      (total, count) => total + count,
      0,
    );
    expect(byClient).toBe(
      stats.reasons.missingToken + stats.reasons.invalidToken,
    );
  });

  it("names no client for a request it accepted", async () => {
    const { recordAuthorizedRequest, getAuthorizationStats } =
      await freshCounters();

    recordAuthorizedRequest("search");

    const { rejectedByClient } = getAuthorizationStats();
    expect(Object.values(rejectedByClient).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("classifyRejectedFetchSite", () => {
  it.each([
    ["same-origin", "sameOrigin"],
    ["Same-Origin", "other"],
    ["same-site", "sameSite"],
    ["cross-site", "crossSite"],
    ["none", "none"],
    [undefined, "missing"],
    ["", "missing"],
    ["unknown", "other"],
    ["same-origin, cross-site", "other"],
  ] as const)("sorts a %s header into %s", async (secFetchSite, label) => {
    const { classifyRejectedFetchSite } = await freshCounters();
    expect(classifyRejectedFetchSite(secFetchSite)).toBe(label);
  });
});

describe("rejectedByFetchSite", () => {
  it("counts token rejections per Sec-Fetch-Site label and excludes rate-limited requests", async () => {
    const {
      recordAuthorizedRequest,
      recordRejectedRequest,
      getAuthorizationStats,
    } = await freshCounters();

    recordAuthorizedRequest("search");
    recordRejectedRequest("thumbnail", "rateLimited", undefined, "same-origin");
    recordRejectedRequest(
      "search",
      "invalidToken",
      "Mozilla/5.0",
      "same-origin",
    );
    recordRejectedRequest("search", "missingToken", "curl/8.5.0");
    recordRejectedRequest(
      "pageContent",
      "invalidToken",
      undefined,
      "cross-site",
    );
    recordRejectedRequest("inference", "invalidToken", undefined, "unexpected");

    const stats = getAuthorizationStats();
    expect(stats.rejectedByFetchSite).toEqual({
      sameOrigin: 1,
      sameSite: 0,
      crossSite: 1,
      none: 0,
      missing: 1,
      other: 1,
    });
    const byFetchSite = Object.values(stats.rejectedByFetchSite).reduce(
      (total, count) => total + count,
      0,
    );
    expect(byFetchSite).toBe(
      stats.reasons.missingToken + stats.reasons.invalidToken,
    );
  });
});
