import { MantineProvider } from "@mantine/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  textSearchLanguagePubSub,
  textSearchResultsPubSub,
  textSearchStalePubSub,
  textSearchStatePubSub,
  textSearchTimeFilterPubSub,
  textSearchUnitConversionPubSub,
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
const [setTextSearchLanguageNotApplied] = textSearchLanguagePubSub;
const [setTextSearchUnitConversion] = textSearchUnitConversionPubSub;

const results: TextSearchResultList = [
  ["A result", "Its snippet", "https://example.com"],
];

const NOTE = "Time filter not applied to these results";
const LANGUAGE_NOTE = "Language not applied to these results";
const BOTH_NOTE = "Time filter and language not applied to these results";
const CONVERSION = "16.4041994751 ft";
const NO_RESULTS = "No results found";

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
    setTextSearchLanguageNotApplied(false);
    setTextSearchUnitConversion(null);
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

  it("says when the results carry no language although one was asked for", () => {
    act(() => setTextSearchLanguageNotApplied(true));
    renderTextSearchResults();

    expect(screen.getByText(LANGUAGE_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("names both filters when neither was applied", () => {
    act(() => {
      setTextSearchTimeFilterNotApplied(true);
      setTextSearchLanguageNotApplied(true);
    });
    renderTextSearchResults();

    expect(screen.getByText(BOTH_NOTE)).toBeInTheDocument();
    // One note for both, not two notes for the same outage.
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.queryByText(LANGUAGE_NOTE)).not.toBeInTheDocument();
  });

  it("shows the conversion the search came back with above the results", () => {
    act(() => setTextSearchUnitConversion(CONVERSION));
    renderTextSearchResults();

    expect(screen.getByText("Unit conversion")).toBeInTheDocument();
    expect(screen.getByText(CONVERSION)).toBeInTheDocument();
    expect(screen.getByLabelText("Text results")).toBeInTheDocument();
  });

  it("shows the conversion on its own when the search found no results", () => {
    act(() => {
      setTextSearchResults([]);
      setTextSearchUnitConversion(CONVERSION);
    });
    renderTextSearchResults();

    expect(screen.getByText(CONVERSION)).toBeInTheDocument();
    // The conversion is the answer, so the empty-results alert contradicts it.
    expect(screen.queryByText(NO_RESULTS)).not.toBeInTheDocument();
  });

  it("shows no card when the search carried no conversion", () => {
    renderTextSearchResults();

    expect(screen.queryByText("Unit conversion")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Text results")).toBeInTheDocument();
  });

  it("shows no card and the empty-results alert with neither a conversion nor results", () => {
    act(() => setTextSearchResults([]));
    renderTextSearchResults();

    expect(screen.queryByText("Unit conversion")).not.toBeInTheDocument();
    expect(screen.getByText(NO_RESULTS)).toBeInTheDocument();
  });

  it("renders a conversion as text, never as markup", () => {
    act(() => setTextSearchUnitConversion('<img src=x onerror="alert(1)">'));
    renderTextSearchResults();

    expect(
      screen.getByText('<img src=x onerror="alert(1)">'),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
