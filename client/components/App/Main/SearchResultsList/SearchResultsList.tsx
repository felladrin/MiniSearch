import { SearchResults } from "../../../../modules/search";
import {
  Whisper,
  Tooltip,
  Stack,
  Button,
  Text,
  useMediaQuery,
  VStack,
} from "rsuite";
import FadeIn from "react-fade-in";
import { getHostname } from "../../../../modules/stringFormatters";
import { ReactNode } from "react";
import { addLogEntry } from "../../../../modules/logEntries";

export function SearchResultsList({
  searchResults,
}: {
  searchResults: SearchResults["textResults"];
}) {
  const [shouldDisplayDomainBelowTitle] = useMediaQuery("(max-width: 720px)");

  return (
    <FadeIn
      delay={200}
      transitionDuration={750}
      wrapperTag={({ children }: { children: ReactNode }) => (
        <VStack spacing={40}>{children}</VStack>
      )}
    >
      {searchResults.map(([title, snippet, url]) => (
        <Stack
          key={url}
          direction="column"
          spacing={16}
          style={{ width: "100%" }}
        >
          <Stack.Item style={{ width: "100%" }}>
            <Stack
              spacing={shouldDisplayDomainBelowTitle ? 0 : 16}
              justifyContent="space-between"
              alignItems="flex-start"
              direction={shouldDisplayDomainBelowTitle ? "column" : "row"}
              style={{ width: "100%" }}
            >
              <Button
                appearance="link"
                href={url}
                target="_blank"
                style={{
                  textWrap: "wrap",
                  padding: 0,
                  textAlign: "left",
                  fontWeight: "bold",
                }}
                onClick={() => {
                  addLogEntry("User clicked a text result");
                }}
              >
                {title}
              </Button>
              <Whisper
                placement="top"
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
                    {getHostname(url)}
                  </Text>
                </Button>
              </Whisper>
            </Stack>
          </Stack.Item>
          <Stack.Item style={{ width: "100%" }}>
            <Text size="md" style={{ color: "rgb(119, 132, 145)" }}>
              {snippet}
            </Text>
          </Stack.Item>
        </Stack>
      ))}
    </FadeIn>
  );
}
