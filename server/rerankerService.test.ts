import fs from "node:fs";
import { InferenceSession } from "onnxruntime-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRerankerStatus,
  sanitizeUnicodeSurrogates,
  startRerankerService,
  stopRerankerService,
} from "./rerankerService";

vi.mock("@huggingface/tokenizers", () => ({
  Tokenizer: class {
    encode() {
      return { ids: [1, 2, 3] };
    }
  },
}));

vi.mock("./downloadFileFromHuggingFaceRepository", () => ({
  downloadFileFromHuggingFaceRepository: vi.fn(),
}));

vi.mock("onnxruntime-node", () => ({
  InferenceSession: { create: vi.fn() },
  Tensor: class {},
}));

describe("sanitizeUnicodeSurrogates", () => {
  describe("valid input passthrough", () => {
    it("should return empty string unchanged", () => {
      expect(sanitizeUnicodeSurrogates("")).toBe("");
    });

    it("should return ASCII text unchanged", () => {
      const input = "Hello, World! 123";
      expect(sanitizeUnicodeSurrogates(input)).toBe(input);
    });

    it("should return valid Unicode text unchanged", () => {
      const input = "Héllo Wörld 日本語 🎉";
      expect(sanitizeUnicodeSurrogates(input)).toBe(input);
    });

    it("should preserve valid surrogate pairs (emoji)", () => {
      const input = "Text with emoji 😀🎊🚀";
      expect(sanitizeUnicodeSurrogates(input)).toBe(input);
    });

    it("should preserve valid surrogate pairs in complex text", () => {
      const input = "Start 🎉 middle 🚀 end";
      expect(sanitizeUnicodeSurrogates(input)).toBe(input);
    });
  });

  describe("unpaired high surrogate handling", () => {
    it("should replace lone high surrogate at end of string", () => {
      const highSurrogate = String.fromCharCode(0xd800);
      const input = `text${highSurrogate}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("text\ufffd");
    });

    it("should replace high surrogate followed by non-surrogate", () => {
      const highSurrogate = String.fromCharCode(0xd800);
      const input = `${highSurrogate}A`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffdA");
    });

    it("should replace high surrogate followed by another high surrogate", () => {
      const high1 = String.fromCharCode(0xd800);
      const high2 = String.fromCharCode(0xd801);
      const input = `${high1}${high2}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffd\ufffd");
    });

    it("should replace multiple consecutive unpaired high surrogates", () => {
      const high = String.fromCharCode(0xd800);
      const input = `${high}${high}${high}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffd\ufffd\ufffd");
    });
  });

  describe("unpaired low surrogate handling", () => {
    it("should replace lone low surrogate at start of string", () => {
      const lowSurrogate = String.fromCharCode(0xdc00);
      const input = `${lowSurrogate}text`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffdtext");
    });

    it("should replace lone low surrogate in middle of string", () => {
      const lowSurrogate = String.fromCharCode(0xdc00);
      const input = `before${lowSurrogate}after`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("before\ufffdafter");
    });

    it("should replace multiple consecutive unpaired low surrogates", () => {
      const low = String.fromCharCode(0xdc00);
      const input = `${low}${low}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffd\ufffd");
    });
  });

  describe("mixed surrogate scenarios", () => {
    it("should handle low surrogate followed by high surrogate (reversed pair)", () => {
      const low = String.fromCharCode(0xdc00);
      const high = String.fromCharCode(0xd800);
      const input = `${low}${high}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffd\ufffd");
    });

    it("should handle valid pair followed by unpaired high", () => {
      const validEmoji = "😀";
      const unpairedHigh = String.fromCharCode(0xd83d);
      const input = `${validEmoji}${unpairedHigh}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("😀\ufffd");
    });

    it("should handle unpaired low followed by valid pair", () => {
      const unpairedLow = String.fromCharCode(0xdc00);
      const validEmoji = "🎉";
      const input = `${unpairedLow}${validEmoji}`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("\ufffd🎉");
    });

    it("should handle interleaved valid and invalid surrogates", () => {
      const high = String.fromCharCode(0xd800);
      const low = String.fromCharCode(0xdc00);
      const input = `A${high}B${low}C`;
      expect(sanitizeUnicodeSurrogates(input)).toBe("A\ufffdB\ufffdC");
    });
  });

  describe("edge cases from real-world scenarios", () => {
    it("should handle text that might come from corrupted web content", () => {
      const corruptedChar = String.fromCharCode(0xd834);
      const input = `Search result: ${corruptedChar} more text`;
      expect(sanitizeUnicodeSurrogates(input)).toBe(
        "Search result: \ufffd more text",
      );
    });

    it("should preserve valid content around invalid surrogates", () => {
      const badHigh = String.fromCharCode(0xd83d);
      const input = `Valid text 日本語 ${badHigh} more valid 🎉 end`;
      expect(sanitizeUnicodeSurrogates(input)).toBe(
        "Valid text 日本語 \ufffd more valid 🎉 end",
      );
    });

    it("should handle boundary surrogate values", () => {
      const minHigh = String.fromCharCode(0xd800);
      const maxHigh = String.fromCharCode(0xdbff);
      const minLow = String.fromCharCode(0xdc00);
      const maxLow = String.fromCharCode(0xdfff);

      expect(sanitizeUnicodeSurrogates(minHigh)).toBe("\ufffd");
      expect(sanitizeUnicodeSurrogates(maxHigh)).toBe("\ufffd");
      expect(sanitizeUnicodeSurrogates(minLow)).toBe("\ufffd");
      expect(sanitizeUnicodeSurrogates(maxLow)).toBe("\ufffd");

      expect(sanitizeUnicodeSurrogates(`${minHigh}${minLow}`)).toBe(
        `${minHigh}${minLow}`,
      );
      expect(sanitizeUnicodeSurrogates(`${maxHigh}${maxLow}`)).toBe(
        `${maxHigh}${maxLow}`,
      );
    });

    it("should handle long strings with scattered invalid surrogates", () => {
      const unpairedHigh = String.fromCharCode(0xd800);
      const unpairedLow = String.fromCharCode(0xdc00);
      const chunks = [
        "Start of document.",
        unpairedHigh,
        " Some middle content.",
        unpairedLow,
        " More content here.",
        unpairedHigh,
        " End of document.",
      ];
      const input = chunks.join("");
      const expected =
        "Start of document.\ufffd Some middle content.\ufffd More content here.\ufffd End of document.";
      expect(sanitizeUnicodeSurrogates(input)).toBe(expected);
    });

    it("should preserve adjacent high+low as valid pair even in mixed context", () => {
      const high = String.fromCharCode(0xd800);
      const low = String.fromCharCode(0xdc00);
      const validPair = `${high}${low}`;
      const input = `Text ${high} orphan, then valid pair: ${validPair} end`;
      expect(sanitizeUnicodeSurrogates(input)).toBe(
        `Text \ufffd orphan, then valid pair: ${validPair} end`,
      );
    });
  });

  describe("literal syntax and complex sequences", () => {
    it("should handle mixed valid and invalid surrogates using literals", () => {
      const input = "A\uD800B\uD83D\uDE00C\uDC00D";
      expect(sanitizeUnicodeSurrogates(input)).toBe(
        "A\uFFFDB\uD83D\uDE00C\uFFFDD",
      );
    });

    it("should handle surrogate pair followed by lone high surrogate", () => {
      const input = "😀\uD800";
      expect(sanitizeUnicodeSurrogates(input)).toBe("😀\uFFFD");
    });

    it("should handle lone high surrogate followed by valid surrogate pair", () => {
      const input = "\uD801\uD800\uDC00";
      expect(sanitizeUnicodeSurrogates(input)).toBe("\uFFFD\uD800\uDC00");
    });

    it("should handle multiple lone surrogates in a row", () => {
      const input = "\uD800\uDC00\uD801";
      expect(sanitizeUnicodeSurrogates(input)).toBe("\uD800\uDC00\uFFFD");
    });
  });
});

describe("startRerankerService", () => {
  const requestedExecutionProviders: string[][] = [];

  const sessionStub = {
    run: async () => ({ logits: { data: new Float32Array([0.5]) } }),
    release: async () => {},
  } as unknown as InferenceSession;

  /** The message onnxruntime-node throws when Dawn finds no GPU adapter. */
  const webGpuAdapterError = new Error(
    "Failed to get a WebGPU adapter: No supported adapters",
  );

  function mockSessionCreation(
    respond: (executionProviders: string[]) => Promise<InferenceSession>,
  ) {
    vi.mocked(InferenceSession.create).mockImplementation(((
      _modelPath: string,
      options: { executionProviders: string[] },
    ) => {
      requestedExecutionProviders.push(options.executionProviders);
      return respond(options.executionProviders);
    }) as unknown as typeof InferenceSession.create);
  }

  beforeEach(() => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => "{}");
  });

  afterEach(async () => {
    await stopRerankerService();
    requestedExecutionProviders.length = 0;
    vi.restoreAllMocks();
  });

  it("keeps the preferred providers when the session loads", async () => {
    mockSessionCreation(async () => sessionStub);

    await startRerankerService();

    expect(requestedExecutionProviders).toEqual([["webgpu", "cpu"]]);
    expect(await getRerankerStatus()).toBe(true);
  });

  it("retries on CPU when the WebGPU provider fails to initialize", async () => {
    mockSessionCreation(async (executionProviders) => {
      if (executionProviders.includes("webgpu")) throw webGpuAdapterError;
      return sessionStub;
    });

    await startRerankerService();

    expect(requestedExecutionProviders).toEqual([["webgpu", "cpu"], ["cpu"]]);
    expect(await getRerankerStatus()).toBe(true);
  });

  it("stays unready when CPU fails too", async () => {
    const cpuError = new Error("Protobuf parsing failed");
    mockSessionCreation(async (executionProviders) => {
      throw executionProviders.includes("webgpu")
        ? webGpuAdapterError
        : cpuError;
    });

    await expect(startRerankerService()).rejects.toThrow(cpuError);
    expect(await getRerankerStatus()).toBe(false);
  });
});
