/**
 * Browser notification module for AI completion alerts
 */

/**
 * Requests permission to show browser notifications
 * @returns Promise resolving to the notification permission state
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    return "denied";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission !== "denied") {
    return await Notification.requestPermission();
  }

  return "denied";
}

/**
 * Shows a browser notification when AI generation is complete
 * @param query - The search query that triggered the AI generation
 */
export function showAiCompleteNotification(query: string) {
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission !== "granted") {
    return;
  }

  new Notification("MiniSearch: AI response is ready", {
    body: `Your search for "${query}" has finished generating a summary.`,
    icon: "/favicon.ico",
    tag: "ai-complete",
    requireInteraction: false,
  });
}
