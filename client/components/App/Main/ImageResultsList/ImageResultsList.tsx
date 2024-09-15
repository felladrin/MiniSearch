import { Carousel } from "@mantine/carousel";
import { SearchResults } from "../../../../modules/search";
import { ImageResult } from "./ImageResult";

export function ImageResultsList({
  imageResults,
}: {
  imageResults: SearchResults["imageResults"];
}) {
  return (
    <Carousel slideSize="0" slideGap="xs" align="start" dragFree loop>
      {imageResults.map(([title, url, thumbnailUrl, sourceUrl]) => (
        <Carousel.Slide>
          <ImageResult
            key={sourceUrl}
            title={title}
            url={url}
            thumbnailUrl={thumbnailUrl}
            sourceUrl={sourceUrl}
          />
        </Carousel.Slide>
      ))}
    </Carousel>
  );
}
