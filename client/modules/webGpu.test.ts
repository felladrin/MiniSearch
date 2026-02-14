import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockNavigatorWithGpu {
  gpu?: {
    requestAdapter: ReturnType<typeof vi.fn>;
  };
}

function importFresh() {
  vi.resetModules();
  return import("./webGpu");
}

describe("webGpu module", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    delete (global as any).navigator;
  });

  it("detects WebGPU availability and F16 support when adapter resolves", async () => {
    const mockNavigator: MockNavigatorWithGpu = {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(["shader-f16"]),
        }),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    (global as any).navigator = mockNavigator;

    const mod = await importFresh();
    expect(mod.isWebGPUAvailable).toBe(true);
    expect(mod.isF16Supported).toBe(true);
  });

  it("sets isWebGPUAvailable false when requestAdapter rejects", async () => {
    // Mock requestAdapter to reject
    const mockNavigator: MockNavigatorWithGpu = {
      gpu: {
        requestAdapter: vi.fn().mockRejectedValue(new Error("fail")),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    (global as any).navigator = mockNavigator;

    const mod = await importFresh();
    expect(mod.isWebGPUAvailable).toBe(false);
    expect(mod.isF16Supported).toBe(false);
  });

  it("sets isWebGPUAvailable false when navigator has no gpu", async () => {
    const mockNavigator: MockNavigatorWithGpu = {};
    // biome-ignore lint/suspicious/noExplicitAny: Necessary for test mocking
    (global as any).navigator = mockNavigator;

    const mod = await importFresh();
    expect(mod.isWebGPUAvailable).toBe(false);
    expect(mod.isF16Supported).toBe(false);
  });
});
