import { SearchResults } from "../modules/search";
import { Tooltip } from "react-tooltip";
import { useAutoAnimate } from "@formkit/auto-animate/react";
export function SearchResultsList({
  searchResults,
  urlsDescriptions,
}: {
  searchResults: SearchResults;
  urlsDescriptions: Record<string, string>;
}) {
  const [parent] = useAutoAnimate({ duration: 1000 });

  return (
    <ul ref={parent}>
      {searchResults.map(([title, snippet, url], index) => (
        <li key={url}>
          <Tooltip
            id={`search-result-${index}`}
            place="top-start"
            variant="info"
            opacity="1"
            style={{ width: "75vw", maxWidth: "600px" }}
          >
            {snippet}
            <br />
            <br />
            {url}
          </Tooltip>
          <a
            href={url}
            data-tooltip-id={`search-result-${index}`}
            target="_blank"
          >
            {title}
          </a>
          {urlsDescriptions[url] && (
            <>
              <br />
              <blockquote>{urlsDescriptions[url]}</blockquote>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
