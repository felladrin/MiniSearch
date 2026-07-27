import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ImageSearchResult } from "@/modules/types";
import ImageResultsList from "./ImageResultsList";

const imageResults: ImageSearchResult[] = [
  [
    "First image",
    "https://example.com/first",
    "https://example.com/first.jpg",
    "https://source.example.com/first",
  ],
  [
    "Second image",
    "https://example.com/second",
    "https://example.com/second.jpg",
    "https://source.example.com/second",
  ],
];

function renderImageResultsList() {
  return render(
    <MantineProvider>
      <ImageResultsList imageResults={imageResults} />
    </MantineProvider>,
  );
}

describe("ImageResultsList", () => {
  it("renders thumbnails as named buttons", async () => {
    renderImageResultsList();

    expect(
      await screen.findByRole("button", {
        name: "Open image preview: First image",
      }),
    ).toBeInTheDocument();
  });

  it("opens the focused thumbnail in the lightbox from the keyboard", async () => {
    const user = userEvent.setup();
    renderImageResultsList();

    const [firstThumbnail, secondThumbnail] = await Promise.all([
      screen.findByRole("button", { name: "Open image preview: First image" }),
      screen.findByRole("button", { name: "Open image preview: Second image" }),
    ]);

    await user.tab();
    expect(firstThumbnail).toHaveFocus();

    await user.tab();
    expect(secondThumbnail).toHaveFocus();

    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    // The lightbox keeps neighbouring slides mounted, so the alt text of every
    // result is queryable. Only the current slide identifies what the user sees.
    expect(
      dialog.querySelector(".yarl__slide_current img")?.getAttribute("alt"),
    ).toBe("Second image");
  });
});
