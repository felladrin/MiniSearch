import { Card, Group, Progress, Stack, Text } from "@mantine/core";

export default function LoadingModelContent({
  modelLoadingProgress,
  modelSizeInMegabytes,
}: {
  modelLoadingProgress: number;
  modelSizeInMegabytes: number;
}) {
  const isLoadingStarting = modelLoadingProgress === 0;
  const isLoadingComplete = modelLoadingProgress === 100;
  const percent =
    isLoadingComplete || isLoadingStarting ? 100 : modelLoadingProgress;
  const strokeColor = percent === 100 ? "#52c41a" : "#3385ff";
  const downloadedSize = (modelSizeInMegabytes * modelLoadingProgress) / 100;
  const sizeText = `${downloadedSize.toFixed(0)} MB / ${modelSizeInMegabytes.toFixed(0)} MB`;

  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>Loading AI...</Text>
      </Card.Section>
      <Card.Section withBorder inheritPadding py="md">
        <Stack gap="xs">
          <Progress color={strokeColor} value={percent} animated />
          {!isLoadingStarting && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {sizeText}
              </Text>
              <Text size="sm" c="dimmed">
                {percent.toFixed(1)}%
              </Text>
            </Group>
          )}
        </Stack>
      </Card.Section>
    </Card>
  );
}
