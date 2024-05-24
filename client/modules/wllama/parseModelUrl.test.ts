import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseModelUrl } from "./parseModelUrl";

describe("function parseModelUrl", () => {
  it("converts a URL of a single part of a split GGUF into an array of URLs", () => {
    const parsedUrl = parseModelUrl(
      "https://example.com/userId/modelId/resolve/main/model-00001-of-00004.gguf",
    );

    assert.deepEqual(parsedUrl, [
      "https://example.com/userId/modelId/resolve/main/model-00001-of-00004.gguf",
      "https://example.com/userId/modelId/resolve/main/model-00002-of-00004.gguf",
      "https://example.com/userId/modelId/resolve/main/model-00003-of-00004.gguf",
      "https://example.com/userId/modelId/resolve/main/model-00004-of-00004.gguf",
    ]);
  });

  it("converts a URL of a single part of a split GGUF into an array of URLs independently of the part number provided", () => {
    const parsedUrl = parseModelUrl(
      "https://example.com/models/model-00002-of-00003.gguf",
    );

    assert.deepEqual(parsedUrl, [
      "https://example.com/models/model-00001-of-00003.gguf",
      "https://example.com/models/model-00002-of-00003.gguf",
      "https://example.com/models/model-00003-of-00003.gguf",
    ]);
  });

  it("returns the same URL if URL provided is not from a split GGUF", () => {
    const parsedUrl = parseModelUrl(
      "https://example.com/userId/modelId/resolve/main/model.gguf",
    );

    assert.equal(
      parsedUrl,
      "https://example.com/userId/modelId/resolve/main/model.gguf",
    );
  });
});
