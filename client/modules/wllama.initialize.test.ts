import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "./logEntries";
import { initializeWllama } from "./wllama";

const instance = vi.hoisted(() => ({
  loadModelFromHF: vi.fn(),
  createChatCompletion: vi.fn(),
  exit: vi.fn(),
}));

vi.mock("@wllama/wllama", () => ({
  // A constructor that returns an object hands that object to `new`.
  Wllama: vi.fn(function Wllama() {
    return instance;
  }),
}));
vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("./textGenerationUtilities", () => ({ defaultContextSize: 4096 }));

const warmupReply = { choices: [{ message: { content: "a" } }] };

describe("initializeWllama", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instance.loadModelFromHF.mockResolvedValue(undefined);
    instance.createChatCompletion.mockResolvedValue(warmupReply);
    instance.exit.mockResolvedValue(undefined);
  });

  it("returns the loaded instance and releases it only between the two loads", async () => {
    const result = await initializeWllama("repo", "file.gguf");

    expect(result).toBe(instance);
    expect(instance.loadModelFromHF).toHaveBeenCalledTimes(2);
    expect(instance.exit).toHaveBeenCalledTimes(1);
    expect(instance.exit.mock.invocationCallOrder[0]).toBeGreaterThan(
      instance.loadModelFromHF.mock.invocationCallOrder[0],
    );
    expect(instance.exit.mock.invocationCallOrder[0]).toBeLessThan(
      instance.loadModelFromHF.mock.invocationCallOrder[1],
    );
  });

  it("releases the instance when the warm-up fails", async () => {
    const warmupError = new Error("wasm abort");
    instance.createChatCompletion.mockRejectedValue(warmupError);

    await expect(initializeWllama("repo", "file.gguf")).rejects.toBe(
      warmupError,
    );

    expect(instance.exit).toHaveBeenCalledTimes(1);
  });

  it("rethrows the original error when releasing the instance also fails", async () => {
    const warmupError = new Error("wasm abort");
    instance.createChatCompletion.mockRejectedValue(warmupError);
    instance.exit.mockRejectedValue(new Error("worker already gone"));

    await expect(initializeWllama("repo", "file.gguf")).rejects.toBe(
      warmupError,
    );

    expect(addLogEntry).toHaveBeenCalledWith(
      "Failed to release Wllama after initialization failed: worker already gone",
    );
  });
});
