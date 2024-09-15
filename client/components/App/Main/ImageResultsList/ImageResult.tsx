import { Stack, Button, Text, Notification, Group } from "@mantine/core";
import Zoom from "react-medium-image-zoom";
import { getHostname } from "../../../../modules/stringFormatters";
import { addLogEntry } from "../../../../modules/logEntries";
import { useEffect, useState } from "react";

export function ImageResult({
  title,
  url,
  thumbnailUrl,
  sourceUrl,
}: {
  title: string;
  url: string;
  thumbnailUrl: string;
  sourceUrl: string;
}) {
  const CustomZoomContent: React.ComponentProps<typeof Zoom>["ZoomContent"] = ({
    buttonUnzoom,
    img,
    modalState,
  }) => {
    const [showNotification, setShowNotification] = useState(true);

    useEffect(() => setShowNotification(true), [modalState]);

    return (
      <>
        {img}
        {modalState === "LOADED" && (
          <>
            {buttonUnzoom}
            <Stack
              justify="center"
              style={{
                margin: "16px",
                position: "absolute",
                inset: "auto 0 0 0",
              }}
            >
              {showNotification && (
                <Notification
                  onClose={() => setShowNotification(false)}
                  radius="xl"
                  color="transparent"
                  withBorder
                >
                  <Stack align="center" gap="md">
                    <Text component="cite" ta="center">
                      {title || "Untitled"}
                    </Text>
                    <Group align="center" justify="center" gap="xs">
                      <Button
                        variant="subtle"
                        component="a"
                        size="xs"
                        href={sourceUrl}
                        target="_blank"
                        title="Click to see the image in full size"
                        rel="noopener noreferrer"
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
                          addLogEntry("User clicked an image result");
                        }}
                      >
                        Visit {getHostname(url)}
                      </Button>
                    </Group>
                  </Stack>
                </Notification>
              )}
            </Stack>
          </>
        )}
      </>
    );
  };

  return (
    <Zoom ZoomContent={CustomZoomContent} classDialog="custom-zoom">
      <img
        alt={title}
        src={thumbnailUrl}
        style={{
          objectFit: "cover",
          height: "180px",
          width: "240px",
          borderRadius: "4px",
          border: "2px solid var(--mantine-color-default-border)",
        }}
      />
    </Zoom>
  );
}
