import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./searchTokenHash", () => ({
  getSearchTokenHash: vi.fn(),
}));

import { getSearchTokenHash } from "./searchTokenHash";
import { getThumbnailSrc } from "./thumbnailUrls";

describe("getThumbnailSrc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSearchTokenHash).mockResolvedValue("token-hash");
  });

  it("returns null for a result without a thumbnail", async () => {
    expect(await getThumbnailSrc("")).toBeNull();
    expect(getSearchTokenHash).not.toHaveBeenCalled();
  });

  it("uses a cached data URL as is", async () => {
    const dataUrl = "data:image/jpeg;base64,ASDTQW";

    expect(await getThumbnailSrc(dataUrl)).toBe(dataUrl);
    expect(getSearchTokenHash).not.toHaveBeenCalled();
  });

  it("wraps a thumbnail URL in the /thumbnail endpoint with the search token", async () => {
    const src = await getThumbnailSrc("https://thumbs.example.com/a.jpg");

    const url = new URL(src as string);
    expect(url.pathname).toBe("/thumbnail");
    expect(url.searchParams.get("u")).toBe("https://thumbs.example.com/a.jpg");
    expect(url.searchParams.get("token")).toBe("token-hash");
  });

  it("computes the search token hash once and reuses it for the next thumbnail", async () => {
    // A fresh module pair: the token promise is module state, and an earlier
    // test in this file may already have filled it.
    vi.resetModules();
    const freshHash = vi.mocked(
      (await import("./searchTokenHash")).getSearchTokenHash,
    );
    const freshGetThumbnailSrc = (await import("./thumbnailUrls"))
      .getThumbnailSrc;
    freshHash.mockResolvedValue("token-hash");

    await Promise.all([
      freshGetThumbnailSrc("https://thumbs.example.com/a.jpg"),
      freshGetThumbnailSrc("https://thumbs.example.com/b.jpg"),
    ]);

    expect(freshHash).toHaveBeenCalledTimes(1);
  });

  it("retries the token hash after a rejection instead of caching the failure", async () => {
    vi.resetModules();
    const freshHash = vi.mocked(
      (await import("./searchTokenHash")).getSearchTokenHash,
    );
    const freshGetThumbnailSrc = (await import("./thumbnailUrls"))
      .getThumbnailSrc;
    freshHash.mockRejectedValueOnce(new Error("hash wasm down"));
    freshHash.mockResolvedValueOnce("token-hash");

    await expect(
      freshGetThumbnailSrc("https://thumbs.example.com/a.jpg"),
    ).rejects.toThrow("hash wasm down");
    await expect(
      freshGetThumbnailSrc("https://thumbs.example.com/a.jpg"),
    ).resolves.toContain("/thumbnail");

    expect(freshHash).toHaveBeenCalledTimes(2);
  });
});
