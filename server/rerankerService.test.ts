import fs from "node:fs";
import { Tokenizer } from "@huggingface/tokenizers";
import { InferenceSession } from "onnxruntime-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRerankerStatus,
  rerank,
  sanitizeUnicodeSurrogates,
  startRerankerService,
  stopRerankerService,
  truncatePairTokens,
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
  Tensor: class {
    type: string;
    data: unknown;
    dims: number[];
    constructor(type: string, data: unknown, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
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

  function mockSessionCreation(respond: () => Promise<InferenceSession>) {
    vi.mocked(InferenceSession.create).mockImplementation(((
      _modelPath: string,
      options: { executionProviders: string[] },
    ) => {
      requestedExecutionProviders.push(options.executionProviders);
      return respond();
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

  // No GPU provider is requested: the quantized graph has no integer-matmul
  // kernels there and falls back operator by operator, which is slower than
  // running on CPU outright.
  it("creates a single CPU session and reports ready", async () => {
    mockSessionCreation(async () => sessionStub);

    await startRerankerService();

    expect(requestedExecutionProviders).toEqual([["cpu"]]);
    expect(await getRerankerStatus()).toBe(true);
  });

  it("stays unready when the session cannot be created", async () => {
    const loadError = new Error("Protobuf parsing failed");
    mockSessionCreation(async () => {
      throw loadError;
    });

    await expect(startRerankerService()).rejects.toThrow(loadError);
    expect(requestedExecutionProviders).toEqual([["cpu"]]);
    expect(await getRerankerStatus()).toBe(false);
  });
});

describe("rerank", () => {
  let runMock: ReturnType<typeof vi.fn>;
  let encodeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => "{}");
    encodeSpy = vi.spyOn(Tokenizer.prototype, "encode");
    runMock = vi.fn().mockResolvedValue({
      logits: { data: new Float32Array([0.5]) },
    });
    vi.mocked(InferenceSession.create).mockResolvedValue({
      run: runMock,
      release: async () => {},
    } as unknown as InferenceSession);
    await startRerankerService();
    // startRerankerService runs one warm-up score("test", ["test document"]);
    // clear it so per-test call-count assertions start from zero.
    runMock.mockClear();
    encodeSpy.mockClear();
  });

  afterEach(async () => {
    await stopRerankerService();
    vi.restoreAllMocks();
  });

  it("returns an empty array without calling the model when there are no documents", async () => {
    expect(await rerank("query", [])).toEqual([]);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns an empty array for null or undefined documents", async () => {
    expect(await rerank("query", null as unknown as string[])).toEqual([]);
    expect(await rerank("query", undefined as unknown as string[])).toEqual([]);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("throws when the service is not ready", async () => {
    await stopRerankerService();
    await expect(rerank("query", ["doc"])).rejects.toThrow(
      "Reranker service is not ready",
    );
  });

  it("maps each score to its document index and preserves input order", async () => {
    // Non-monotonic scores: the result must stay in input order, not be
    // sorted by relevance (sorting/filtering lives in rankSearchResults).
    for (const score of [0.5, 0.3, 0.8]) {
      runMock.mockResolvedValueOnce({
        logits: { data: new Float32Array([score]) },
      });
    }

    const result = await rerank("query", ["A", "B", "C"]);

    expect(result).toEqual([
      { index: 0, relevance_score: expect.closeTo(0.5) },
      { index: 1, relevance_score: expect.closeTo(0.3) },
      { index: 2, relevance_score: expect.closeTo(0.8) },
    ]);
  });

  it("scores one document per model call and concatenates in order", async () => {
    // Give every document a unique score equal to its position, so a dropped,
    // duplicated, or reordered call would break the assertions.
    let nextScore = 0;
    runMock.mockImplementation(async () => ({
      logits: { data: new Float32Array([nextScore++]) },
    }));

    const documents = Array.from({ length: 25 }, (_, i) => `doc ${i}`);
    const result = await rerank("query", documents);

    expect(runMock).toHaveBeenCalledTimes(25);
    expect(result).toHaveLength(25);
    expect(result[0]).toEqual({ index: 0, relevance_score: 0 });
    expect(result[24]).toEqual({ index: 24, relevance_score: 24 });
  });

  // The scores of a dynamically quantized graph depend on the whole tensor's
  // range, so a padded row would let one document's score shift another's.
  it("sends one unpadded row per call, with every position attended to", async () => {
    await rerank("query", ["A", "B"]);

    expect(runMock).toHaveBeenCalledTimes(2);
    for (const [inputs] of runMock.mock.calls) {
      const { input_ids, attention_mask } = inputs as {
        input_ids: { dims: number[]; data: BigInt64Array };
        attention_mask: { dims: number[]; data: BigInt64Array };
      };
      expect(input_ids.dims).toEqual([1, 3]);
      expect(Array.from(input_ids.data)).toEqual([1n, 2n, 3n]);
      expect(attention_mask.dims).toEqual([1, 3]);
      expect(Array.from(attention_mask.data)).toEqual([1n, 1n, 1n]);
    }
  });

  it("sanitizes unpaired surrogates in the query and documents before tokenizing", async () => {
    const loneHighSurrogate = String.fromCharCode(0xd800);

    await rerank(`query${loneHighSurrogate}`, [`doc${loneHighSurrogate}`]);

    // The lone surrogate must reach the tokenizer as U+FFFD, never raw: this
    // proves sanitization runs on the real path, not just that the model was hit.
    const [query, options] = encodeSpy.mock.calls[0];
    expect(query).toBe("query\ufffd");
    expect((options as { text_pair: string }).text_pair).toBe("doc\ufffd");
  });
});

describe("truncatePairTokens", () => {
  // Sequence layout: <s> q q </s> </s> | d d d d </s>
  const ids = [0, 11, 12, 2, 2, 21, 22, 23, 24, 2];

  it("returns the ids unchanged when within budget", () => {
    expect(truncatePairTokens(ids, 20)).toBe(ids);
  });

  it("drops document tokens from the end, keeping the query and trailing separator", () => {
    const out = truncatePairTokens(ids, 7);

    expect(out).toHaveLength(7);
    expect(out.slice(0, 5)).toEqual([0, 11, 12, 2, 2]); // query segment intact
    expect(out.at(-1)).toBe(2); // trailing separator preserved
    expect(out).toEqual([0, 11, 12, 2, 2, 21, 2]);
  });

  it("keeps a well-formed pair even when the query alone exceeds the budget", () => {
    expect(truncatePairTokens(ids, 3)).toEqual([0, 11, 2]);
  });

  it("never exceeds the position-embedding limit the model was built with", () => {
    const overLong = Array.from({ length: 900 }, (_, index) => index);

    expect(truncatePairTokens(overLong, 512)).toHaveLength(512);
  });
});
