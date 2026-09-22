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
  // The module holds the token for the life of the process, so every test
  // needs its own copy of it.
  vi.resetModules();
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
  it("should generate a fresh token instead of adopting one already in the file", async () => {
    // The published image used to ship a token in the temp directory, and a
    // container that read it shared one token with every other container built
    // from that image, and with anyone who pulled the image and read the layer.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("token-baked-into-the-image");

    const { getSearchToken } = await import("./searchToken");
    const token = getSearchToken();

    expect(token).not.toBe("token-baked-into-the-image");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(token).toBe(mockWriteFileSync.mock.calls[0][1]);
  });

  it("should keep the token it generated when the file changes", async () => {
    const { getSearchToken } = await import("./searchToken");

    const firstToken = getSearchToken();

    // Another process rewriting the file must not re-key this one: the clients
    // already holding the old token have no way of being told about a new one.
    mockReadFileSync.mockReturnValue("token-from-another-process");

    expect(getSearchToken()).toBe(firstToken);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it("should serve the new token after regenerating it", async () => {
    const { getSearchToken, regenerateSearchToken } = await import(
      "./searchToken"
    );

    const firstToken = getSearchToken();
    regenerateSearchToken();

    expect(getSearchToken()).not.toBe(firstToken);
    expect(getSearchToken()).toBe(
      mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1][1],
    );
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

describe("hasSearchTokenFileChanged", () => {
  it("should be false before a token has been read", async () => {
    const { hasSearchTokenFileChanged } = await import("./searchToken");

    expect(hasSearchTokenFileChanged()).toBe(false);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("should be false while the file still holds this process's token", async () => {
    const { getSearchToken, hasSearchTokenFileChanged } = await import(
      "./searchToken"
    );

    const token = getSearchToken();
    mockReadFileSync.mockReturnValue(token);

    expect(hasSearchTokenFileChanged()).toBe(false);
  });

  it("should be true once another process rewrites the file", async () => {
    const { getSearchToken, hasSearchTokenFileChanged } = await import(
      "./searchToken"
    );

    getSearchToken();
    mockReadFileSync.mockReturnValue("token-from-another-process");

    expect(hasSearchTokenFileChanged()).toBe(true);
  });

  it("should be true when the file is gone", async () => {
    const { getSearchToken, hasSearchTokenFileChanged } = await import(
      "./searchToken"
    );

    getSearchToken();
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(hasSearchTokenFileChanged()).toBe(true);
  });
});
