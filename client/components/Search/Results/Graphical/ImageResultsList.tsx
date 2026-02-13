import { Carousel } from "@mantine/carousel";
import { Button, Group, rem, Stack, Text, Transition } from "@mantine/core";
import { useEffect, useState } from "react";
import type { ImageSearchResult } from "@/modules/types";
import "@mantine/carousel/styles.css";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import carouselClassNames from "./ImageResultsList.module.css";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import { addLogEntry } from "@/modules/logEntries";
import { getHostname } from "@/modules/stringFormatters";

interface ImageResultsState {
  isLightboxOpen: boolean;
  lightboxIndex: number;
  canStartTransition: boolean;
}

export default function ImageResultsList({
  imageResults,
}: {
  imageResults: ImageSearchResult[];
}) {
  const [state, setState] = useState<ImageResultsState>({
    isLightboxOpen: false,
    lightboxIndex: 0,
    canStartTransition: false,
  });

  useEffect(() => {
    setState((prev) => ({ ...prev, canStartTransition: true }));
  }, []);

  const handleImageClick = (index: number) => {
    setState((prev) => ({
      ...prev,
      lightboxIndex: index,
      isLightboxOpen: true,
    }));
  };

  const imageStyle = {
    objectFit: "cover",
    height: rem(180),
    width: rem(240),
    borderRadius: rem(4),
    border: `${rem(2)} solid var(--mantine-color-default-border)`,
    cursor: "zoom-in",
  } as const;

  return (
    <>
      <Carousel
        slideSize="0"
        slideGap="xs"
        classNames={carouselClassNames}
        emblaOptions={{
          align: "start",
          dragFree: true,
          loop: true,
        }}
      >
        {imageResults.map(([title, url, thumbnail], index) => (
          <Transition
            key={url}
            mounted={state.canStartTransition}
            transition="fade"
            timingFunction="ease"
            enterDelay={index * 250}
            duration={1500}
          >
            {(styles) => (
              <Carousel.Slide style={styles}>
                <img
                  alt={title}
                  src={thumbnail}
                  loading="lazy"
                  onClick={() => handleImageClick(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleImageClick(index);
                    }
                  }}
                  style={imageStyle}
                />
              </Carousel.Slide>
            )}
          </Transition>
        ))}
      </Carousel>
      <Lightbox
        open={state.isLightboxOpen}
        close={() => setState((prev) => ({ ...prev, isLightboxOpen: false }))}
        plugins={[Captions]}
        index={state.lightboxIndex}
        slides={imageResults.map(([title, url, thumbnail, sourceUrl]) => ({
          src: thumbnail,
          alt: title,
          description: (
            <Stack align="center" gap="md">
              {title && (
                <Text component="cite" ta="center">
                  {title}
                </Text>
              )}
              {sourceUrl && (
                <Text size="xs" c="dimmed">
                  Source: {new URL(sourceUrl).hostname}
                </Text>
              )}
              <Group align="center" justify="center" gap="xs">
                <Button
                  variant="subtle"
                  component="a"
                  size="xs"
                  href={sourceUrl}
                  target="_blank"
                  title="Click to see the image in full size"
                  rel="noopener noreferrer"
                  onClick={() => {
                    addLogEntry("User visited an image result in full size");
                  }}
                >
                  View in full resolution
                </Button>
                <Button
                  variant="subtle"
                  component="a"
                  href={url}
                  target="_blank"
                  size="xs"
                  title="Click to visit the page where the image was found"
                  rel="noopener noreferrer"
                  onClick={() => {
                    addLogEntry("User visited an image result source");
                  }}
                >
                  Visit {getHostname(url)}
                </Button>
              </Group>
            </Stack>
          ),
        }))}
      />
    </>
  );
}
