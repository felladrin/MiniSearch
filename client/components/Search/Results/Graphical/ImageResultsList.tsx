import { Carousel } from "@mantine/carousel";
import { Button, Group, Stack, Text, Transition, rem } from "@mantine/core";
import { useEffect, useState } from "react";
import type { SearchResults } from "../../../../modules/search";
import "@mantine/carousel/styles.css";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import { addLogEntry } from "../../../../modules/logEntries";
import { getHostname } from "../../../../modules/stringFormatters";

export default function ImageResultsList({
  imageResults,
}: {
  imageResults: SearchResults["imageResults"];
}) {
  const [isLightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [canStartTransition, setCanStartTransition] = useState(false);

  useEffect(() => {
    setCanStartTransition(true);
  }, []);

  const handleImageClick = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
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
      <Carousel slideSize="0" slideGap="xs" align="start" dragFree loop>
        {imageResults.map(([title, sourceUrl, thumbnailUrl], index) => (
          <Transition
            key={`${title}-${sourceUrl}-${thumbnailUrl}`}
            mounted={canStartTransition}
            transition="fade"
            timingFunction="ease"
            enterDelay={index * 250}
            duration={1500}
          >
            {(styles) => (
              <Carousel.Slide style={styles}>
                <img
                  alt={title}
                  src={thumbnailUrl}
                  onClick={() => handleImageClick(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
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
        open={isLightboxOpen}
        close={() => setLightboxOpen(false)}
        plugins={[Captions]}
        index={lightboxIndex}
        slides={imageResults.map(([title, url, thumbnailUrl, sourceUrl]) => ({
          src: thumbnailUrl,
          description: (
            <Stack align="center" gap="md">
              {title && (
                <Text component="cite" ta="center">
                  {title}
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
