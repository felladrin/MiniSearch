import { useEffect, useState } from "react";
import { SearchResults } from "../modules/search";
import {
  Whisper,
  Tooltip,
  PanelGroup,
  Panel,
  Stack,
  Button,
  Text,
} from "rsuite";

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
    <PanelGroup>
      {searchResults.map(([title, , url], index) => (
        <Panel
          key={`search-result-${index}`}
          header={
            <Stack
              justifyContent="space-between"
              alignItems="flex-start"
              spacing={shouldDisplayDomainBelowTitle ? 0 : "1rem"}
              direction={shouldDisplayDomainBelowTitle ? "column" : "row"}
            >
              <Button
                appearance="link"
                href={url}
                target="_blank"
                style={{
                  textWrap: "wrap",
                  padding: 0,
                  color: "var(--rs-btn-link-text)",
                  textAlign: "left",
                  fontWeight: "bold",
                }}
              >
                {title}
              </Button>
              <Whisper
                placement="top"
                controlId={`search-result-${index}-for-domain`}
                trigger="hover"
                speaker={<Tooltip>{url}</Tooltip>}
              >
                <Button
                  appearance="link"
                  href={url}
                  target="_blank"
                  style={{ padding: 0 }}
                >
                  <Text as="cite" size="md">
                    {new URL(url).hostname.replace("www.", "")}
                  </Text>
                </Button>
              </Whisper>
            </Stack>
          }
        >
          <Text size="md" style={{ color: "rgb(119, 132, 145)" }}>
            {urlsDescriptions[url]}
          </Text>
        </Panel>
      ))}
    </PanelGroup>
  );
}
