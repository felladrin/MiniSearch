import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockChmodSync = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
}));

vi.mock("temp-dir", () => ({ default: "/tmp" }));

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockChmodSync.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchToken", () => {
  it("should read existing token file when it exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("existing-token-123");

    const { getSearchToken } = await import("./searchToken");
    const token = getSearchToken();

    expect(token).toBe("existing-token-123");
    expect(mockExistsSync).toHaveBeenCalled();
    expect(mockReadFileSync).toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("should generate a new token when file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockReturnValue(undefined);

    const { getSearchToken } = await import("./searchToken");

    // First call — file doesn't exist, should regenerate
    getSearchToken();
    expect(mockWriteFileSync).toHaveBeenCalled();

    // Now file exists
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("new-token-456");

    const token2 = getSearchToken();
    expect(token2).toBe("new-token-456");
  });

  it("regenerateSearchToken should draw the token from a cryptographic source", async () => {
    mockWriteFileSync.mockReturnValue(undefined);
    const mathRandomSpy = vi.spyOn(Math, "random");

    const { regenerateSearchToken } = await import("./searchToken");
    regenerateSearchToken();
    regenerateSearchToken();

    const [firstToken, secondToken] = mockWriteFileSync.mock.calls.map(
      (call) => call[1] as string,
    );

    expect(mathRandomSpy).not.toHaveBeenCalled();
    // 32 random bytes, hex-encoded
    expect(firstToken).toMatch(/^[0-9a-f]{64}$/);
    expect(firstToken).not.toBe(secondToken);
  });

  it("regenerateSearchToken should restrict the token file to its owner", async () => {
    mockWriteFileSync.mockReturnValue(undefined);
    mockChmodSync.mockReturnValue(undefined);

    const { regenerateSearchToken } = await import("./searchToken");
    regenerateSearchToken();

    const [filePath, , options] = mockWriteFileSync.mock.calls[0];
    expect(options).toEqual({ mode: 0o600 });
    // A file left behind by an earlier build keeps its old permissions,
    // which `mode` alone would not correct.
    expect(mockChmodSync).toHaveBeenCalledWith(filePath, 0o600);
  });
});
