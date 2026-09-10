import { useEffect } from "react";
import { addLogEntry } from "@/modules/logEntries";

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : "unknown error";

/**
 * Holds the platform screen wake lock while `isActive` is true, so a phone left
 * untouched during a long answer does not lock while the text streams in.
 *
 * The platform releases the lock on its own whenever the document stops being
 * visible (tab switch, screen lock) and a released sentinel cannot be reused,
 * so a fresh one is requested on every return to visibility. A lock the browser
 * drops for another reason (power saving, low battery) is only replaced on the
 * next return to visibility, because re-requesting straight from the `release`
 * event fights the browser's own decision. The same goes for a visibility round
 * trip that happens entirely while a request is pending: the request in flight
 * wins, and if it fails there is no event left to retry on until the next one.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 */
export function useScreenWakeLock(isActive: boolean) {
  useEffect(() => {
    if (!isActive || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let isEffectActive = true;
    let isRequestInFlight = false;

    const acquireWakeLock = async () => {
      if (
        sentinel ||
        isRequestInFlight ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      isRequestInFlight = true;

      try {
        const requestedSentinel = await navigator.wakeLock.request("screen");

        if (!isEffectActive) {
          await requestedSentinel.release();
          return;
        }

        if (requestedSentinel.released) return;

        sentinel = requestedSentinel;
        requestedSentinel.addEventListener("release", () => {
          if (sentinel === requestedSentinel) sentinel = null;
        });
        addLogEntry("Screen wake lock acquired");
      } catch (error) {
        addLogEntry(`Screen wake lock unavailable: ${describeError(error)}`);
      } finally {
        isRequestInFlight = false;
      }
    };

    acquireWakeLock();
    document.addEventListener("visibilitychange", acquireWakeLock);

    return () => {
      isEffectActive = false;
      document.removeEventListener("visibilitychange", acquireWakeLock);
      sentinel
        ?.release()
        .then(() => addLogEntry("Screen wake lock released"))
        .catch((error: unknown) => {
          addLogEntry(
            `Failed to release screen wake lock: ${describeError(error)}`,
          );
        });
    };
  }, [isActive]);
}
