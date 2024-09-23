export function postMessageToParentWindow(message: unknown) {
  const parentWindow = self.parent;
  const targetOrigin = parentWindow?.[0]?.location?.ancestorOrigins?.[0];
  if (targetOrigin) parentWindow.postMessage(message, targetOrigin);
}
