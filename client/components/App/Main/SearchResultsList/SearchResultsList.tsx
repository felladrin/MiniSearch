import { SearchResults } from "../../../../modules/search";
import {
  Tooltip,
  Stack,
  Text,
  Flex,
  UnstyledButton,
  Transition,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { getHostname } from "../../../../modules/stringFormatters";
import { addLogEntry } from "../../../../modules/logEntries";
import { useEffect, useState } from "react";

export function SearchResultsList({
  searchResults,
}: {
  searchResults: SearchResults["textResults"];
}) {
  const shouldDisplayDomainBelowTitle = useMediaQuery("(max-width: 720px)");
  const [isMounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <Stack gap={40}>
      {searchResults.map(([title, snippet, url], index) => (
        <Transition
          key={url}
          mounted={isMounted}
          transition="fade"
          timingFunction="ease"
          enterDelay={index * 200}
          duration={750}
        >
          {(styles) => (
            <Stack gap={16} style={styles}>
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
                    ta="end"
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
          )}
        </Transition>
      ))}
    </Stack>
  );
}
