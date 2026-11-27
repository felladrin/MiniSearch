import { MantineProvider } from "@mantine/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imageSearchResultsPubSub,
  imageSearchStatePubSub,
} from "@/modules/pubSub";
import type { ImageSearchResult } from "@/modules/types";
import ImageSearchResults from "./ImageSearchResults";

vi.mock("./ImageResultsList", () => ({
  default: ({ imageResults }: { imageResults: ImageSearchResult[] }) => (
    <ul aria-label="Image results">
      {imageResults.map(([title]) => (
        <li key={title}>{title}</li>
      ))}
    </ul>
  ),
}));

const [setImageSearchState] = imageSearchStatePubSub;
const [setImageSearchResults] = imageSearchResultsPubSub;

const followUpImage: ImageSearchResult = [
  "Follow-up image",
  "https://example.com/follow-up",
  "https://example.com/follow-up.jpg",
  "https://source.example.com/follow-up",
];

function renderImageSearchResults() {
  return render(
    <MantineProvider>
      <ImageSearchResults />
    </MantineProvider>,
  );
}

afterEach(() => {
  act(() => {
    setImageSearchState("idle");
    setImageSearchResults([]);
  });
});

describe("ImageSearchResults", () => {
  it("shows a follow-up's images after the first image search failed", () => {
    setImageSearchState("failed");
    renderImageSearchResults();
    expect(screen.getByText("Failed to search for images")).toBeInTheDocument();

    act(() => setImageSearchResults([followUpImage]));

    expect(screen.getByText("Follow-up image")).toBeInTheDocument();
    expect(
      screen.queryByText("Failed to search for images"),
    ).not.toBeInTheDocument();
  });

  it("keeps the failure alert when no images were added", () => {
    setImageSearchState("failed");
    renderImageSearchResults();

    expect(screen.getByText("Failed to search for images")).toBeInTheDocument();
    expect(screen.queryByLabelText("Image results")).not.toBeInTheDocument();
  });
});
