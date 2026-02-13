/**
 * Posts a message to the parent window if it exists
 * @param message - The message to send to the parent window
 */
export function postMessageToParentWindow(message: unknown) {
  const parentWindow = self.parent;
  const targetOrigin = parentWindow?.[0]?.location?.ancestorOrigins?.[0];
  if (targetOrigin) parentWindow.postMessage(message, targetOrigin);
}
