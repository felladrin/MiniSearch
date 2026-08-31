import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThumbnailSrc } from "@/modules/thumbnailUrls";
import type { ImageSearchResult } from "@/modules/types";
import { setReducedMotionPreference } from "../testUtils";
import ImageResultsList from "./ImageResultsList";

vi.mock("@/modules/thumbnailUrls", () => ({
  getThumbnailSrc: vi.fn(),
}));

// Mirrors the real module's contract closely enough for the component: an
// empty thumbnail yields null, everything else comes back as a /thumbnail URL.
function thumbnailSrcFor(thumbnailUrl: string): string | null {
  if (!thumbnailUrl) return null;
  const url = new URL("/thumbnail", "http://localhost:3000");
  url.searchParams.set("u", thumbnailUrl);
  return url.toString();
}

beforeEach(() => {
  vi.mocked(getThumbnailSrc).mockImplementation(async (thumbnailUrl) =>
    thumbnailUrl ? thumbnailSrcFor(thumbnailUrl) : null,
  );
});

afterEach(() => {
  setReducedMotionPreference(false);
  vi.clearAllMocks();
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

  it("loads each tile from the /thumbnail endpoint once the src resolves", async () => {
    renderImageResultsList();

    // Both tiles resolve, so the query must allow a match on either.
    const [img] = await screen.findAllByRole("img");
    expect(getThumbnailSrc).toHaveBeenCalledWith(
      "https://example.com/first.jpg",
    );
    expect(img.getAttribute("src")).toBe(
      thumbnailSrcFor("https://example.com/first.jpg"),
    );
  });

  it("shows the host name for a result without a thumbnail", async () => {
    render(
      <MantineProvider>
        <ImageResultsList
          imageResults={[
            [
              "No thumbnail",
              "https://example.com/no-thumbnail",
              "",
              "https://source.example.com/no-thumbnail",
            ],
          ]}
        />
      </MantineProvider>,
    );

    await screen.findByText("example.com");
  });

  it("shows the host name when a thumbnail fails to load", async () => {
    renderImageResultsList();

    const [img] = await screen.findAllByRole("img");
    img.dispatchEvent(new Event("error"));

    // The second tile still loads, so exactly one img survives the failure.
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(
      screen.getByRole("button", { name: "Open image preview: First image" }),
    ).toHaveTextContent("example.com");
  });

  it("shows the host-name placeholder in the lightbox when the thumbnail failed", async () => {
    const user = userEvent.setup();
    renderImageResultsList();

    const [img] = await screen.findAllByRole("img");
    img.dispatchEvent(new Event("error"));
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));

    await user.click(
      screen.getByRole("button", { name: "Open image preview: First image" }),
    );

    const dialog = await screen.findByRole("dialog");
    const slideImage = dialog.querySelector(".yarl__slide_current img");
    const src = slideImage?.getAttribute("src") ?? "";
    expect(src).toContain("data:image/svg+xml");
    expect(src).toContain("example.com");
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
