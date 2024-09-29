import { Card, Progress, Text } from "@mantine/core";

export default function LoadingModelContent({
  modelLoadingProgress,
}: {
  modelLoadingProgress: number;
}) {
  const isLoadingComplete =
    modelLoadingProgress === 100 || modelLoadingProgress === 0;
  const percent = isLoadingComplete ? 100 : modelLoadingProgress;
  const strokeColor = isLoadingComplete ? "#52c41a" : "#3385ff";

  return (
    <Card withBorder shadow="sm" radius="md">
      <Card.Section withBorder inheritPadding py="xs">
        <Text fw={500}>Loading AI...</Text>
      </Card.Section>
      <Card.Section withBorder inheritPadding py="md">
        <Progress color={strokeColor} value={percent} animated />
      </Card.Section>
    </Card>
  );
}
