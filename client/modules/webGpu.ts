import { addLogEntry } from "./logEntries";

/**
 * A stuck GPU process can leave the adapter request unanswered, and the
 * settings wait for this check, so it gives up and falls back to the CPU.
 */
const ADAPTER_TIMEOUT_MS = 5000;

/** The parts of `navigator.gpu` the detection reads. */
interface WebGpu {
  wgslLanguageFeatures?: ReadonlySet<string>;
  requestAdapter(): Promise<{
    info?: { isFallbackAdapter?: boolean };
    features: ReadonlySet<string>;
  } | null>;
}

/**
 * Whether wllama can run a model on this browser's GPU. Having the WebGPU API
 * is not enough: wllama's shaders use subgroups and the `subgroup_id`
 * builtin, and Chrome 137, for one, exposes the API but cannot compile them,
 * so every model aborted there. Without all of this the model runs on the CPU.
 */
export async function detectWebGpuSupport(
  gpu: WebGpu | undefined,
): Promise<boolean> {
  const unusable = (reason: string) => {
    addLogEntry(`WebGPU unusable (${reason}); models will run on the CPU`);
    return false;
  };

  if (!gpu) return unusable("the browser has no WebGPU API");
  if (!gpu.wgslLanguageFeatures?.has("subgroup_id")) {
    return unusable("its shader compiler lacks the subgroup_id builtin");
  }

  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), ADAPTER_TIMEOUT_MS),
      ),
    ]);
    if (adapter === "timeout") {
      return unusable("the adapter request did not answer in 5 seconds");
    }
    if (!adapter) return unusable("no GPU adapter is available");
    if (adapter.info?.isFallbackAdapter) {
      return unusable("the only adapter is a software fallback");
    }
    if (!adapter.features.has("subgroups")) {
      return unusable("the GPU adapter lacks the subgroups feature");
    }
  } catch (error) {
    return unusable(
      `the adapter request failed: ${error instanceof Error ? error.message : error}`,
    );
  }

  addLogEntry("WebGPU usable; models will run on the GPU");
  return true;
}

/** Resolved once per page load, so every caller sees the same answer. */
export const webGpuSupport = detectWebGpuSupport(
  (navigator as Navigator & { gpu?: WebGpu }).gpu,
);
