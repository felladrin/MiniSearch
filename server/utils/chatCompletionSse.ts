import type { ServerResponse } from "node:http";
import { safeEndResponse, safeWriteResponse } from "./streamUtils.ts";

interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model?: string;
  choices: Array<{
    index: number;
    delta: { content?: string };
    finish_reason: string | null;
  }>;
}

/** One OpenAI `chat.completion.chunk`; the last one of an answer carries the `finish_reason`. */
export function createChunkPayload(
  model: string,
  content?: string,
  finish_reason: string | null = null,
): ChatCompletionChunk {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason,
      },
    ],
  };
}

function ensureSseHeaders(response: ServerResponse): void {
  if (response.headersSent) return;

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "keep-alive");
}

/** Writes one `data:` event, sending the stream headers first if nothing went out yet. */
export function sendSseData(response: ServerResponse, data: unknown): void {
  ensureSseHeaders(response);
  safeWriteResponse(response, `data: ${JSON.stringify(data)}\n\n`);
}

/** Ends the stream the way OpenAI does, with `data: [DONE]`. */
export function sendSseDone(response: ServerResponse): void {
  safeWriteResponse(response, "data: [DONE]\n\n");
  safeEndResponse(response);
}

/** Reports a failure inside an open stream, where an HTTP status can no longer change. */
export function sendSseError(
  response: ServerResponse,
  message: string,
  model?: string,
): void {
  sendSseData(response, {
    error: message,
    ...(model ? { model } : {}),
  });
  sendSseDone(response);
}
