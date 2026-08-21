import { argon2Verify } from "hash-wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Digest length in bytes, read from the trailing field of the encoded hash. */
function getDigestLength(encodedHash: string) {
  const digest = encodedHash.split("$").pop() as string;
  return atob(digest.replace(/-/g, "+").replace(/_/g, "/")).length;
}

/** Runs a validation and returns the hash that was sent to the server. */
async function getHashSentFor(accessKey: string) {
  const { validateAccessKey } = await import("./accessKey");
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ valid: true }),
  });

  await validateAccessKey(accessKey);

  const [, requestInit] = mockFetch.mock.calls[0];
  return JSON.parse(requestInit.body).accessKeyHash as string;
}

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

const TIMEOUT_HOURS = 24;

describe("Access Key Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("validateAccessKey", () => {
    it("should return valid for a valid access key", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ valid: true }),
      });

      const result = await validateAccessKey("test-key-123");
      expect(result).toBe("valid");
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should return invalid for an invalid access key", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ valid: false }),
      });

      const result = await validateAccessKey("invalid-key");
      expect(result).toBe("invalid");
    });

    it("should return invalid on network error", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await validateAccessKey("test-key");
      expect(result).toBe("invalid");
    });

    it("should send a hash the server can verify against the access key", async () => {
      const hash = await getHashSentFor("test-key-123");

      // Mirrors the server-side check in validateAccessKeyServerHook.ts
      await expect(
        argon2Verify({ password: "test-key-123", hash }),
      ).resolves.toBe(true);
      await expect(
        argon2Verify({ password: "another-key", hash }),
      ).resolves.toBe(false);
    });

    it("should use a digest long enough to resist blind forgery", async () => {
      expect(getDigestLength(await getHashSentFor("test-key-123"))).toBe(32);
    });

    it("should return invalid when response is not ok", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ valid: false }),
      });

      const result = await validateAccessKey("test-key");
      expect(result).toBe("invalid");
    });

    it("treats a 429 as a rate-limited refusal and stores no hash", async () => {
      const { validateAccessKey } = await import("./accessKey");
      const { notifications } = await import("@mantine/notifications");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
      });

      const result = await validateAccessKey("test-key");
      expect(result).toBe("rateLimited");
      expect(localStorage.getItem("accessKeyHash")).toBeNull();
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Too many attempts" }),
      );
    });
  });

  describe("verifyStoredAccessKey", () => {
    it("should return true when stored key is valid", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ valid: true }),
      });

      localStorage.setItem(
        "accessKeyHash",
        JSON.stringify({ hash: "test-hash", timestamp: Date.now() }),
      );
      const result = await verifyStoredAccessKey(TIMEOUT_HOURS);
      expect(result).toBe(true);
    });

    it("should return false when no key is stored", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");

      const result = await verifyStoredAccessKey(TIMEOUT_HOURS);
      expect(result).toBe(false);
    });

    it("should return false when stored key is invalid", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ valid: false }),
      });

      localStorage.setItem(
        "accessKeyHash",
        JSON.stringify({ hash: "invalid-hash", timestamp: Date.now() }),
      );
      const result = await verifyStoredAccessKey(TIMEOUT_HOURS);
      expect(result).toBe(false);
    });

    it("should return false without asking the server when the timeout is zero", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");
      localStorage.setItem(
        "accessKeyHash",
        JSON.stringify({ hash: "test-hash", timestamp: Date.now() }),
      );

      const result = await verifyStoredAccessKey(0);
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return false when stored key is expired", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");
      const expiredTimestamp = Date.now() - 25 * 60 * 60 * 1000;
      localStorage.setItem(
        "accessKeyHash",
        JSON.stringify({ hash: "old-hash", timestamp: expiredTimestamp }),
      );

      const result = await verifyStoredAccessKey(TIMEOUT_HOURS);
      expect(result).toBe(false);
    });

    it("keeps the stored hash on a 429 instead of deleting it", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
      });

      localStorage.setItem(
        "accessKeyHash",
        JSON.stringify({ hash: "test-hash", timestamp: Date.now() }),
      );
      const result = await verifyStoredAccessKey(TIMEOUT_HOURS);

      expect(result).toBe(false);
      // A rate-limited validation must not be read as a wrong key.
      expect(localStorage.getItem("accessKeyHash")).not.toBeNull();
    });
  });
});
