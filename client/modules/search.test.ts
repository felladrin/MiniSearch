import { describe, expect, it } from "vitest";
import { searchServiceInstance } from "./search";

describe("search cache key generation", () => {
  it("should generate different cache keys for different queries", async () => {
    const query1 = "test query";
    const query2 = "different query";

    const hash1 = await searchServiceInstance.hashQuery(query1);
    const hash2 = await searchServiceInstance.hashQuery(query2);

    expect(hash1).not.toBe(hash2);
    expect(hash1).toBeDefined();
    expect(hash2).toBeDefined();
  });

  it("should generate different cache keys for same query with different limits", async () => {
    const query = "test query";
    const limit1 = 5;
    const limit2 = 10;

    const hash1 = await searchServiceInstance.hashQuery(query, limit1);
    const hash2 = await searchServiceInstance.hashQuery(query, limit2);

    expect(hash1).not.toBe(hash2);
    expect(hash1).toBeDefined();
    expect(hash2).toBeDefined();
  });

  it("should generate same cache key for same query and limit", async () => {
    const query = "test query";
    const limit = 5;

    const hash1 = await searchServiceInstance.hashQuery(query, limit);
    const hash2 = await searchServiceInstance.hashQuery(query, limit);

    expect(hash1).toBe(hash2);
  });

  it("should generate different cache key when limit is omitted vs when it's provided", async () => {
    const query = "test query";

    const hash1 = await searchServiceInstance.hashQuery(query);
    const hash2 = await searchServiceInstance.hashQuery(query, undefined);

    expect(hash1).toBe(hash2);
  });

  it("should generate valid hex strings", async () => {
    const query = "test query";
    const hash = await searchServiceInstance.hashQuery(query);

    // SHA-256 should produce a 64-character hex string
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
