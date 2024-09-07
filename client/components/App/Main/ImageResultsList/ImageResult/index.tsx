import { Stack, Avatar, Button, Text, Notification } from "rsuite";
import Zoom from "react-medium-image-zoom";

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
    return (
      <>
        {img}
        {modalState === "LOADED" && (
          <>
            {buttonUnzoom}
            <Stack
              justifyContent="center"
              style={{
                margin: "16px",
                position: "absolute",
                inset: "auto 0 0 0",
              }}
            >
              <Notification closable>
                <Stack direction="row" alignItems="center" spacing={16}>
                  <Stack.Item>
                    <Button
                      href={sourceUrl}
                      target="_blank"
                      title="Click to see the image in full size"
                      rel="noopener noreferrer"
                    >
                      View in full
                      <br />
                      resolution
                    </Button>
                  </Stack.Item>
                  <Stack.Item>
                    <Stack
                      direction="column"
                      alignItems="flex-start"
                      spacing={8}
                    >
                      <Text as="cite">{title || "Untitled"}</Text>
                      <Button
                        appearance="ghost"
                        href={url}
                        target="_blank"
                        size="xs"
                        title="Click to visit the page where the image was found"
                        rel="noopener noreferrer"
                      >
                        {new URL(url).hostname}
                      </Button>
                    </Stack>
                  </Stack.Item>
                </Stack>
              </Notification>
            </Stack>
          </>
        )}
      </>
    );
  };

  return (
    <Avatar
      size="xxl"
      bordered
      style={{
        cursor: "pointer",
        margin: "8px",
        marginBottom: "16px",
      }}
    >
      <Zoom ZoomContent={CustomZoomContent} classDialog="custom-zoom">
        <img
          alt={title}
          src={thumbnailUrl}
          style={{
            objectFit: "cover",
            height: "120px",
            width: "120px",
          }}
        />
      </Zoom>
    </Avatar>
  );
}
