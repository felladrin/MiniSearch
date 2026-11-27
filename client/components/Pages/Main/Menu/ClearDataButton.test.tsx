import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "@/modules/logEntries";
import { clearWllamaCache } from "@/modules/wllama";
import ClearDataButton from "./ClearDataButton";

const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", mockNavigate]),
}));

vi.mock("@/modules/logEntries", () => ({
  addLogEntry: vi.fn(),
}));

vi.mock("@/modules/wllama", () => ({
  clearWllamaCache: vi.fn(),
}));

function renderClearDataButton() {
  return render(
    <MantineProvider>
      <ClearDataButton />
    </MantineProvider>,
  );
}

describe("ClearDataButton", () => {
  /** Presses the button and waits for the teardown to reload the page. */
  async function pressClearAllData() {
    const user = userEvent.setup();
    renderClearDataButton();
    await user.click(screen.getByRole("button", { name: "Clear all data" }));
    await waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
  }

  const originalLocation = self.location;
  const originalCachesDescriptor = Object.getOwnPropertyDescriptor(
    self,
    "caches",
  );
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    reloadMock = vi.fn();
    Object.defineProperty(self, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    vi.spyOn(self, "confirm").mockReturnValue(true);
    vi.spyOn(Dexie, "getDatabaseNames").mockResolvedValue(["minisearch-db"]);
    vi.spyOn(Dexie, "delete").mockResolvedValue(undefined);
    vi.mocked(clearWllamaCache).mockResolvedValue(undefined);
    localStorage.setItem("sample-key", "sample-value");
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(self, "location", {
      configurable: true,
      value: originalLocation,
    });
    if (originalCachesDescriptor) {
      Object.defineProperty(self, "caches", originalCachesDescriptor);
    } else {
      Reflect.deleteProperty(self, "caches");
    }
    vi.restoreAllMocks();
  });

  it("completes the teardown and reloads when self.caches is undefined", async () => {
    Object.defineProperty(self, "caches", {
      configurable: true,
      value: undefined,
    });

    await pressClearAllData();

    expect(localStorage.getItem("sample-key")).toBeNull();
    expect(Dexie.delete).toHaveBeenCalledWith("minisearch-db");
    expect(clearWllamaCache).toHaveBeenCalledTimes(1);
    expect(addLogEntry).toHaveBeenCalledWith("All data cleared successfully");
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    expect(
      screen.getByRole("button", { name: "Data cleared" }),
    ).not.toHaveAttribute("data-loading");
  });

  it("logs the failure, clears the spinner, and still reloads when clearWllamaCache rejects", async () => {
    Object.defineProperty(self, "caches", {
      configurable: true,
      value: undefined,
    });
    vi.mocked(clearWllamaCache).mockRejectedValueOnce(
      new Error("OPFS unavailable"),
    );

    await pressClearAllData();

    expect(addLogEntry).toHaveBeenCalledWith(
      "Error clearing data: OPFS unavailable",
    );
    expect(addLogEntry).not.toHaveBeenCalledWith(
      "All data cleared successfully",
    );
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    expect(
      screen.getByRole("button", { name: "Clear all data" }),
    ).not.toHaveAttribute("data-loading");
  });

  it("deletes all caches and continues when one caches.delete call rejects", async () => {
    const deleteMock = vi
      .fn<(cacheName: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("locked cache"))
      .mockResolvedValueOnce(true);
    const keysMock = vi.fn().mockResolvedValue(["cache-a", "cache-b"]);

    Object.defineProperty(self, "caches", {
      configurable: true,
      value: {
        keys: keysMock,
        delete: deleteMock,
      },
    });

    await pressClearAllData();

    expect(keysMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith("cache-a");
    expect(deleteMock).toHaveBeenCalledWith("cache-b");
    expect(addLogEntry).toHaveBeenCalledWith(
      "Error deleting cache cache-a: locked cache",
    );
    expect(Dexie.delete).toHaveBeenCalledWith("minisearch-db");
    expect(clearWllamaCache).toHaveBeenCalledTimes(1);
    expect(addLogEntry).toHaveBeenCalledWith("All data cleared successfully");
  });

  it("does nothing when confirmation is cancelled", async () => {
    vi.spyOn(self, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderClearDataButton();

    await user.click(screen.getByRole("button", { name: "Clear all data" }));

    expect(localStorage.getItem("sample-key")).toBe("sample-value");
    expect(clearWllamaCache).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
