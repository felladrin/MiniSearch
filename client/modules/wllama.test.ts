import { describe, expect, it, vi } from "vitest";
import { wllamaModels } from "./wllama";

vi.mock("./logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("./textGenerationUtilities", () => ({ defaultContextSize: 4096 }));

const models = Object.entries(wllamaModels);

describe("wllamaModels catalog", () => {
  it("lists models in ascending file-size order", () => {
    const sizes = models.map(([, model]) => model.fileSizeInMegabytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it("gives every model a unique label", () => {
    const labels = models.map(([, model]) => model.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("points every model at a sharded Felladrin repository", () => {
    for (const [id, model] of models) {
      expect(model.hfRepoId, id).toMatch(/^Felladrin\/gguf-sharded-/);
      // Chromium's OPFS silently truncates files past 2000 MiB, so every
      // catalog file must be a shard, never a monolithic GGUF.
      expect(model.hfFilePath, id).toMatch(/-\d{5}-of-\d{5}\.gguf$/);
    }
  });

  it("keeps every model inside the wasm memory ceiling", () => {
    // The wllama wasm build caps linear memory at 4 GiB. Models at 3.5 GB
    // and above were measured to OOM during buffer reserve (gemma4 quants),
    // so the catalog stays clearly below that line.
    for (const [id, model] of models) {
      expect(model.fileSizeInMegabytes, id).toBeLessThan(3700);
      expect(model.fileSizeInMegabytes, id).toBeGreaterThan(0);
    }
  });

  it("switches thinking-by-default chat templates off", () => {
    // MiniSearch renders only the content channel. A template that thinks
    // by default spends the whole token budget on reasoning_content and the
    // user sees an empty answer, so any model passing template kwargs must
    // be turning thinking off.
    for (const [id, model] of models) {
      if (model.chatTemplateKwargs) {
        expect(model.chatTemplateKwargs, id).toEqual({
          enable_thinking: false,
        });
      }
    }
  });

  it("uses the shared default context size for every model", () => {
    for (const [id, model] of models) {
      expect(model.contextSize, id).toBe(4096);
    }
  });
});
