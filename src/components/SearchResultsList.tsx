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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <a
              href={url}
              data-tooltip-id={`search-result-${index}`}
              target="_blank"
            >
              {title}
            </a>
            <a href={url} target="_blank">
              <cite
                style={{
                  fontSize: "small",
                  color: "gray",
                  whiteSpace: "nowrap",
                }}
              >
                {new URL(url).hostname.replace("www.", "")}
              </cite>
            </a>
          </div>
          {urlsDescriptions[url] && (
            <blockquote>{urlsDescriptions[url]}</blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}
