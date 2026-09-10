import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "@/modules/logEntries";
import { useScreenWakeLock } from "./useScreenWakeLock";

vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));

class FakeSentinel extends EventTarget {
  released = false;

  release() {
    this.released = true;
    this.dispatchEvent(new Event("release"));
    return Promise.resolve();
  }
}

/**
 * Replaces the platform API with a fake. With `deferred`, requests stay pending
 * until `resolveAll` runs, which is how the in-flight cases are reproduced.
 */
function stubWakeLockApi({ deferred = false } = {}) {
  const sentinels: FakeSentinel[] = [];
  const pendingResolvers: Array<() => void> = [];

  const request = vi.fn(() => {
    const sentinel = new FakeSentinel();
    sentinels.push(sentinel);

    if (!deferred) return Promise.resolve(sentinel);

    return new Promise<FakeSentinel>((resolve) => {
      pendingResolvers.push(() => resolve(sentinel));
    });
  });

  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
  });

  return {
    request,
    sentinels,
    resolveAll: () => {
      for (const resolve of pendingResolvers.splice(0)) resolve();
    },
  };
}

function stubVisibilityState(visibilityState: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: visibilityState,
    configurable: true,
  });
}

afterEach(async () => {
  // Unmount before clearing the spies: the cleanup's release log resolves in a
  // microtask, and React Testing Library's own cleanup runs after this hook.
  cleanup();
  await act(async () => {});

  Reflect.deleteProperty(navigator, "wakeLock");
  stubVisibilityState("visible");
  vi.clearAllMocks();
});

describe("useScreenWakeLock", () => {
  it("holds the lock while active and releases it once inactive", async () => {
    const { request, sentinels } = stubWakeLockApi();

    const { rerender } = renderHook(
      ({ isActive }) => useScreenWakeLock(isActive),
      { initialProps: { isActive: true } },
    );

    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));

    expect(addLogEntry).toHaveBeenCalledWith("Screen wake lock acquired");

    rerender({ isActive: false });

    await waitFor(() => expect(sentinels[0].released).toBe(true));
    await waitFor(() =>
      expect(addLogEntry).toHaveBeenCalledWith("Screen wake lock released"),
    );
  });

  it("does not request a lock while inactive", () => {
    const { request } = stubWakeLockApi();

    renderHook(() => useScreenWakeLock(false));

    expect(request).not.toHaveBeenCalled();
  });

  it("requests a fresh lock only after the platform released the previous one", async () => {
    const { request, sentinels } = stubWakeLockApi();

    renderHook(() => useScreenWakeLock(true));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      await sentinels[0].release();
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("keeps a single lock when visibility changes while a request is in flight", async () => {
    const { request, resolveAll } = stubWakeLockApi({ deferred: true });

    renderHook(() => useScreenWakeLock(true));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      resolveAll();
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after the hook stopped needing it", async () => {
    const { sentinels, resolveAll } = stubWakeLockApi({ deferred: true });

    const { unmount } = renderHook(() => useScreenWakeLock(true));

    unmount();

    await act(async () => {
      resolveAll();
    });

    await waitFor(() => expect(sentinels[0].released).toBe(true));
  });

  it("does not request a lock while the document is hidden", async () => {
    const { request } = stubWakeLockApi();
    stubVisibilityState("hidden");

    renderHook(() => useScreenWakeLock(true));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(request).not.toHaveBeenCalled();
  });

  it("retries instead of keeping a lock that arrives already released", async () => {
    const { request, sentinels, resolveAll } = stubWakeLockApi({
      deferred: true,
    });

    renderHook(() => useScreenWakeLock(true));

    sentinels[0].released = true;

    await act(async () => {
      resolveAll();
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("stops listening for visibility changes after cleanup", async () => {
    const { request } = stubWakeLockApi();

    const { unmount } = renderHook(() => useScreenWakeLock(true));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("logs a failed request and can still acquire a lock afterwards", async () => {
    const request = vi
      .fn<() => Promise<FakeSentinel>>()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(new FakeSentinel());

    Object.defineProperty(navigator, "wakeLock", {
      value: { request },
      configurable: true,
    });

    renderHook(() => useScreenWakeLock(true));

    await waitFor(() =>
      expect(addLogEntry).toHaveBeenCalledWith(
        "Screen wake lock unavailable: denied",
      ),
    );

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("logs a release that fails during cleanup", async () => {
    const sentinel = new FakeSentinel();
    sentinel.release = () => Promise.reject("boom");

    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn(() => Promise.resolve(sentinel)) },
      configurable: true,
    });

    const { unmount } = renderHook(() => useScreenWakeLock(true));

    await waitFor(() =>
      expect(addLogEntry).toHaveBeenCalledWith("Screen wake lock acquired"),
    );

    unmount();

    await waitFor(() =>
      expect(addLogEntry).toHaveBeenCalledWith(
        "Failed to release screen wake lock: unknown error",
      ),
    );
  });

  it("stays inert when the browser has no Screen Wake Lock API", () => {
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow();
    expect(addLogEntry).not.toHaveBeenCalled();
  });
});
