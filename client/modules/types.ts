export type TextSearchResult = [title: string, snippet: string, url: string];
export type ImageSearchResult = [
  title: string,
  url: string,
  thumbnailUrl: string,
  sourceUrl: string,
];

export type TextSearchResults = TextSearchResult[];
export type ImageSearchResults = ImageSearchResult[];

export type SearchState = "idle" | "running" | "failed" | "completed";

export type SearchResults = {
  textResults: TextSearchResult[];
  imageResults: ImageSearchResult[];
};

export type TextGenerationState =
  | "idle"
  | "awaitingModelDownloadAllowance"
  | "loadingModel"
  | "awaitingSearchResults"
  | "preparingToGenerate"
  | "generating"
  | "interrupted"
  | "failed"
  | "completed";
