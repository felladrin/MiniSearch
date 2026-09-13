import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { PreviewServer, ViteDevServer } from "vite";
import {
  DICTATION_MODEL_VERSION as MODEL_VERSION,
  DICTATION_MODELS_ROUTE_PREFIX as ROUTE_PREFIX,
} from "../shared/dictationModel.ts";
import { isResponseWritable, safeEndResponse } from "./utils/streamUtils.ts";

/**
 * Pinned upstream location of the streaming English model (MIT-licensed).
 * The browser fetches these from this instance rather than from
 * `download.moonshine.ai`, so the page makes no third-party requests; the
 * server downloads each file once and caches it on disk.
 */
const UPSTREAM_BASE_URL = `https://download.moonshine.ai/model/tiny-streaming-en/${MODEL_VERSION}`;

/**
 * Whitelist of servable files, each with the SHA-256 it must match. A request
 * outside this map gets a 404, so the route cannot be turned into an open proxy
 * against the upstream host.
 *
 * The digests are from the download this feature was verified against, which is
 * trust-on-first-use: the same guarantee a lockfile integrity hash gives. It
 * does not prove the upstream is honest, it pins the artifact that was actually
 * reviewed, so a later change under a path segment named `quantized_26_07_30`
 * becomes a loud failure instead of a silent swap.
 */
const MODEL_FILES = new Map([
  [
    "adapter.ort",
    "22ecc949e146c49667fda28d102d4e30749a107dc88a396292aa8f277ef1347c",
  ],
  [
    "cross_kv.ort",
    "143a36667b8d05fd9d04e8c337b7ee121f37ef299aea6b3d82bdb3d3401950b4",
  ],
  [
    "decoder_kv.ort",
    "8852553f312adb6c9aa4d17418015049b30f412209ee569d336548c0044627de",
  ],
  [
    "encoder.ort",
    "a8414e1a5dedf9f2093d7680601dd8a9b0433e7020260eafe0e370ead91134ca",
  ],
  [
    "frontend.ort",
    "271a563251f11e6311949530f8025ed4d345c5d69d4ac1efa74093779927d636",
  ],
  [
    "streaming_config.json",
    "74fe5ddebd63b17caf59e8a3b18c17547ff7bce1642050edbb1c3962674f8950",
  ],
  [
    "tokenizer.bin",
    "6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d",
  ],
]);

/** The largest file is ~32 MB, so this bounds a body the upstream mis-sizes. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function getModelsDirectory(): string {
  return (
    process.env.DICTATION_MODELS_DIR ??
    path.join(os.tmpdir(), "minisearch-dictation-models")
  );
}

/**
 * Downloads that are already running, so concurrent first presses of the
 * dictation button share one transfer per file instead of racing to write
 * the same cache entry.
 */
const downloadsInProgress = new Map<string, Promise<void>>();

/** Reads the body with a ceiling, so a mis-sized upstream cannot exhaust memory. */
async function readCappedBody(
  response: Response,
  fileName: string,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) throw new Error(`Upstream sent no body for ${fileName}`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new Error(
        `${fileName} is larger than the ${MAX_FILE_BYTES} byte cap`,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadModelFile(fileName: string): Promise<void> {
  // Versioned on disk as well as in the route: a flat cache would serve the
  // previous model under a new versioned URL, with `immutable` headers and the
  // digest check skipped because the file already exists.
  const modelsDirectory = path.join(getModelsDirectory(), MODEL_VERSION);
  const filePath = path.join(modelsDirectory, fileName);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  fs.mkdirSync(modelsDirectory, { recursive: true });

  const response = await fetch(`${UPSTREAM_BASE_URL}/${fileName}`);
  if (!response.ok) {
    throw new Error(`Upstream responded ${response.status} for ${fileName}`);
  }

  const bytes = await readCappedBody(response, fileName);

  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const expected = MODEL_FILES.get(fileName);
  if (digest !== expected) {
    throw new Error(
      `${fileName} does not match the pinned digest (expected ${expected}, got ${digest})`,
    );
  }

  try {
    fs.writeFileSync(temporaryPath, bytes);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    // A half-written temporary file is never served, but it would sit in the
    // cache directory forever.
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** Serves the file from the disk cache, downloading it once if it is missing. */
async function ensureModelFileOnDisk(fileName: string): Promise<string> {
  const filePath = path.join(getModelsDirectory(), MODEL_VERSION, fileName);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return filePath;
  }

  const inFlight = downloadsInProgress.get(fileName);
  if (inFlight) {
    await inFlight;
    return filePath;
  }

  const download = downloadModelFile(fileName).finally(() => {
    downloadsInProgress.delete(fileName);
  });
  downloadsInProgress.set(fileName, download);
  await download;
  return filePath;
}

/**
 * Serves `/dictation-models/<file>`: the speech-to-text model files, from
 * the local disk cache when present and from the pinned upstream URL
 * otherwise. Only the whitelisted filenames resolve.
 */
export function dictationModelServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith(ROUTE_PREFIX)) return next();

    const fileName = new URL(request.url, "http://localhost").pathname.slice(
      ROUTE_PREFIX.length,
    );

    if (!MODEL_FILES.has(fileName)) {
      response.statusCode = 404;
      safeEndResponse(response, "Unknown dictation model file");
      return;
    }

    try {
      const filePath = await ensureModelFileOnDisk(fileName);
      if (!isResponseWritable(response)) return;

      // Opened before any header is written: a failure here must still be
      // answerable as a 502, and a `Content-Length` already on the response
      // would leave the client waiting for a body that never comes.
      const fileStream = fs.createReadStream(filePath);
      await new Promise<void>((resolve, reject) => {
        fileStream.once("open", () => resolve());
        fileStream.once("error", reject);
      });

      response.statusCode = 200;
      response.setHeader(
        "Content-Type",
        fileName.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
      );
      response.setHeader("Content-Length", String(fs.statSync(filePath).size));
      // The upstream files are pinned by an immutable version segment, so
      // the browser may keep them for a very long time; the worker's Cache
      // API entry is keyed by this URL and only refetched if it is evicted.
      response.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
      // Streamed rather than read whole: `decoder_kv.ort` alone is 32 MB, and
      // buffering it per request lets a handful of concurrent callers pin that
      // much memory each. `pipeline` destroys the file stream when the client
      // aborts, which a bare `pipe` would leave open.
      await pipeline(fileStream, response);
    } catch (error) {
      // Once the body has started the headers are gone, so the best that can be
      // done is to stop rather than append an error to a truncated file.
      if (response.headersSent) {
        safeEndResponse(response);
        return;
      }
      response.statusCode = 502;
      safeEndResponse(
        response,
        `Could not serve ${fileName}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  });
}
