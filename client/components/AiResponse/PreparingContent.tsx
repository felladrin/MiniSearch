import { Card, Skeleton, Stack, Text } from "@mantine/core";

export default function PreparingContent({
  textGenerationState,
}: {
  textGenerationState: string;
}) {
  const getStateText = () => {
    if (textGenerationState === "awaitingSearchResults") {
      return "Awaiting search results...";
    }
    if (textGenerationState === "preparingToGenerate") {
      return "Preparing AI response...";
    }
    return null;
  };

  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>{getStateText()}</Text>
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
