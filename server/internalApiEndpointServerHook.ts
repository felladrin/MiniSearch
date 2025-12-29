import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type ModelMessage, streamText } from "ai";
import type { PreviewServer, ViteDevServer } from "vite";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels";
import { handleTokenVerification } from "./handleTokenVerification";
import {
  calculateBackoffTime,
  isResponseWritable,
  safeEndResponse,
  safeWriteResponse,
} from "./utils/streamUtils";

interface ChatCompletionRequestBody {
  messages: ModelMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
}

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

function createChunkPayload(
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

function sendJsonError(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  if (response.headersSent) {
    safeEndResponse(response);
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  safeEndResponse(response, JSON.stringify(payload));
}

function sendSseData(response: ServerResponse, data: unknown): void {
  safeWriteResponse(response, `data: ${JSON.stringify(data)}\n\n`);
}

function sendSseDone(response: ServerResponse): void {
  safeWriteResponse(response, "data: [DONE]\n\n");
  safeEndResponse(response);
}

function sendSseError(
  response: ServerResponse,
  message: string,
  model?: string,
): void {
  if (!response.headersSent) {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
  }

  sendSseData(response, {
    error: message,
    ...(model ? { model } : {}),
  });
  sendSseDone(response);
}

function hasJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string") return false;
  return contentType.toLowerCase().includes("application/json");
}

export function internalApiEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(
    async (
      request: IncomingMessage,
      response: ServerResponse,
      next: () => void,
    ) => {
      if (!request.url) {
        sendJsonError(response, 400, { error: "Bad Request: URL is required" });
        return;
      }

      if (!request.url.startsWith("/inference")) {
        return next();
      }

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJsonError(response, 405, { error: "Method Not Allowed" });
        return;
      }

      if (!hasJsonContentType(request)) {
        sendJsonError(response, 415, { error: "Unsupported Media Type" });
        return;
      }

      const hostHeader = request.headers.host;
      const baseUrl =
        typeof hostHeader === "string" && hostHeader.length > 0
          ? `http://${hostHeader}`
          : "http://localhost";
      const url = new URL(request.url, baseUrl);
      const token = url.searchParams.get("token");
      const { shouldContinue } = await handleTokenVerification(token, response);
      if (!shouldContinue) return;

      if (
        !process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL ||
        !process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY
      ) {
        sendJsonError(response, 500, {
          error: "OpenAI API configuration is missing",
        });
        return;
      }

      try {
        let requestBody: ChatCompletionRequestBody;
        try {
          const maxBodyBytes = 1024 * 1024;
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          for await (const chunk of request) {
            let buf: Buffer;
            if (typeof chunk === "string") {
              buf = Buffer.from(chunk);
            } else if (chunk instanceof Uint8Array) {
              buf = Buffer.from(chunk);
            } else {
              sendJsonError(response, 400, {
                error: "Invalid request body stream",
              });
              return;
            }
            totalBytes += buf.length;
            if (totalBytes > maxBodyBytes) {
              sendJsonError(response, 413, { error: "Request body too large" });
              return;
            }
            chunks.push(buf);
          }
          requestBody = JSON.parse(Buffer.concat(chunks).toString());
        } catch (_error) {
          sendJsonError(response, 400, { error: "Invalid request body" });
          return;
        }

        if (!Array.isArray(requestBody.messages)) {
          sendJsonError(response, 400, {
            error: "Invalid request body: messages is required",
          });
          return;
        }

        const openaiProvider = createOpenAICompatible({
          baseURL: process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
          apiKey: process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
          name: "openai",
        });

        let model = process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL;
        let availableModels: { id: string }[] = [];
        const attemptedModels = new Set<string>();

        if (!model) {
          try {
            availableModels = await listOpenAiCompatibleModels(
              process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
              process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
            );
            const selectedModel = selectRandomModel(availableModels);
            model = selectedModel || undefined;
          } catch (error) {
            console.error("Error fetching models:", error);
            sendJsonError(response, 500, {
              error: "Failed to fetch available models",
            });
            return;
          }
        }

        if (!model) {
          sendJsonError(response, 500, { error: "No model available" });
          return;
        }

        const maxAttempts = 5;
        let lastError: unknown = null;
        let hasStartedStreaming = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (!model) break;
          attemptedModels.add(model);

          if (!isResponseWritable(response)) {
            return;
          }

          if (!hasStartedStreaming) {
            response.setHeader("Content-Type", "text/event-stream");
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("Connection", "keep-alive");
            hasStartedStreaming = true;
          }

          try {
            const stream = streamText({
              model: openaiProvider.chatModel(model),
              messages: requestBody.messages,
              temperature: requestBody.temperature,
              topP: requestBody.top_p,
              frequencyPenalty: requestBody.frequency_penalty,
              presencePenalty: requestBody.presence_penalty,
              maxOutputTokens: requestBody.max_tokens,
              maxRetries: 0,
            });

            for await (const part of stream.fullStream) {
              if (!isResponseWritable(response)) return;

              if (part.type === "text-delta") {
                sendSseData(response, createChunkPayload(model, part.text));
              } else if (part.type === "finish") {
                sendSseData(
                  response,
                  createChunkPayload(model, undefined, "stop"),
                );
                sendSseDone(response);
                return;
              }
            }

            sendSseError(response, "Stream ended unexpectedly", model);
            return;
          } catch (error) {
            lastError = error;
            console.error("Error during streaming:", error);

            if (attempt >= maxAttempts) break;

            if (
              availableModels.length === 0 &&
              !process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL
            ) {
              try {
                availableModels = await listOpenAiCompatibleModels(
                  process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
                  process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
                );
              } catch (refetchError) {
                console.warn("Failed to refetch models:", refetchError);
              }
            }

            const nextModel = selectRandomModel(
              availableModels,
              attemptedModels,
            );
            if (!nextModel) break;
            model = nextModel;

            const backoffMs = calculateBackoffTime(attempt);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }

        const lastErrorMessage =
          lastError instanceof Error ? lastError.message : "Unknown error";

        if (!hasStartedStreaming) {
          sendJsonError(response, 503, {
            error: "Service unavailable - all models failed",
            lastError: lastErrorMessage,
          });
          return;
        }

        sendSseError(
          response,
          `Service unavailable - all models failed: ${lastErrorMessage}`,
          model,
        );
      } catch (error) {
        console.error("Error in internal API endpoint:", error);
        sendJsonError(response, 500, {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
}
