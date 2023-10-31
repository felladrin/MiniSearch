import Markdown from "markdown-to-jsx";
import { SearchResults, searchQueryKey } from "../modules/search";
import { getDisableAiResponseSetting } from "../modules/pubSub";
import { SearchResultsList } from "./SearchResultsList";
import { Tooltip } from "react-tooltip";

export function ResponseView({
  prompt,
  response,
  searchResults,
  urlsDescriptions,
}: {
  prompt: string;
  response: string;
  searchResults: SearchResults;
  urlsDescriptions: Record<string, string>;
}) {
  return (
    <>
      <Tooltip
        id="query-tooltip"
        place="bottom-start"
        variant="info"
        opacity="1"
        float
      />
      <blockquote
        style={{ cursor: "pointer" }}
        onClick={() => {
          localStorage.setItem(searchQueryKey, prompt);
          window.location.href = window.location.origin;
        }}
        data-tooltip-id="query-tooltip"
        data-tooltip-content="Click to edit the query"
      >
        <Markdown>{prompt}</Markdown>
      </blockquote>
      {!getDisableAiResponseSetting() && (
        <>
          <div>
            <Markdown>{response}</Markdown>
          </div>
          <hr />
        </>
      )}
      <div>
        {searchResults.length > 0 ? (
          <SearchResultsList
            searchResults={searchResults}
            urlsDescriptions={urlsDescriptions}
          />
        ) : (
          "Searching the Web..."
        )}
      </div>
    </>
  );
}
