import { describe, expect, it } from "vitest";
import { getImageIdentity } from "./imageIdentity";

describe("getImageIdentity", () => {
  const page = "https://example.com/gallery";

  it("identifies an image by its full-size source", () => {
    expect(
      getImageIdentity(
        "https://cdn.example.com/a.gif",
        "https://cdn.example.com/a-thumb.gif",
        page,
      ),
    ).toBe("https://cdn.example.com/a.gif");
  });

  it("tells two images on one page apart", () => {
    expect(
      getImageIdentity("https://cdn.example.com/a.gif", "", page),
    ).not.toBe(getImageIdentity("https://cdn.example.com/b.gif", "", page));
  });

  it("falls back to the thumbnail when there is no source", () => {
    expect(
      getImageIdentity("", "https://cdn.example.com/a-thumb.gif", page),
    ).toBe("https://cdn.example.com/a-thumb.gif");
    expect(
      getImageIdentity(undefined, "https://cdn.example.com/a-thumb.gif", page),
    ).toBe("https://cdn.example.com/a-thumb.gif");
  });

  it("falls back to the page when there is neither", () => {
    expect(getImageIdentity("", "", page)).toBe(page);
    expect(getImageIdentity(undefined, undefined, page)).toBe(page);
  });
});
