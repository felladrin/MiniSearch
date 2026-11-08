import { describe, expect, it, vi } from "vitest";
import { detectWebGpuSupport } from "./webGpu";

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));

/** A `navigator.gpu` that offers what wllama's WebGPU shaders need. */
function usableGpu(
  overrides: {
    wgslLanguageFeatures?: string[];
    adapter?: null;
    isFallbackAdapter?: boolean;
    features?: string[];
    requestAdapterError?: Error;
  } = {},
) {
  return {
    wgslLanguageFeatures: new Set(
      overrides.wgslLanguageFeatures ?? ["subgroup_id"],
    ),
    requestAdapter: async () => {
      if (overrides.requestAdapterError) throw overrides.requestAdapterError;
      if (overrides.adapter === null) return null;
      return {
        info: { isFallbackAdapter: overrides.isFallbackAdapter ?? false },
        features: new Set(overrides.features ?? ["subgroups", "shader-f16"]),
      };
    },
  };
}

describe("detectWebGpuSupport", () => {
  it("accepts a GPU adapter with the features wllama's shaders use", async () => {
    expect(await detectWebGpuSupport(usableGpu())).toBe(true);
  });

  it("rejects a browser without the WebGPU API", async () => {
    expect(await detectWebGpuSupport(undefined)).toBe(false);
  });

  it("rejects a shader compiler without the subgroup_id builtin", async () => {
    // Chrome 137 exposes WebGPU and the subgroups feature, but rejects
    // `@builtin(subgroup_id)`, so every model aborted on its GPU.
    const gpu = usableGpu({ wgslLanguageFeatures: [] });
    expect(await detectWebGpuSupport(gpu)).toBe(false);
  });

  it("rejects a browser that has the API but no adapter", async () => {
    expect(await detectWebGpuSupport(usableGpu({ adapter: null }))).toBe(false);
  });

  it("rejects a software fallback adapter", async () => {
    const gpu = usableGpu({ isFallbackAdapter: true });
    expect(await detectWebGpuSupport(gpu)).toBe(false);
  });

  it("rejects an adapter without the subgroups feature", async () => {
    const gpu = usableGpu({ features: ["shader-f16"] });
    expect(await detectWebGpuSupport(gpu)).toBe(false);
  });

  it("rejects an adapter request that throws", async () => {
    const gpu = usableGpu({ requestAdapterError: new Error("GPU process") });
    expect(await detectWebGpuSupport(gpu)).toBe(false);
  });

  it("gives up on an adapter request that never answers", async () => {
    vi.useFakeTimers();
    try {
      const gpu = {
        ...usableGpu(),
        requestAdapter: () => new Promise<null>(() => {}),
      };
      const detection = detectWebGpuSupport(gpu);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await detection).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
