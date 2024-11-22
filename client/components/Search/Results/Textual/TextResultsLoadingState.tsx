import { Skeleton, Stack } from "@mantine/core";

export default function TextResultsLoadingState() {
  return (
    <Stack>
      <Stack>
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="87%" radius="xl" />
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="70%" radius="xl" />
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="52%" radius="xl" />
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="63%" radius="xl" />
      </Stack>
    </Stack>
  );
}
