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
      wrapperTag={({ children }: { children: React.ReactNode }) => (
        <VStack spacing={40}>{children}</VStack>
      )}
    >
      {searchResults.map(([title, snippet, url], index) => (
        <VStack key={`search-result-${index}`} spacing={16}>
          <Stack
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
          <Text size="md" style={{ color: "rgb(119, 132, 145)" }}>
            {snippet}
          </Text>
        </VStack>
      ))}
    </FadeIn>
  );
}
