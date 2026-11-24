import { afterEach, describe, expect, it, vi } from "vitest";
import * as safeStorage from "./safeStorage";

describe("safeStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null from getItem when localStorage throws SecurityError", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("Access is denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Access is denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("Access is denied", "SecurityError");
      },
    });

    expect(safeStorage.getItem("settings")).toBeNull();
    expect(() => safeStorage.setItem("settings", "{}")).not.toThrow();
    expect(() => safeStorage.removeItem("settings")).not.toThrow();
  });

  it("delegates to localStorage when access is allowed", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    expect(safeStorage.getItem("k")).toBeNull();
    safeStorage.setItem("k", "v");
    expect(safeStorage.getItem("k")).toBe("v");
    safeStorage.removeItem("k");
    expect(safeStorage.getItem("k")).toBeNull();
  });
});
