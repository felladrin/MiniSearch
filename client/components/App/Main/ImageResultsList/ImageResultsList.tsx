import { Box, Group, ScrollArea } from "@mantine/core";
import { SearchResults } from "../../../../modules/search";
import FadeIn from "react-fade-in";
import { ImageResult } from "./ImageResult";

export function ImageResultsList({
  imageResults,
}: {
  imageResults: SearchResults["imageResults"];
}) {
  return (
    <ScrollArea w={"100%"} scrollbars="x">
      <Box w={imageResults.length * 136} my="sm">
        <FadeIn delay={150} transitionDuration={1500} wrapperTag={Group}>
          {imageResults.map(([title, url, thumbnailUrl, sourceUrl]) => (
            <ImageResult
              key={sourceUrl}
              title={title}
              url={url}
              thumbnailUrl={thumbnailUrl}
              sourceUrl={sourceUrl}
            />
          ))}
        </FadeIn>
      </Box>
    </ScrollArea>
  );
}
