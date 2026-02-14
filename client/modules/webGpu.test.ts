import { describe, expect, it, vi } from "vitest";

interface MockNavigatorWithGpu {
  gpu?: {
    requestAdapter: ReturnType<typeof vi.fn>;
  };
}

function importFresh() {
  vi.resetModules();
  return import("./webGpu");
}

function setupMockNavigator(mockNavigator: MockNavigatorWithGpu) {
  global.navigator = { ...global.navigator, ...mockNavigator };
}

describe("webGpu module", () => {
  it("detects WebGPU availability and F16 support when adapter resolves", async () => {
    const mockNavigator: MockNavigatorWithGpu = {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          features: new Set(["shader-f16"]),
        }),
      },
    };
    setupMockNavigator(mockNavigator);

    const mod = await importFresh();
    expect(mod.isWebGPUAvailable).toBe(true);
    expect(mod.isF16Supported).toBe(true);
  });

  it("sets isWebGPUAvailable false when requestAdapter rejects", async () => {
    const mockNavigator: MockNavigatorWithGpu = {
      gpu: {
        requestAdapter: vi.fn().mockRejectedValue(new Error("fail")),
      },
    };
    setupMockNavigator(mockNavigator);

    const mod = await importFresh();
    expect(mod.isWebGPUAvailable).toBe(false);
    expect(mod.isF16Supported).toBe(false);
  });

  it("sets isWebGPUAvailable false when navigator has no gpu", async () => {
    const mockNavigator: MockNavigatorWithGpu = {};
    setupMockNavigator(mockNavigator);

    const mod = await importFresh();
    expect(mod.isWebGPUAvailable).toBe(false);
    expect(mod.isF16Supported).toBe(false);
  });
});
