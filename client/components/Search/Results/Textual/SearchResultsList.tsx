import {
  Flex,
  Stack,
  Text,
  Tooltip,
  Transition,
  UnstyledButton,
  em,
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
