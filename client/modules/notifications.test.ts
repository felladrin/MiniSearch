import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REQUEST_PERMISSION_TIMEOUT_MS,
  requestNotificationPermission,
  showAiCompleteNotification,
} from "./notifications";

const addLogEntryMock = vi.fn();

vi.mock("./logEntries", () => ({
  addLogEntry: (...args: unknown[]) => addLogEntryMock(...args),
}));

class MockNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  static lastInstance: MockNotification | undefined;
  title: string;
  options?: NotificationOptions;

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    MockNotification.lastInstance = this;
  }
}

describe("notifications module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    MockNotification.permission = "default";
    MockNotification.lastInstance = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("requestNotificationPermission", () => {
    it("returns denied when the Notification API is unsupported", async () => {
      const result = await requestNotificationPermission();

      expect(result).toBe("denied");
    });

    it("returns granted without prompting when already granted", async () => {
      MockNotification.permission = "granted";
      vi.stubGlobal("Notification", MockNotification);

      const result = await requestNotificationPermission();

      expect(result).toBe("granted");
      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it("returns denied without prompting when already denied", async () => {
      MockNotification.permission = "denied";
      vi.stubGlobal("Notification", MockNotification);

      const result = await requestNotificationPermission();

      expect(result).toBe("denied");
      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it("prompts the user when permission has not been decided yet", async () => {
      MockNotification.permission = "default";
      MockNotification.requestPermission.mockResolvedValue("granted");
      vi.stubGlobal("Notification", MockNotification);

      const result = await requestNotificationPermission();

      expect(result).toBe("granted");
      expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
    });

    it("falls back to default if the browser never responds to the request", async () => {
      vi.useFakeTimers();
      try {
        MockNotification.permission = "default";
        MockNotification.requestPermission.mockReturnValue(
          new Promise(() => {}),
        );
        vi.stubGlobal("Notification", MockNotification);

        const resultPromise = requestNotificationPermission();
        await vi.advanceTimersByTimeAsync(REQUEST_PERMISSION_TIMEOUT_MS);

        expect(await resultPromise).toBe("default");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("showAiCompleteNotification", () => {
    it("does nothing when the Notification API is unsupported", () => {
      expect(() => showAiCompleteNotification("test query")).not.toThrow();
    });

    it("does nothing when permission is not granted", () => {
      MockNotification.permission = "default";
      vi.stubGlobal("Notification", MockNotification);

      showAiCompleteNotification("test query");

      expect(MockNotification.lastInstance).toBeUndefined();
    });

    it("does nothing when the page already has focus", () => {
      MockNotification.permission = "granted";
      vi.stubGlobal("Notification", MockNotification);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);

      showAiCompleteNotification("test query");

      expect(MockNotification.lastInstance).toBeUndefined();
    });

    it("shows a notification with the query as the title when granted and unfocused", () => {
      MockNotification.permission = "granted";
      vi.stubGlobal("Notification", MockNotification);
      vi.spyOn(document, "hasFocus").mockReturnValue(false);

      showAiCompleteNotification("capital of France");

      expect(MockNotification.lastInstance?.title).toBe("capital of France");
      expect(MockNotification.lastInstance?.options?.body).toBe(
        "AI response is ready on MiniSearch.",
      );
      expect(MockNotification.lastInstance?.options?.icon).toBe("/favicon.png");
    });

    it("truncates very long queries in the notification title", () => {
      MockNotification.permission = "granted";
      vi.stubGlobal("Notification", MockNotification);
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      const longQuery = "a".repeat(200);

      showAiCompleteNotification(longQuery);

      const title = MockNotification.lastInstance?.title ?? "";
      expect(title.length).toBeLessThan(longQuery.length);
    });

    it("logs instead of throwing when the browser rejects the constructor", () => {
      class ThrowingNotification extends MockNotification {
        constructor(title: string, options?: NotificationOptions) {
          super(title, options);
          throw new TypeError("Illegal constructor");
        }
      }
      ThrowingNotification.permission = "granted";
      vi.stubGlobal("Notification", ThrowingNotification);
      vi.spyOn(document, "hasFocus").mockReturnValue(false);

      expect(() => showAiCompleteNotification("test query")).not.toThrow();
      expect(addLogEntryMock).toHaveBeenCalledWith(
        expect.stringContaining("Illegal constructor"),
      );
    });
  });
});
