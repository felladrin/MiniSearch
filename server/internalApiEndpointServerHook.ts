import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, streamText } from "ai";
import type { PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
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
  recordStreamEndedWithoutFinish,
} from "./inferencesSinceLastRestart.ts";
import { getInternalApiConfig } from "./internalApiConfig.ts";
import { createModelPicker } from "./internalApiModelPicker.ts";
import {
  createChunkPayload,
  sendSseData,
  sendSseDone,
  sendSseError,
} from "./utils/chatCompletionSse.ts";
import { sendJsonError } from "./utils/httpResponse.ts";
import { readJsonBody } from "./utils/readJsonBody.ts";
import { parseRequestUrl } from "./utils/requestUrl.ts";
import {
  calculateBackoffTime,
  isResponseWritable,
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

const maxBodyBytes = 1024 * 1024;

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
        const body = await readJsonBody(request, maxBodyBytes);

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

        const internalApi = getInternalApiConfig();
        const { baseUrl, apiKey } = internalApi;
        if (!baseUrl || !apiKey) {
          outcome = "notConfigured";
          sendJsonError(response, 500, {
            error: "OpenAI API configuration is missing",
          });
          return;
        }

        const openaiProvider = createOpenAICompatible({
          baseURL: baseUrl,
          apiKey,
          name: "openai",
        });

        const modelPicker = createModelPicker({
          models: internalApi.models,
          baseUrl,
          apiKey,
        });
        let model: string | undefined;
        try {
          model = await modelPicker.first();
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

        if (!model) {
          outcome = "noModelAvailable";
          sendJsonError(response, 500, { error: "No model available" });
          return;
        }

        // Passed through unchecked: providers disagree on the accepted values
        // (`none`, `minimal`, `xhigh`...), and an unknown one comes back from
        // the upstream as an HTTP error in the log.
        const { reasoningEffort } = internalApi;
        const providerOptions = reasoningEffort
          ? { openai: { reasoningEffort } }
          : undefined;

        const maxAttempts = 5;
        let lastError: unknown = null;

        const clampedMaxTokens =
          requestBody.max_tokens !== undefined
            ? Math.min(requestBody.max_tokens, internalApi.maxOutputTokens)
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
              internalApi.requestTimeoutMs,
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
                  `Upstream stalled for ${internalApi.requestTimeoutMs}ms`,
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

            const nextModel = await modelPicker.next();
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
