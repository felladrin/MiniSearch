import { SearchResults } from "../../../../modules/search";
import { Tooltip, Stack, Text, Flex, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import FadeIn from "react-fade-in";
import { getHostname } from "../../../../modules/stringFormatters";
import { ReactNode } from "react";
import { addLogEntry } from "../../../../modules/logEntries";

export function SearchResultsList({
  searchResults,
}: {
  searchResults: SearchResults["textResults"];
}) {
  const shouldDisplayDomainBelowTitle = useMediaQuery("(max-width: 720px)");

  return (
    <FadeIn
      delay={200}
      transitionDuration={750}
      wrapperTag={({ children }: { children: ReactNode }) => (
        <Stack gap={40}>{children}</Stack>
      )}
    >
      {searchResults.map(([title, snippet, url]) => (
        <Stack key={url} gap={16}>
          <Flex
            gap={shouldDisplayDomainBelowTitle ? 0 : 16}
            justify="space-between"
            align="flex-start"
            direction={shouldDisplayDomainBelowTitle ? "column" : "row"}
          >
            <UnstyledButton
              variant="transparent"
              component="a"
              href={url}
              target="_blank"
              onClick={() => {
                addLogEntry("User clicked a text result");
              }}
            >
              <Text fw="bold" c="var(--mantine-color-blue-light-color)">
                {title}
              </Text>
            </UnstyledButton>
            <Tooltip label={url}>
              <UnstyledButton
                variant="transparent"
                component="a"
                href={url}
                target="_blank"
                fs="italic"
                onClick={() => {
                  addLogEntry("User clicked a text result");
                }}
              >
                {getHostname(url)}
              </UnstyledButton>
            </Tooltip>
          </Flex>
          <Text size="sm" c="dimmed">
            {snippet}
          </Text>
        </Stack>
      ))}
    </FadeIn>
  );
}
