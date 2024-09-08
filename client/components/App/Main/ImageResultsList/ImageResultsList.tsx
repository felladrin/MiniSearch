import { HStack } from "rsuite";
import { SearchResults } from "../../../../modules/search";
import FadeIn from "react-fade-in";
import { useState } from "react";
import { ImageResult } from "./ImageResult/ImageResult";

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
        {imageResults.map(([title, url, thumbnailUrl, sourceUrl]) => (
          <ImageResult
            key={sourceUrl}
            title={title}
            url={url}
            thumbnailUrl={thumbnailUrl}
            sourceUrl={sourceUrl}
          />
        ))}
      </FadeIn>
    </div>
  );
}
