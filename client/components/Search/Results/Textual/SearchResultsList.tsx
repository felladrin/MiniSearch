import { Stack, Text, UnstyledButton } from "@mantine/core";
import { memo } from "react";
import { addLogEntry } from "@/modules/logEntries";
import { getHostname } from "@/modules/stringFormatters";
import type { TextSearchResult } from "@/modules/types";
import classes from "./SearchResultsList.module.css";

const ResultRow = memo(function ResultRow({
  title,
  snippet,
  url,
}: {
  title: string;
  snippet: string;
  url: string;
}) {
  return (
    <div className={classes.row} data-testid="search-result-row">
      <UnstyledButton
        variant="transparent"
        component="a"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="search-result-link"
        onClick={() => {
          addLogEntry("User clicked a text result");
        }}
        className={classes.titleLink}
      >
        <Text fw={600} className={classes.title}>
          {title}
        </Text>
      </UnstyledButton>
      <Text size="xs" c="dimmed" className={classes.domain}>
        {getHostname(url)}
      </Text>
      <Text size="sm" c="dimmed" className={classes.snippet}>
        {snippet}
      </Text>
    </div>
  );
});

export default function SearchResultsList({
  searchResults,
}: {
  searchResults: TextSearchResult[];
}) {
  return (
    <Stack gap="md">
      {searchResults.map(([title, snippet, url]) => (
        <ResultRow key={url} title={title} snippet={snippet} url={url} />
      ))}
    </Stack>
  );
}
