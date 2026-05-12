import { addLogEntry } from "./logEntries";

/** Whether the browser supports the WebGPU API. */
export const isWebGPUAvailable = "gpu" in navigator;

addLogEntry(
  `WebGPU availability: ${isWebGPUAvailable ? "available" : "unavailable"}`,
);
