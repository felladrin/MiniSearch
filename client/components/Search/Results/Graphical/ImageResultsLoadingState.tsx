import { AspectRatio, em, Group, Skeleton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

export default function ImageResultsLoadingState() {
  const hasSmallScreen = useMediaQuery(`(max-width: ${em(530)})`);
  const numberOfSquareSkeletons = hasSmallScreen ? 4 : 6;
  const skeletonIds = Array.from(
    { length: numberOfSquareSkeletons },
    (_, i) => `skeleton-${i}`,
  );

  return (
    <Group>
      {skeletonIds.map((id) => (
        <AspectRatio key={id} ratio={1} flex={1}>
          <Skeleton />
        </AspectRatio>
      ))}
    </Group>
  );
}
