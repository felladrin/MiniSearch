import { Stack, VStack, Avatar, HStack, Button, Text } from "rsuite";
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
            <VStack
              style={{
                backgroundColor: "rgba(21, 22, 28, 0.95)",
                padding: "16px",
                position: "absolute",
                inset: "auto 0 0 0",
              }}
            >
              <Stack.Item alignSelf="center">
                <Text as="cite" maxLines={1}>
                  {title || "Untitled"}
                </Text>
              </Stack.Item>
              <Stack.Item alignSelf="center">
                <HStack alignItems="center" justifyContent="center" wrap>
                  <Stack.Item>
                    <Button
                      appearance="link"
                      href={url}
                      target="_blank"
                      size="xs"
                      title="Click to visit the page where the image was found"
                      rel="noopener noreferrer"
                    >
                      {new URL(url).hostname}
                    </Button>
                  </Stack.Item>
                  <Stack.Item>
                    <Button
                      appearance="link"
                      href={sourceUrl}
                      target="_blank"
                      size="xs"
                      title="Click to see the image in full size"
                      rel="noopener noreferrer"
                    >
                      full resolution
                    </Button>
                  </Stack.Item>
                </HStack>
              </Stack.Item>
            </VStack>
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
