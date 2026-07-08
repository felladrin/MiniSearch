import { addLogEntry } from "./logEntries";

const MAX_NOTIFICATION_QUERY_LENGTH = 100;

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
 * Shows a browser notification when AI generation is complete, unless the
 * user already has this page focused
 * @param query - The search query that triggered the AI generation
 */
export function showAiCompleteNotification(query: string) {
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission !== "granted") {
    return;
  }

  if (document.hasFocus()) {
    return;
  }

  const truncatedQuery =
    query.length > MAX_NOTIFICATION_QUERY_LENGTH
      ? `${query.slice(0, MAX_NOTIFICATION_QUERY_LENGTH)}…`
      : query;

  try {
    new Notification(truncatedQuery, {
      body: "AI response is ready on MiniSearch.",
      icon: "/favicon.png",
      tag: "ai-complete",
      requireInteraction: false,
    });
  } catch (error) {
    addLogEntry(
      `Failed to show AI-complete notification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
