import { Carousel } from "@mantine/carousel";
import {
  Box,
  Button,
  Group,
  rem,
  Skeleton,
  Stack,
  Text,
  Transition,
  UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useEffect, useState } from "react";
import type { ImageSearchResult } from "@/modules/types";
import "@mantine/carousel/styles.css";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import classes from "./ImageResultsList.module.css";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import { addLogEntry } from "@/modules/logEntries";
import { getHostname } from "@/modules/stringFormatters";
import { getThumbnailSrc } from "@/modules/thumbnailUrls";

interface ImageResultsState {
  isLightboxOpen: boolean;
  lightboxIndex: number;
  canStartTransition: boolean;
}

const imageStyle = {
  objectFit: "cover",
  height: rem(180),
  width: rem(240),
  borderRadius: rem(4),
  border: `${rem(2)} solid var(--mantine-color-default-border)`,
} as const;

/** Matches the image box, so a tile keeps its size from skeleton to image. */
const tileBoxStyle = {
  height: rem(180),
  width: rem(240),
  borderRadius: rem(4),
  border: `${rem(2)} solid var(--mantine-color-default-border)`,
} as const;

export default function ImageResultsList({
  imageResults,
}: {
  imageResults: ImageSearchResult[];
}) {
  const shouldReduceMotion = useReducedMotion();
  const [state, setState] = useState<ImageResultsState>({
    isLightboxOpen: false,
    lightboxIndex: 0,
    canStartTransition: false,
  });
  const [thumbnailSrcs, setThumbnailSrcs] = useState<
    Record<string, string | null>
  >({});
  const [failedThumbnails, setFailedThumbnails] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    setState((prev) => ({ ...prev, canStartTransition: true }));
  }, []);

  // The search response carries thumbnail URLs, not bytes, so the grid can
  // show as soon as the results arrive. Each tile then loads on its own from
  // the server's /thumbnail endpoint, and a dead host costs one placeholder
  // tile instead of delaying the whole response.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        imageResults.map(async ([, url, thumbnailUrl]) => {
          try {
            return [url, await getThumbnailSrc(thumbnailUrl)] as const;
          } catch {
            return [url, null] as const;
          }
        }),
      );

      if (!cancelled) {
        setThumbnailSrcs(Object.fromEntries(entries));
        setFailedThumbnails({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageResults]);

  const handleImageClick = (index: number) => {
    setState((prev) => ({
      ...prev,
      lightboxIndex: index,
      isLightboxOpen: true,
    }));
  };

  const markThumbnailFailed = (url: string) => {
    setFailedThumbnails((prev) => ({ ...prev, [url]: true }));
  };

  const renderTile = (title: string, url: string) => {
    const tileSrc = failedThumbnails[url] ? null : thumbnailSrcs[url];

    if (tileSrc) {
      return (
        <img
          alt={title}
          src={tileSrc}
          loading="lazy"
          style={imageStyle}
          onError={() => markThumbnailFailed(url)}
        />
      );
    }

    // `null` means the result has no thumbnail, or the load failed: the host
    // name is the most that can be shown. `undefined` means the src is still
    // being resolved, so the tile keeps a skeleton in the meantime.
    if (thumbnailSrcs[url] === undefined) {
      return (
        <Box style={tileBoxStyle}>
          <Skeleton style={{ height: "100%", width: "100%" }} />
        </Box>
      );
    }

    return (
      <Box
        style={{
          ...tileBoxStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text size="xs" c="dimmed" truncate>
          {getHostname(url)}
        </Text>
      </Box>
    );
  };

  return (
    <>
      <Carousel
        slideSize="0"
        slideGap="xs"
        classNames={{ root: classes.root, control: classes.control }}
        emblaOptions={{
          align: "start",
          dragFree: true,
          loop: true,
        }}
      >
        {imageResults.map(([title, url], index) => (
          <Transition
            key={url}
            mounted={state.canStartTransition}
            transition="fade"
            timingFunction="ease"
            enterDelay={shouldReduceMotion ? 0 : Math.min(index, 5) * 40}
            duration={shouldReduceMotion ? 0 : 250}
          >
            {(styles) => (
              <Carousel.Slide style={styles}>
                <UnstyledButton
                  aria-label={`Open image preview: ${title || getHostname(url)}`}
                  className={classes.thumbnailButton}
                  onClick={() => handleImageClick(index)}
                >
                  {renderTile(title, url)}
                </UnstyledButton>
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
        slides={imageResults.map(([title, url, , sourceUrl]) => ({
          // The grid's thumbnail when it loaded; when it did not, the full
          // image behind the result is the best stand-in the lightbox has.
          src: failedThumbnails[url]
            ? sourceUrl
            : (thumbnailSrcs[url] ?? sourceUrl),
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
                  Source: {getHostname(sourceUrl)}
                </Text>
              )}
              <Group align="center" justify="center" gap="xs">
                {sourceUrl && (
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
                )}
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
