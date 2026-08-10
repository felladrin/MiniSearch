import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ImageSearchResult } from "@/modules/types";
import {
  resetReducedMotionPreference,
  setReducedMotionPreference,
} from "../testUtils";
import ImageResultsList from "./ImageResultsList";

afterEach(() => {
  resetReducedMotionPreference();
});

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

const manyImageResults: ImageSearchResult[] = Array.from(
  { length: 6 },
  (_, index) => [
    `Image ${index + 1}`,
    `https://example.com/${index + 1}`,
    `https://example.com/${index + 1}.jpg`,
    `https://source.example.com/${index + 1}`,
  ],
);

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

  it("does not leave later results waiting behind a long stagger", async () => {
    render(
      <MantineProvider>
        <ImageResultsList imageResults={manyImageResults} />
      </MantineProvider>,
    );

    await screen.findByRole("button", {
      name: "Open image preview: Image 6",
    });
  });

  it("skips the animation when reduced motion is preferred", async () => {
    setReducedMotionPreference(true);

    render(
      <MantineProvider>
        <ImageResultsList imageResults={manyImageResults} />
      </MantineProvider>,
    );

    const imageButton = await screen.findByRole("button", {
      name: "Open image preview: Image 6",
    });
    const slideStyle = imageButton
      .closest('[role="group"]')
      ?.getAttribute("style");

    expect(slideStyle ?? "").not.toContain("transition-property");
    expect(slideStyle ?? "").not.toContain("transition-duration");
  });
});
