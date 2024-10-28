import { Card, Skeleton, Stack, Text } from "@mantine/core";
import { match } from "ts-pattern";

export default function PreparingContent({
  textGenerationState,
}: {
  textGenerationState: string;
}) {
  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>
          {match(textGenerationState)
            .with("awaitingSearchResults", () => "Awaiting search results...")
            .with("preparingToGenerate", () => "Preparing AI response...")
            .otherwise(() => null)}
        </Text>
      </Card.Section>
      <Card.Section withBorder inheritPadding py="md">
        <Stack>
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="70%" radius="xl" />
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="43%" radius="xl" />
        </Stack>
      </Card.Section>
    </Card>
  );
}
