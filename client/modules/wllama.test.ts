import {
  DEFAULT_WLLAMA_GPU_MODEL_ID,
  DEFAULT_WLLAMA_MODEL_ID,
} from "@shared/serverConfig";
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

  it("splits every model of 2000 MiB or more", () => {
    // In an incognito window, Chromium's OPFS stops each file at 2000 MiB
    // (no limit in a normal profile), so a model above that size must be
    // split. Below it, a single GGUF is fine.
    for (const [id, model] of models) {
      if (model.fileSizeInMegabytes >= 2000) {
        expect(model.hfFilePath, id).toMatch(/-\d{5}-of-\d{5}\.gguf$/);
      }
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

  it("includes both default models", () => {
    expect(wllamaModels).toHaveProperty([DEFAULT_WLLAMA_MODEL_ID]);
    expect(wllamaModels).toHaveProperty([DEFAULT_WLLAMA_GPU_MODEL_ID]);
  });

  it("uses the shared default context size for every model", () => {
    for (const [id, model] of models) {
      expect(model.contextSize, id).toBe(4096);
    }
  });
});
