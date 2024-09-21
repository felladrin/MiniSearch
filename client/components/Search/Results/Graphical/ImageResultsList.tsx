import { Carousel } from "@mantine/carousel";
import { SearchResults } from "../../../../modules/search";
import { ImageResult } from "./ImageResult";
import { useState, useEffect } from "react";
import { Transition } from "@mantine/core";

export function ImageResultsList({
  imageResults,
}: {
  imageResults: SearchResults["imageResults"];
}) {
  const [isMounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <Carousel slideSize="0" slideGap="xs" align="start" dragFree loop>
      {imageResults.map(([title, url, thumbnailUrl, sourceUrl], index) => (
        <Transition
          key={index}
          mounted={isMounted}
          transition="fade"
          timingFunction="ease"
          enterDelay={index * 250}
          duration={1500}
        >
          {(styles) => (
            <Carousel.Slide style={styles}>
              <ImageResult
                title={title}
                url={url}
                thumbnailUrl={thumbnailUrl}
                sourceUrl={sourceUrl}
              />
            </Carousel.Slide>
          )}
        </Transition>
      ))}
    </Carousel>
  );
}
