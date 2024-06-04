import { useEffect, useState } from "react";
import { SearchResults } from "../modules/search";
import { Tooltip } from "react-tooltip";

export function SearchResultsList({
  searchResults,
  urlsDescriptions,
}: {
  searchResults: SearchResults;
  urlsDescriptions: Record<string, string>;
}) {
  const [windowWidth, setWindowWidth] = useState(self.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(self.innerWidth);
    };

    self.addEventListener("resize", handleResize);

    return () => {
      self.removeEventListener("resize", handleResize);
    };
  }, []);

  const shouldDisplayDomainBelowTitle = windowWidth < 720;

  return (
    <ul>
      {searchResults.map(([title, , url], index) => (
        <li key={url}>
          <Tooltip
            id={`search-result-${index}`}
            place="top-start"
            variant="info"
            opacity="1"
          >
            {url}
          </Tooltip>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: shouldDisplayDomainBelowTitle ? 0 : "1rem",
              flexDirection: shouldDisplayDomainBelowTitle ? "column" : "row",
            }}
          >
            <a
              href={url}
              target="_blank"
              data-tooltip-id={`search-result-${index}`}
            >
              {title}
            </a>
            <a
              href={url}
              target="_blank"
              data-tooltip-id={`search-result-${index}`}
            >
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
