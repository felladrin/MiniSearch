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

  it("keeps thinking enabled on every model", () => {
    // The reasoning channel is streamed into the thinking UI, so a model
    // must not hand the template a kwarg that switches thinking off: the
    // answer would arrive with no visible chain of thought, which reads as
    // a dumber model rather than a feature that was turned off.
    for (const [id, model] of models) {
      expect(model.chatTemplateKwargs?.enable_thinking, id).not.toBe(false);
    }
  });

  it("asks every thinking model for low reasoning effort", () => {
    // A chain of thought cut off by the budget degrades the answer, so the
    // budget is only a backstop; templates that read `reasoning_effort`
    // must be steered to think less in the first place.
    for (const [id, model] of models) {
      if (model.reasoningBudgetTokens !== undefined) {
        expect(model.chatTemplateKwargs?.reasoning_effort, id).toBe("low");
      }
    }
  });

  it("keeps reasoning budgets small enough to leave room for the answer", () => {
    // The budget forces the final answer once the chain of thought runs
    // this long. It must stay far below the 4096-token context, or the
    // model thinks itself out of the window before answering.
    for (const [id, model] of models) {
      if (model.reasoningBudgetTokens !== undefined) {
        expect(model.reasoningBudgetTokens, id).toBeGreaterThanOrEqual(64);
        expect(model.reasoningBudgetTokens, id).toBeLessThanOrEqual(1024);
      }
    }
  });

  it("uses the shared default context size for every model", () => {
    for (const [id, model] of models) {
      expect(model.contextSize, id).toBe(4096);
    }
  });
});
