import { MantineProvider } from "@mantine/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  textSearchResultsPubSub,
  textSearchStalePubSub,
  textSearchStatePubSub,
  textSearchTimeFilterPubSub,
} from "@/modules/pubSub";
import type { TextSearchResults as TextSearchResultList } from "@/modules/types";
import TextSearchResults from "./TextSearchResults";

vi.mock("./SearchResultsList", () => ({
  default: ({ searchResults }: { searchResults: string[][] }) => (
    <ul aria-label="Text results">
      {searchResults.map(([title]) => (
        <li key={title}>{title}</li>
      ))}
    </ul>
  ),
}));

const [setTextSearchState] = textSearchStatePubSub;
const [setTextSearchResults] = textSearchResultsPubSub;
const [setTextSearchStale] = textSearchStalePubSub;
const [setTextSearchTimeFilterNotApplied] = textSearchTimeFilterPubSub;

const results: TextSearchResultList = [
  ["A result", "Its snippet", "https://example.com"],
];

const NOTE = "Time filter not applied to these results";

function renderTextSearchResults() {
  return render(
    <MantineProvider>
      <TextSearchResults />
    </MantineProvider>,
  );
}

beforeEach(() => {
  act(() => {
    setTextSearchState("completed");
    setTextSearchResults(results);
  });
});

afterEach(() => {
  act(() => {
    setTextSearchState("idle");
    setTextSearchResults([]);
    setTextSearchStale(false);
    setTextSearchTimeFilterNotApplied(false);
  });
});

describe("TextSearchResults", () => {
  it("says when the results carry no time filter although one was asked for", () => {
    act(() => setTextSearchTimeFilterNotApplied(true));
    renderTextSearchResults();

    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByLabelText("Text results")).toBeInTheDocument();
  });

  it("says nothing when the time filter was applied", () => {
    renderTextSearchResults();

    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("says nothing when there are no results to put the note over", () => {
    act(() => {
      setTextSearchResults([]);
      setTextSearchTimeFilterNotApplied(true);
    });
    renderTextSearchResults();

    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});
