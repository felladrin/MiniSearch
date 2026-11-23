import type { ServerResponse } from "node:http";

/**
 * Reads at most `maxBytes` of a fetch response body. A hostile or merely huge
 * upstream must not be able to pin the server's memory, and callers that only
 * need the head of a document (page text, thumbnails) gain nothing from the
 * tail anyway.
 */
export async function readCappedBytes(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          bytesRead = maxBytes;
        }
        truncated = true;
        break;
      }
      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

export function calculateBackoffTime(
  attempt: number,
  baseDelayMs = 100,
  maxDelayMs = 5000,
): number {
  const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return delay * (0.7 + Math.random() * 0.3);
}

export function isResponseWritable(response: ServerResponse): boolean {
  return !response.writableEnded && !response.destroyed;
}

export function safeWriteResponse(
  response: ServerResponse,
  data: string,
): boolean {
  if (!isResponseWritable(response)) return false;

  try {
    return response.write(data);
  } catch (error) {
    console.error("Failed to write to response:", error);
    return false;
  }
}

export function safeEndResponse(response: ServerResponse, data?: string): void {
  if (response.writableEnded || response.destroyed) return;

  try {
    if (data) {
      response.end(data);
    } else {
      response.end();
    }
  } catch (error) {
    console.error("Failed to end response:", error);
    response.destroy();
  }
}
