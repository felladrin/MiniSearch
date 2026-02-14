import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.stubGlobal("VITE_ACCESS_KEY_TIMEOUT_HOURS", 24);

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
    it("should return true for valid access key", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ valid: true }),
      });

      const result = await validateAccessKey("test-key-123");
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should return false for invalid access key", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ valid: false }),
      });

      const result = await validateAccessKey("invalid-key");
      expect(result).toBe(false);
    });

    it("should return false on network error", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await validateAccessKey("test-key");
      expect(result).toBe(false);
    });

    it("should return false when response is not ok", async () => {
      const { validateAccessKey } = await import("./accessKey");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await validateAccessKey("test-key");
      expect(result).toBe(false);
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
      const result = await verifyStoredAccessKey();
      expect(result).toBe(true);
    });

    it("should return false when no key is stored", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");

      const result = await verifyStoredAccessKey();
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
      const result = await verifyStoredAccessKey();
      expect(result).toBe(false);
    });

    it("should return false when stored key is expired", async () => {
      const { verifyStoredAccessKey } = await import("./accessKey");
      const expiredTimestamp = Date.now() - 25 * 60 * 60 * 1000;
      localStorage.setItem(
        "accessKeyHash",
        JSON.stringify({ hash: "old-hash", timestamp: expiredTimestamp }),
      );

      const result = await verifyStoredAccessKey();
      expect(result).toBe(false);
    });
  });
});
