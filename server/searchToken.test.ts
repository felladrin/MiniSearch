import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock("temp-dir", () => ({ default: "/tmp" }));

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
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

  it("regenerateSearchToken should write a new token", async () => {
    mockWriteFileSync.mockReturnValue(undefined);

    const { regenerateSearchToken } = await import("./searchToken");
    regenerateSearchToken();

    expect(mockWriteFileSync).toHaveBeenCalled();
    const writtenToken = mockWriteFileSync.mock.calls[0][1] as string;
    // Token should be a random string (letters and digits, 2+ chars)
    expect(writtenToken.length).toBeGreaterThan(2);
    expect(writtenToken).toMatch(/^[a-z0-9]+$/);
  });
});
