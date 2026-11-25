import { getConfig } from "./config";
import { addLogEntry } from "./logEntries";

/**
 * Forwards a message to the page embedding MiniSearch (a Hugging Face Space,
 * for example), addressed to each origin in `PARENT_WINDOW_ORIGINS`. The
 * browser delivers it only when the embedding page is on that origin, so no
 * other frame's state is read to find out where the page is embedded.
 *
 * Never throws: callers post right before navigating and searching.
 */
export function postMessageToParentWindow(message: unknown) {
  const parentWindow = self.parent;
  if (parentWindow === self) return;

  getConfig().then(
    ({ parentWindowOrigins }) => {
      for (const origin of parentWindowOrigins) {
        try {
          parentWindow.postMessage(message, origin);
        } catch (error) {
          addLogEntry(`Failed to post the query to ${origin}: ${error}`);
        }
      }
    },
    () => {
      // Without the server's list, no embedding page is trusted with the query.
    },
  );
}
