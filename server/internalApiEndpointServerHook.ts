import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels.ts";
import { getModelConfig } from "./config/modelConfig.ts";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import {
  calculateBackoffTime,
  isResponseWritable,
  safeEndResponse,
  safeWriteResponse,
} from "./utils/streamUtils.ts";

const chatCompletionRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
});

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

function ensureSseHeaders(response: ServerResponse): void {
  if (response.headersSent) return;

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
}

function sendSseData(response: ServerResponse, data: unknown): void {
  ensureSseHeaders(response);
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

/** Self-hosted `/inference` endpoint: streams an OpenAI-compatible chat completion from the internal API, retrying across models. */
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
      const { shouldContinue } = await handleTokenVerification(
        token,
        response,
        request,
      );
      if (!shouldContinue) return;

      try {
        let rawRequestBody: unknown;
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
          rawRequestBody = JSON.parse(Buffer.concat(chunks).toString());
        } catch (_error) {
          sendJsonError(response, 400, { error: "Invalid request body" });
          return;
        }

        const parsedRequestBody =
          chatCompletionRequestSchema.safeParse(rawRequestBody);
        if (!parsedRequestBody.success) {
          const issue = parsedRequestBody.error.issues[0];
          sendJsonError(response, 400, {
            error: `Invalid request body: ${issue.path.join(".") || "body"} ${issue.message}`,
          });
          return;
        }
        const requestBody = parsedRequestBody.data;

        if (
          !process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL ||
          !process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY
        ) {
          sendJsonError(response, 500, {
            error: "OpenAI API configuration is missing",
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
            console.error(
              "Error fetching models:",
              error instanceof Error ? error.message : error,
            );
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

        const config = getModelConfig();
        const maxAttempts = 5;
        let lastError: unknown = null;

        const clampedMaxTokens =
          requestBody.max_tokens !== undefined
            ? Math.min(requestBody.max_tokens, config.defaultMaxTokens)
            : undefined;
        const clampedTemperature =
          requestBody.temperature !== undefined
            ? Math.max(0, Math.min(requestBody.temperature, 2))
            : undefined;
        const clampedTopP =
          requestBody.top_p !== undefined
            ? Math.max(0, Math.min(requestBody.top_p, 1))
            : undefined;

        let hasEmittedContent = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (!model) break;
          attemptedModels.add(model);

          if (!isResponseWritable(response)) {
            return;
          }

          try {
            const result = streamText({
              model: openaiProvider.chatModel(model),
              messages: requestBody.messages,
              temperature: clampedTemperature,
              topP: clampedTopP,
              maxOutputTokens: clampedMaxTokens,
              maxRetries: 0,
            });

            for await (const part of result.stream) {
              if (!isResponseWritable(response)) return;

              if (part.type === "text-delta") {
                hasEmittedContent = true;
                sendSseData(response, createChunkPayload(model, part.text));
              } else if (part.type === "error") {
                throw part.error;
              } else if (part.type === "finish") {
                sendSseData(
                  response,
                  createChunkPayload(model, undefined, "stop"),
                );
                sendSseDone(response);
                return;
              }
            }

            throw new Error("Stream ended unexpectedly");
          } catch (error) {
            lastError = error;
            console.error(
              "Error during streaming:",
              error instanceof Error ? error.message : error,
            );

            if (hasEmittedContent) break;
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
                console.warn(
                  "Failed to refetch models:",
                  refetchError instanceof Error
                    ? refetchError.message
                    : refetchError,
                );
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

        if (!response.headersSent) {
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
        console.error(
          "Error in internal API endpoint:",
          error instanceof Error ? error.message : error,
        );
        sendJsonError(response, 500, {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
}
