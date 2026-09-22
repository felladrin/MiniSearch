import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOnnxModel } from "./onnxModelLoader";

vi.mock("../downloadFileFromHuggingFaceRepository", () => ({
  downloadFileFromHuggingFaceRepository: vi.fn(),
}));

vi.mock("onnxruntime-node", () => ({
  InferenceSession: {
    create: vi.fn(async () => ({ release: async () => {} })),
  },
  Tensor: class {},
}));

// Tokenizer stub whose vocabulary is set per test case.
const { vocab } = vi.hoisted(() => ({ vocab: new Map<string, number>() }));
vi.mock("@huggingface/tokenizers", () => ({
  Tokenizer: class {
    token_to_id(token: string): number | undefined {
      return vocab.get(token);
    }
  },
}));

function stubConfigRead(tokenizerConfig: unknown) {
  vi.spyOn(fs, "readFileSync").mockImplementation((path) =>
    String(path).endsWith("tokenizer_config.json")
      ? JSON.stringify(tokenizerConfig)
      : "{}",
  );
}

describe("loadOnnxModel pad token resolution", () => {
  afterEach(() => {
    vocab.clear();
    vi.restoreAllMocks();
  });

  // The pad id must come from the config, in whichever form transformers
  // serialized it, and the loader must never throw over it — a pad it
  // cannot read returns null and the caller that needs one decides.
  it("resolves a plain-string pad_token", async () => {
    stubConfigRead({ pad_token: "<pad>" });
    vocab.set("<pad>", 1);
    const { padTokenId } = await loadOnnxModel("repo/model", "onnx/m.onnx");
    expect(padTokenId).toBe(1);
  });

  it("resolves the AddedToken dict form of pad_token", async () => {
    stubConfigRead({
      pad_token: {
        content: "<pad>",
        lstrip: false,
        rstrip: false,
        normalized: true,
      },
    });
    vocab.set("<pad>", 1);
    const { padTokenId } = await loadOnnxModel("repo/model", "onnx/m.onnx");
    expect(padTokenId).toBe(1);
  });

  it("resolves a pad id of 0 without treating it as missing", async () => {
    stubConfigRead({ pad_token: "<pad>" });
    vocab.set("<pad>", 0);
    const { padTokenId } = await loadOnnxModel("repo/model", "onnx/m.onnx");
    expect(padTokenId).toBe(0);
  });

  it.each([
    ["no pad_token key", {}],
    ["empty string pad_token", { pad_token: "" }],
    ["dict pad_token with empty content", { pad_token: { content: "" } }],
    ["dict pad_token with no content", { pad_token: { lstrip: true } }],
    ["number pad_token", { pad_token: 42 }],
    ["null pad_token", { pad_token: null }],
  ])("returns null for %s", async (_label, config) => {
    stubConfigRead(config);
    const { padTokenId } = await loadOnnxModel("repo/model", "onnx/m.onnx");
    expect(padTokenId).toBeNull();
  });

  it("returns null when the vocabulary does not contain the pad token", async () => {
    stubConfigRead({ pad_token: "<pad>" });
    const { padTokenId } = await loadOnnxModel("repo/model", "onnx/m.onnx");
    expect(padTokenId).toBeNull();
  });

  it("still returns the session and tokenizer alongside padTokenId", async () => {
    stubConfigRead({ pad_token: "<pad>" });
    vocab.set("<pad>", 1);
    const loaded = await loadOnnxModel("repo/model", "onnx/m.onnx");
    expect(loaded.session).toBeDefined();
    expect(loaded.tokenizer).toBeDefined();
  });
});
