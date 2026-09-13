import fs from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dictationModelServerHook } from "./dictationModelServerHook.ts";

type Middleware = (
  request: { url?: string },
  response: ServerResponse,
  next: () => void,
) => Promise<void> | void;

let modelsDir: string;
let handler: Middleware;
const originalModelsDirEnv = process.env.DICTATION_MODELS_DIR;

/**
 * Drives the hook through a real `node:http` server. The files are streamed,
 * so a mocked response with its own `end` would never exercise the path that
 * serves them. Uses `http.request` rather than `fetch`, because these tests
 * stub global `fetch` to control the upstream download.
 */
async function call(url: string) {
  const server: Server = createServer((request, response) => {
    void handler({ url: request.url } as IncomingMessage, response, () => {
      response.statusCode = 404;
      response.end("next");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    return await new Promise<{
      statusCode: number;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }>((resolve, reject) => {
      const outgoing = httpRequest({ port, path: url }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            statusCode: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          }),
        );
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => {
  modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dictation-models-test-"));
  process.env.DICTATION_MODELS_DIR = modelsDir;

  let captured: Middleware | undefined;
  const fakeServer = {
    middlewares: {
      use(middleware: Middleware) {
        captured = middleware;
      },
    },
  };
  dictationModelServerHook(fakeServer as never);
  handler = captured as Middleware;
});

afterEach(() => {
  if (originalModelsDirEnv === undefined) {
    delete process.env.DICTATION_MODELS_DIR;
  } else {
    process.env.DICTATION_MODELS_DIR = originalModelsDirEnv;
  }
  fs.rmSync(modelsDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/**
 * The real published `streaming_config.json`, byte for byte. The hook verifies
 * every download against a pinned SHA-256, so a made-up payload is refused,
 * which is the point of the digest.
 */
const REAL_STREAMING_CONFIG =
  '{\n  "encoder_dim": 320,\n  "decoder_dim": 320,\n  "depth": 6,\n  "nheads": 8,\n  "head_dim": 40,\n  "vocab_size": 32768,\n  "bos_id": 1,\n  "eos_id": 2,\n  "frame_len": 80,\n  "total_lookahead": 16,\n  "d_model_frontend": 320,\n  "c1": 640,\n  "c2": 320,\n  "frontend_state_shapes": {\n    "sample_buffer": [\n      1,\n      79\n    ],\n    "sample_len": [\n      1\n    ],\n    "conv1_buffer": [\n      1,\n      320,\n      4\n    ],\n    "conv2_buffer": [\n      1,\n      640,\n      4\n    ],\n    "frame_count": [\n      1\n    ]\n  }\n}';

/** Minimal `ReadableStream` stand-in for the hook's capped body reader. */
function bodyOf(bytes: Uint8Array) {
  let sent = false;
  return {
    getReader: () => ({
      read: async () => {
        if (sent) return { done: true, value: undefined };
        sent = true;
        return { done: false, value: bytes };
      },
      cancel: async () => {},
    }),
  };
}

describe("dictationModelServerHook", () => {
  it("passes through requests that are not for the model route", async () => {
    const response = await call("/search?q=hello");
    // The server's own fall-through handler answers, not the hook.
    expect(response.body.toString()).toBe("next");
  });

  it("rejects filenames outside the whitelist with a 404", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Normalises to `/etc/passwd`, leaving nothing after the route prefix.
    const traversed = await call("/dictation-models/../etc/passwd");
    expect(traversed.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    // Normalises back onto a whitelisted name, which is the case that really
    // exercises the prefix slice rather than the empty remainder.
    const normalised = await call("/dictation-models/a/../encoder.ort");
    expect(normalised.statusCode).not.toBe(404);
  });

  it("downloads a whitelisted file once and caches it on disk", async () => {
    const payload = new TextEncoder().encode(REAL_STREAMING_CONFIG);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: bodyOf(payload),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await call("/dictation-models/streaming_config.json");
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual(Buffer.from(payload));
    expect(first.headers["content-length"]).toBe(String(payload.byteLength));
    expect(fs.existsSync(path.join(modelsDir, "streaming_config.json"))).toBe(
      true,
    );

    const second = await call("/dictation-models/streaming_config.json");
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual(Buffer.from(payload));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a file whose digest does not match the pinned one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: bodyOf(new TextEncoder().encode("not the published file")),
      }),
    );

    const response = await call("/dictation-models/streaming_config.json");
    expect(response.statusCode).toBe(502);
    expect(response.body.toString()).toContain("pinned digest");
    // A file that failed verification must not be left in the cache.
    expect(fs.existsSync(path.join(modelsDir, "streaming_config.json"))).toBe(
      false,
    );
  });

  it("serves the streaming config as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: bodyOf(new TextEncoder().encode(REAL_STREAMING_CONFIG)),
      }),
    );

    const response = await call("/dictation-models/streaming_config.json");
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.body.toString()).toBe(REAL_STREAMING_CONFIG);
  });

  it("returns a 502 when the upstream download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    const response = await call("/dictation-models/encoder.ort");
    expect(response.statusCode).toBe(502);
    expect(fs.existsSync(path.join(modelsDir, "encoder.ort"))).toBe(false);
  });
});
