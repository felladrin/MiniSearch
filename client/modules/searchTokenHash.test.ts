import { argon2Verify } from "hash-wasm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetLastSearchTokenHash = vi.fn();
const mockUpdateLastSearchTokenHash = vi.fn();

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("./pubSub", () => ({
  getLastSearchTokenHash: () => mockGetLastSearchTokenHash(),
  updateLastSearchTokenHash: (hash: string) =>
    mockUpdateLastSearchTokenHash(hash),
}));

const searchToken = "a".repeat(64);

vi.mock("./config", () => ({
  getConfig: () => Promise.resolve({ searchToken }),
}));

/** Digest length in bytes, read from the trailing field of the encoded hash. */
function getDigestLength(encodedHash: string) {
  const digest = encodedHash.split("$").pop() as string;
  return atob(digest.replace(/-/g, "+").replace(/_/g, "/")).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLastSearchTokenHash.mockReturnValue("");
});

describe("getSearchTokenHash", () => {
  it("should produce a hash the server can verify against the search token", async () => {
    const { getSearchTokenHash } = await import("./searchTokenHash");

    const hash = await getSearchTokenHash();

    // Mirrors the server-side check in verifyTokenAndRateLimit.ts
    await expect(argon2Verify({ password: searchToken, hash })).resolves.toBe(
      true,
    );
    await expect(
      argon2Verify({ password: "b".repeat(64), hash }),
    ).resolves.toBe(false);
    expect(mockUpdateLastSearchTokenHash).toHaveBeenCalledWith(hash);
  });

  it("should use a digest long enough to resist blind forgery", async () => {
    const { getSearchTokenHash } = await import("./searchTokenHash");

    const hash = await getSearchTokenHash();

    expect(getDigestLength(hash)).toBe(32);
  });

  it("should reuse a cached hash that still matches the search token", async () => {
    const { getSearchTokenHash } = await import("./searchTokenHash");

    const cachedHash = await getSearchTokenHash();
    mockGetLastSearchTokenHash.mockReturnValue(cachedHash);
    mockUpdateLastSearchTokenHash.mockClear();

    expect(await getSearchTokenHash()).toBe(cachedHash);
    expect(mockUpdateLastSearchTokenHash).not.toHaveBeenCalled();
  });

  it("should generate a fresh hash when the cached one is from another token", async () => {
    const { getSearchTokenHash } = await import("./searchTokenHash");

    mockGetLastSearchTokenHash.mockReturnValue(
      "$argon2id$v=19$m=512,t=16,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000",
    );

    const hash = await getSearchTokenHash();

    await expect(argon2Verify({ password: searchToken, hash })).resolves.toBe(
      true,
    );
    expect(mockUpdateLastSearchTokenHash).toHaveBeenCalledWith(hash);
  });
});
