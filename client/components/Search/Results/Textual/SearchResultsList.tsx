import {
  Box,
  em,
  Flex,
  Stack,
  Text,
  Tooltip,
  Transition,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { addLogEntry } from "../../../../modules/logEntries";
import { getHostname } from "../../../../modules/stringFormatters";
import type { TextSearchResult } from "../../../../modules/types";

export default function SearchResultsList({
  searchResults,
}: {
  searchResults: TextSearchResult[];
}) {
  const shouldDisplayDomainBelowTitle = useMediaQuery(
    `(max-width: ${em(720)})`,
  );
  const [canStartTransition, setCanStartTransition] = useState(false);

  useEffect(() => {
    setCanStartTransition(true);
  }, []);

  return (
    <Stack gap={40}>
      {searchResults.map(([title, snippet, url], index) => (
        <Transition
          key={url}
          mounted={canStartTransition}
          transition="fade"
          timingFunction="ease"
          enterDelay={index * 200}
          duration={750}
        >
          {(styles) => (
            <Stack gap={16} style={styles}>
              <Flex
                gap={shouldDisplayDomainBelowTitle ? 0 : 16}
                align="flex-start"
                direction={shouldDisplayDomainBelowTitle ? "column" : "row"}
              >
                <Box
                  w={shouldDisplayDomainBelowTitle ? "100%" : "auto"}
                  flex={shouldDisplayDomainBelowTitle ? 0 : 1}
                  style={{ overflow: "hidden" }}
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
                    <Text
                      fw="bold"
                      c="var(--mantine-color-blue-light-color)"
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {title}
                    </Text>
                  </UnstyledButton>
                </Box>
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
              <Text size="sm" c="dimmed" style={{ wordWrap: "break-word" }}>
                {snippet}
              </Text>
            </Stack>
          )}
        </Transition>
      ))}
    </Stack>
  );
}
