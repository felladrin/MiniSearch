/**
 * Represents a chat message with role and content
 */
export type ChatMessage = {
  /** Role of the message sender */
  role: "system" | "user" | "assistant";
  /** Content of the message */
  content: string;
};
/**
 * Represents a text search result tuple
 */
export type TextSearchResult = [title: string, snippet: string, url: string];
/**
 * Represents an image search result tuple
 */
export type ImageSearchResult = [
  title: string,
  url: string,
  thumbnailUrl: string,
  sourceUrl: string,
];

/**
 * Array of text search results
 */
export type TextSearchResults = TextSearchResult[];
/**
 * Array of image search results
 */
export type ImageSearchResults = ImageSearchResult[];

/**
 * Possible states for search operations
 */
export type SearchState = "idle" | "running" | "failed" | "completed";

/**
 * Combined search results containing both text and image results
 */
export type SearchResults = {
  /** Array of text search results */
  textResults: TextSearchResult[];
  /** Array of image search results */
  imageResults: ImageSearchResult[];
};

/**
 * Possible states for text generation operations
 */
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
