import { describe, expect, it } from "vitest";
import { imageResultKey } from "./imageResultKey";

describe("imageResultKey", () => {
  const page = "https://example.com/gallery";

  it("identifies an image by its full-size source", () => {
    expect(
      imageResultKey([
        "Photo",
        page,
        "https://cdn.example.com/photo-thumb.jpg",
        "https://cdn.example.com/photo.jpg",
      ]),
    ).toBe("https://cdn.example.com/photo.jpg");
  });

  it("falls back to the thumbnail when the image has no source", () => {
    expect(
      imageResultKey(["Photo", page, "https://cdn.example.com/thumb.jpg", ""]),
    ).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("falls back to the page when the image has neither", () => {
    expect(imageResultKey(["Photo", page, "", ""])).toBe(page);
  });
});
