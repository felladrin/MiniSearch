import { addLogEntry } from "./logEntries";

export const isWebGPUAvailable = "gpu" in navigator;

addLogEntry(
  `WebGPU availability: ${isWebGPUAvailable ? "available" : "unavailable"}`,
);
