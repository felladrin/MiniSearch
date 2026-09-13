import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
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

function makeResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "" as string | Buffer,
    ended: false,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    write(chunk: string | Buffer) {
      this.body = chunk;
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) this.body = chunk;
      this.ended = true;
    },
    get writableEnded() {
      return this.ended;
    },
    get destroyed() {
      return false;
    },
  };
  return response as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    body: string | Buffer;
    ended: boolean;
  };
}

async function call(url: string) {
  const response = makeResponse();
  const next = vi.fn();
  await handler(
    { url } as IncomingMessage,
    response as unknown as ServerResponse,
    next,
  );
  return { response, next };
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

describe("dictationModelServerHook", () => {
  it("passes through requests that are not for the model route", async () => {
    const { response, next } = await call("/search?q=hello");
    expect(next).toHaveBeenCalled();
    expect(response.ended).toBe(false);
  });

  it("rejects filenames outside the whitelist with a 404", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { response, next } = await call("/dictation-models/../etc/passwd");
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads a whitelisted file once and caches it on disk", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => payload.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await call("/dictation-models/tokenizer.bin");
    expect(first.response.statusCode).toBe(200);
    expect(Buffer.from(first.response.body as Buffer)).toEqual(
      Buffer.from(payload),
    );
    expect(first.response.headers["Content-Type"]).toBe(
      "application/octet-stream",
    );
    expect(fs.existsSync(path.join(modelsDir, "tokenizer.bin"))).toBe(true);

    const second = await call("/dictation-models/tokenizer.bin");
    expect(second.response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the streaming config as JSON", async () => {
    const config = JSON.stringify({ sample_rate: 16000 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(config).buffer,
      }),
    );

    const { response } = await call("/dictation-models/streaming_config.json");
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(String(response.body)).toBe(config);
  });

  it("returns a 502 when the upstream download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    const { response } = await call("/dictation-models/encoder.ort");
    expect(response.statusCode).toBe(502);
    expect(fs.existsSync(path.join(modelsDir, "encoder.ort"))).toBe(false);
  });
});
