import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ImageSearchResult } from "@/modules/types";
import { setReducedMotionPreference } from "../testUtils";
import ImageResultsList from "./ImageResultsList";

afterEach(() => {
  setReducedMotionPreference(false);
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

// Mirrors the default `searchResultsLimit`, so a reintroduced per-index
// stagger pushes the last thumbnail far past the timeouts asserted below.
const manyImageResults: ImageSearchResult[] = Array.from(
  { length: 15 },
  (_, index) => [
    `Image ${index + 1}`,
    `https://example.com/${index + 1}`,
    `https://example.com/${index + 1}.jpg`,
    `https://source.example.com/${index + 1}`,
  ],
);
const lastImageButtonName = "Open image preview: Image 15";

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

    await screen.findByRole("button", { name: lastImageButtonName });
  });

  it("skips the animation when reduced motion is preferred", async () => {
    setReducedMotionPreference(true);

    render(
      <MantineProvider>
        <ImageResultsList imageResults={manyImageResults} />
      </MantineProvider>,
    );

    const imageButton = await screen.findByRole("button", {
      name: lastImageButtonName,
    });
    const slide = imageButton.closest('[role="group"]');

    expect(slide).toBeInTheDocument();
    expect(slide?.getAttribute("style") ?? "").not.toContain("transition");
  });

  it("opens the lightbox when a source URL is protocol-relative", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ImageResultsList
          imageResults={[
            [
              "Protocol-relative image",
              "https://example.com/protocol-relative",
              "https://example.com/protocol-relative.jpg",
              "//cdn.example.com/protocol-relative.jpg",
            ],
          ]}
        />
      </MantineProvider>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Open image preview: Protocol-relative image",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "Source: //cdn.example.com/protocol-relative.jpg",
    );
  });

  it("opens the lightbox when a source URL is relative", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ImageResultsList
          imageResults={[
            [
              "Relative image",
              "https://example.com/relative",
              "https://example.com/relative.jpg",
              "/images/relative.jpg",
            ],
          ]}
        />
      </MantineProvider>,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Open image preview: Relative image",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Source: /images/relative.jpg");
  });
});
