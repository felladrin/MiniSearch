export let isWebGPUAvailable = "gpu" in navigator;

if (isWebGPUAvailable) {
  try {
    const adapter = await (
      navigator as unknown as {
        gpu: { requestAdapter: () => Promise<never> };
      }
    ).gpu.requestAdapter();
    if (!adapter) {
      throw Error("Couldn't request WebGPU adapter.");
    }
    isWebGPUAvailable = true;
  } catch (error) {
    isWebGPUAvailable = false;
  }
}
