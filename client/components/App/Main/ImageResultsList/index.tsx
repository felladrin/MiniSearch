import {
  Stack,
  Whisper,
  VStack,
  Popover,
  Avatar,
  HStack,
  Button,
  Text,
} from "rsuite";
import { SearchResults } from "../../../../modules/search";
import FadeIn from "react-fade-in";
import { useState } from "react";

export function ImageResultsList({
  imageResults,
}: {
  imageResults: SearchResults["imageResults"];
}) {
  const [isFadeInComplete, setIsFadeInComplete] = useState(false);

  return (
    <div
      style={{
        width: "calc(100vw - 48px - 20px)",
        maxWidth: "100%",
        overflowY: "hidden",
        overflowX: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: `${isFadeInComplete ? "var(--rs-btn-default-bg)" : "transparent"} transparent`,
      }}
    >
      <FadeIn
        delay={150}
        transitionDuration={1500}
        wrapperTag={HStack}
        onComplete={() => setIsFadeInComplete(true)}
      >
        {imageResults.map(
          (
            [title, url, thumbnailUrl, sourceUrl]: [
              string,
              string,
              string,
              string,
            ],
            index,
          ) => {
            const speaker = (
              <Popover>
                <VStack>
                  <Button
                    appearance="link"
                    href={sourceUrl}
                    target="_blank"
                    title="Click to see the image in full size"
                    rel="noopener noreferrer"
                    block
                  >
                    <img
                      src={thumbnailUrl}
                      alt={title}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "50vh",
                      }}
                    />
                  </Button>
                  <Stack.Item style={{ margin: "auto" }}>
                    <Text as="cite">{title}</Text>
                  </Stack.Item>
                  <Stack.Item style={{ width: "100%" }}>
                    <Button
                      appearance="link"
                      href={url}
                      target="_blank"
                      size="xs"
                      title="Click to visit the page where the image was found"
                      rel="noopener noreferrer"
                      block
                    >
                      {new URL(url).hostname}
                    </Button>
                  </Stack.Item>
                </VStack>
              </Popover>
            );

            return (
              <Whisper
                key={index}
                trigger="click"
                preventOverflow
                placement="auto"
                speaker={speaker}
              >
                <Avatar
                  size="xxl"
                  src={thumbnailUrl}
                  bordered
                  style={{
                    cursor: "pointer",
                    margin: "8px",
                    marginBottom: "16px",
                  }}
                  imgProps={{
                    style: {
                      objectFit: "cover",
                    },
                  }}
                />
              </Whisper>
            );
          },
        )}
      </FadeIn>
    </div>
  );
}
