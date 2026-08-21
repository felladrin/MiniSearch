import { describe, expect, it, vi } from "vitest";
import { scorePassages } from "./biEncoderService.ts";

vi.mock("./biEncoderService.ts", () => {
  const original = vi.importActual<typeof import("./biEncoderService.ts")>(
    "./biEncoderService.ts",
  );
  return {
    ...original,
    scorePassages: vi.fn(async () => []),
  };
});

describe("scorePassages", () => {
  it("returns empty array when model is not loaded", async () => {
    const scores = await scorePassages("test query", [
      "passage one",
      "passage two",
    ]);
    expect(scores).toEqual([]);
  });

  it("returns empty array when passages is empty", async () => {
    const scores = await scorePassages("test query", []);
    expect(scores).toEqual([]);
  });
});
