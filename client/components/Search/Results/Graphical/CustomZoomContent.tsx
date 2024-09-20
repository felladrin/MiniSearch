import { useEffect, useState, ReactNode } from "react";
import { Stack, Button, Text, Notification, Group } from "@mantine/core";
import { getHostname } from "../../../../modules/stringFormatters";
import { addLogEntry } from "../../../../modules/logEntries";

interface CustomZoomContentProps {
  closeButtonComponent: ReactNode;
  imageComponent: ReactNode;
  opened: boolean;
  title: string;
  sourceUrl: string;
  url: string;
}

export function CustomZoomContent({
  closeButtonComponent,
  imageComponent,
  opened,
  title,
  sourceUrl,
  url,
}: CustomZoomContentProps) {
  const [showNotification, setShowNotification] = useState(true);

  useEffect(() => setShowNotification(true), [opened]);

  return (
    <>
      {imageComponent}
      {opened && (
        <>
          {closeButtonComponent}
          <Stack justify="center" m={16} pos="absolute" inset="auto 0 0 0">
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
}
