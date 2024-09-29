import { Center, Loader, rem } from "@mantine/core";
import Zoom from "react-medium-image-zoom";
import { lazy, Suspense } from "react";

const CustomZoomContent = lazy(() => import("./CustomZoomContent"));

export default function ImageResult({
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
  return (
    <Zoom
      ZoomContent={({ buttonUnzoom, img, modalState }) => (
        <Suspense
          fallback={
            <Center>
              <Loader color="gray" />
            </Center>
          }
        >
          <CustomZoomContent
            closeButtonComponent={buttonUnzoom}
            imageComponent={img}
            opened={modalState === "LOADED"}
            title={title}
            sourceUrl={sourceUrl}
            url={url}
          />
        </Suspense>
      )}
      classDialog="custom-zoom"
    >
      <img
        alt={title}
        src={thumbnailUrl}
        style={{
          objectFit: "cover",
          height: rem(180),
          width: rem(240),
          borderRadius: rem(4),
          border: `${rem(2)} solid var(--mantine-color-default-border)`,
        }}
      />
    </Zoom>
  );
}
