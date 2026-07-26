import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CSSProperties, ReactNode } from "react";
import type { ImageSearchResult } from "@/modules/types";
import ImageResultsList from "./ImageResultsList";

vi.mock("@mantine/carousel", () => {
  const Carousel = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  Carousel.Slide = ({
    children,
    style,
  }: {
    children: ReactNode;
    style?: CSSProperties;
  }) => <div style={style}>{children}</div>;

  return { Carousel };
});

vi.mock("yet-another-react-lightbox", () => ({
  default: ({
    index,
    open,
    slides,
  }: {
    index: number;
    open: boolean;
    slides: { alt?: string }[];
  }) =>
    open ? (
      <div role="dialog" aria-label={slides[index]?.alt ?? "Image preview"} />
    ) : null,
}));

vi.mock("yet-another-react-lightbox/plugins/captions", () => ({
  default: {},
}));

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

  it("opens the lightbox from the keyboard", async () => {
    const user = userEvent.setup();
    renderImageResultsList();

    const firstThumbnail = await screen.findByRole("button", {
      name: "Open image preview: First image",
    });
    firstThumbnail.focus();
    expect(firstThumbnail).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("dialog", { name: "First image" }),
    ).toBeInTheDocument();
  });
});
