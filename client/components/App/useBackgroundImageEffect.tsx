import { useEffect } from "react";
import { DOMHelper } from "rsuite";

/**
 * A custom React hook that applies a background image to the document body.
 *
 * @param backgroundImageUrl - The URL of the background image to apply.
 *                             If set to "none", the background image will be removed.
 *
 * @remarks
 * This hook uses the `useEffect` hook to apply or remove the background image
 * whenever the `backgroundImageUrl` changes. It utilizes the `DOMHelper` from
 * the 'rsuite' library to manipulate the document body's style.
 *
 * @example
 * ```
 * const App = () => {
 *   const backgroundUrl = "https://example.com/background.jpg";
 *   useBackgroundImageEffect(backgroundUrl);
 *   return <div>App content</div>;
 * };
 * ```
 */
export function useBackgroundImageEffect(backgroundImageUrl: string) {
  useEffect(() => {
    if (!document.body) return;

    if (backgroundImageUrl === "none") {
      DOMHelper.removeStyle(document.body, "background-image");
    } else {
      DOMHelper.addStyle(document.body, {
        backgroundImage: `url('${backgroundImageUrl}')`,
      });
    }
  }, [backgroundImageUrl]);
}
