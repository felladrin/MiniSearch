import type { IncomingMessage } from "node:http";

export type JsonBody =
  | { status: "ok"; value: unknown }
  | { status: "tooLarge" }
  | { status: "invalid" };

/**
 * Reads and parses a JSON request body, stopping as soon as it passes
 * `maxBytes`. It never rejects: a body that is too large, is not JSON, or
 * whose stream errors comes back as a status for the caller to answer.
 */
export function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<JsonBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > maxBytes) {
        settled = true;
        resolve({ status: "tooLarge" });
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve({
          status: "ok",
          value: JSON.parse(Buffer.concat(chunks).toString()),
        });
      } catch {
        resolve({ status: "invalid" });
      }
    });
    request.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ status: "invalid" });
    });
  });
}
