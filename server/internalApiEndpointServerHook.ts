import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, streamText } from "ai";
import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels.ts";
import { getModelConfig } from "./config/modelConfig.ts";
import { handleTokenVerification } from "./handleTokenVerification.ts";
import {
  type AttemptFailureReason,
  type InferenceOutcome,
  recordAttemptFailure,
  recordInference,
  recordModelAbandoned,
  recordModelAttempt,
  recordModelFailure,
  recordModelFallback,
  recordModelStreamed,
  recordModelsRefetched,
  recordStreamEndedWithoutFinish,
} from "./inferencesSinceLastRestart.ts";
import { sendJsonError } from "./utils/httpResponse.ts";
import { parseRequestUrl } from "./utils/requestUrl.ts";
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

function ensureSseHeaders(response: ServerResponse): void {
  if (response.headersSent) return;

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-store");
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

function classifyAttemptFailure(
  error: unknown,
  stalled: boolean,
): AttemptFailureReason {
  if (stalled) return "stalled";
  if (!APICallError.isInstance(error) || error.statusCode === undefined) {
    return "other";
  }
  if (error.statusCode === 429) return "rateLimited";
  return error.statusCode >= 500 ? "serverError" : "otherHttpError";
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
      if (!request.url?.startsWith("/inference")) {
        return next();
      }

      // The gate above is only cheap; the route is the exact pathname.
      if (new URL(request.url, "http://localhost").pathname !== "/inference") {
        return next();
      }

      response.setHeader("Cache-Control", "no-store");

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJsonError(response, 405, { error: "Method Not Allowed" });
        return;
      }

      if (!hasJsonContentType(request)) {
        sendJsonError(response, 415, { error: "Unsupported Media Type" });
        return;
      }

      const url = parseRequestUrl(request);
      if (!url) {
        sendJsonError(response, 400, { error: "Malformed request" });
        return;
      }
      const token = url.searchParams.get("token");
      const { shouldContinue } = await handleTokenVerification(
        token,
        response,
        request,
      );
      if (!shouldContinue) return;

      const startedAt = performance.now();
      let firstTokenMs: number | undefined;
      let attempts = 0;
      // Set on the way out of every path below. The default is the bucket that
      // means "a path stopped reporting", so a missed one is visible on
      // `/status` instead of landing in a bucket that means something else.
      let outcome: InferenceOutcome = "unclassified";

      try {
        const maxBodyBytes = 1024 * 1024;
        const body = await new Promise<
          | { status: "ok"; value: unknown }
          | { status: "tooLarge" }
          | { status: "invalid" }
        >((resolve) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          let settled = false;
          request.on("data", (chunk: Buffer | string) => {
            if (settled) return;
            totalBytes += Buffer.byteLength(chunk);
            if (totalBytes > maxBodyBytes) {
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

        if (body.status === "tooLarge") {
          outcome = "badRequest";
          response.statusCode = 413;
          response.setHeader("Content-Type", "application/json");
          // Stopping the read alone leaves the rest of the upload on the
          // socket, and a keep-alive client pooling it would read those
          // bytes as the start of its next response. Closing tells the
          // client not to pool this one.
          response.setHeader("Connection", "close");
          response.end(
            JSON.stringify({ error: "Request body too large" }),
            () => {
              // Only once the 413 is on the wire, so the answer is not
              // truncated.
              request.destroy();
            },
          );
          return;
        }
        if (body.status === "invalid") {
          outcome = "badRequest";
          sendJsonError(response, 400, { error: "Invalid request body" });
          return;
        }
        const rawRequestBody = body.value;

        const parsedRequestBody =
          chatCompletionRequestSchema.safeParse(rawRequestBody);
        if (!parsedRequestBody.success) {
          const issue = parsedRequestBody.error.issues[0];
          outcome = "badRequest";
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
          outcome = "notConfigured";
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

        const configuredModels = (
          process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL ?? ""
        )
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        // Each configured model, in order of preference, then the same list
        // once more, so a single configured model also gets one retry.
        const configuredLadder = [...configuredModels, ...configuredModels];
        let model: string | undefined = configuredModels[0];
        let availableModels: { id: string }[] = [];
        const attemptedModels = new Set<string>();
        // Set before the try so a failing `/models` endpoint does not trigger
        // another refetch on the next failed attempt.
        let hasRefetched = false;

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
            outcome = "modelListUnavailable";
            sendJsonError(response, 500, {
              error: "Failed to fetch available models",
            });
            return;
          }
        }

        if (!model) {
          outcome = "noModelAvailable";
          sendJsonError(response, 500, { error: "No model available" });
          return;
        }

        // Passed through unchecked: providers disagree on the accepted values
        // (`none`, `minimal`, `xhigh`...), and an unknown one comes back from
        // the upstream as an HTTP error in the log.
        const reasoningEffort =
          process.env.INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT?.trim();
        const providerOptions = reasoningEffort
          ? { openai: { reasoningEffort } }
          : undefined;

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
            outcome = "abandoned";
            return;
          }

          recordModelAttempt(model);
          attempts++;

          // An idle timeout bounds how long the upstream may stay silent.
          // A long answer is allowed to proceed; only a stall is cut.
          const abortController = new AbortController();
          let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;

          function resetIdleTimeout(): void {
            if (idleTimeoutId !== undefined) clearTimeout(idleTimeoutId);
            idleTimeoutId = setTimeout(
              () => abortController.abort(),
              config.requestTimeoutMs,
            );
          }

          try {
            const result = streamText({
              model: openaiProvider.chatModel(model),
              messages: requestBody.messages,
              temperature: clampedTemperature,
              topP: clampedTopP,
              maxOutputTokens: clampedMaxTokens,
              providerOptions,
              maxRetries: 0,
              abortSignal: abortController.signal,
            });

            // Arm the timer before the first part so a stall before the first
            // token is also bounded — not just the gap between parts.
            resetIdleTimeout();
            for await (const part of result.stream) {
              if (!isResponseWritable(response)) {
                outcome = "abandoned";
                recordModelAbandoned(model);
                clearTimeout(idleTimeoutId);
                return;
              }

              // Any part counts as liveness: a reasoning model may spend more
              // than requestTimeoutMs in reasoning-delta before emitting text.
              resetIdleTimeout();

              if (part.type === "text-delta") {
                if (!hasEmittedContent)
                  firstTokenMs = performance.now() - startedAt;
                hasEmittedContent = true;
                sendSseData(response, createChunkPayload(model, part.text));
              } else if (part.type === "error") {
                clearTimeout(idleTimeoutId);
                throw part.error;
              } else if (part.type === "abort") {
                // The AI SDK v7 enqueues an abort part and closes the stream
                // cleanly rather than throwing; re-throw so the catch block
                // records the failure and walks the retry ladder.
                clearTimeout(idleTimeoutId);
                throw new Error(
                  `Upstream stalled for ${config.requestTimeoutMs}ms`,
                );
              } else if (part.type === "finish") {
                clearTimeout(idleTimeoutId);
                // The SDK spells its reasons with a hyphen where OpenAI uses an
                // underscore (`content-filter`, `tool-calls`).
                sendSseData(
                  response,
                  createChunkPayload(
                    model,
                    undefined,
                    part.finishReason.replace("-", "_"),
                  ),
                );
                sendSseDone(response);
                outcome = "streamed";
                recordModelStreamed(model);
                return;
              }
            }

            clearTimeout(idleTimeoutId);
            recordStreamEndedWithoutFinish();
            throw new Error("Stream ended unexpectedly");
          } catch (error) {
            clearTimeout(idleTimeoutId);
            lastError = error;
            recordModelFailure(model);
            recordAttemptFailure(
              classifyAttemptFailure(error, abortController.signal.aborted),
            );
            console.error(
              "Error during streaming:",
              error instanceof Error ? error.message : error,
            );

            if (hasEmittedContent) break;
            if (attempt >= maxAttempts) break;

            // A provider whose pool changes mid-flight needs a fresh listing to
            // recover; without the `!hasRefetched` guard we would loop on a
            // stale list.
            if (
              configuredModels.length === 0 &&
              availableModels.every((m) => attemptedModels.has(m.id)) &&
              !hasRefetched
            ) {
              hasRefetched = true;
              try {
                availableModels = await listOpenAiCompatibleModels(
                  process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
                  process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
                );
                recordModelsRefetched();
              } catch (refetchError) {
                console.warn(
                  "Failed to refetch models:",
                  refetchError instanceof Error
                    ? refetchError.message
                    : refetchError,
                );
              }
            }

            const nextModel =
              configuredModels.length > 0
                ? configuredLadder[attempt]
                : selectRandomModel(availableModels, attemptedModels);
            if (!nextModel) break;
            if (nextModel !== model) recordModelFallback();
            model = nextModel;

            const backoffMs = calculateBackoffTime(attempt);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }

        const lastErrorMessage =
          lastError instanceof Error ? lastError.message : "Unknown error";

        if (!response.headersSent) {
          outcome = "failedBeforeFirstToken";
          sendJsonError(response, 503, {
            error: "Service unavailable - all models failed",
            lastError: lastErrorMessage,
          });
          return;
        }

        outcome = hasEmittedContent
          ? "failedMidStream"
          : "failedBeforeFirstToken";
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
        outcome = "internalError";
        sendJsonError(response, 500, {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        recordInference({
          outcome,
          durationMs: performance.now() - startedAt,
          firstTokenMs,
          attempts,
        });
      }
    },
  );
}
