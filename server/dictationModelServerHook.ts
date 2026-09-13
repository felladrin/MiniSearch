import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PreviewServer, ViteDevServer } from "vite";
import { isResponseWritable, safeEndResponse } from "./utils/streamUtils.ts";

const ROUTE_PREFIX = "/dictation-models/";

/**
 * Pinned upstream location of the streaming English model (MIT-licensed).
 * The browser fetches these from this instance rather than from
 * `download.moonshine.ai`, so the page makes no third-party requests; the
 * server downloads each file once and caches it on disk.
 */
const UPSTREAM_BASE_URL =
  "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_07_30";

/**
 * Whitelist of servable files. Requests for files outside this map get a
 * 404, so the route cannot be turned into an open proxy against the
 * upstream host.
 */
const MODEL_FILES = new Set([
  "adapter.ort",
  "cross_kv.ort",
  "decoder_kv.ort",
  "encoder.ort",
  "frontend.ort",
  "streaming_config.json",
  "tokenizer.bin",
]);

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

async function downloadModelFile(fileName: string): Promise<void> {
  const modelsDirectory = getModelsDirectory();
  const filePath = path.join(modelsDirectory, fileName);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  fs.mkdirSync(modelsDirectory, { recursive: true });

  const response = await fetch(`${UPSTREAM_BASE_URL}/${fileName}`);
  if (!response.ok) {
    throw new Error(`Upstream responded ${response.status} for ${fileName}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  fs.writeFileSync(temporaryPath, bytes);
  fs.renameSync(temporaryPath, filePath);
}

/** Serves the file from the disk cache, downloading it once if it is missing. */
async function ensureModelFileOnDisk(fileName: string): Promise<string> {
  const filePath = path.join(getModelsDirectory(), fileName);
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
      // Streamed rather than read whole: `encoder.ort` alone is tens of
      // megabytes, and buffering it per request lets a handful of concurrent
      // callers pin that much memory each.
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        stream.on("error", reject);
        response.on("close", resolve);
        stream.pipe(response).on("finish", resolve);
      });
    } catch (error) {
      response.statusCode = 502;
      safeEndResponse(
        response,
        `Could not serve ${fileName}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  });
}
