import {
  createOpenAICompatible,
  type OpenAICompatibleChatModelId,
} from "@ai-sdk/openai-compatible";
import { type ModelMessage, streamText } from "ai";
import type { Connect, PreviewServer, ViteDevServer } from "vite";
import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels";
import { handleTokenVerification } from "./handleTokenVerification";

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
    id: Date.now().toString(),
    object: "chat.completion.chunk",
    created: Date.now(),
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

export function internalApiEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url || !request.url.startsWith("/inference")) return next();

    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");
    const { shouldContinue } = await handleTokenVerification(token, response);
    if (!shouldContinue) return;

    if (
      !process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL ||
      !process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY
    ) {
      response.statusCode = 500;
      response.end(
        JSON.stringify({ error: "OpenAI API configuration is missing" }),
      );
      return;
    }

    const openaiProvider = createOpenAICompatible({
      baseURL: process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
      apiKey: process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
      name: "openai",
    });

    try {
      const requestBody = await getRequestBody(request);
      let model = process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL;
      let availableModels: { id: OpenAICompatibleChatModelId }[] = [];

      if (!model) {
        try {
          availableModels = await listOpenAiCompatibleModels(
            process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
            process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
          );
          const selectedModel = selectRandomModel(availableModels);

          if (selectedModel) {
            model = selectedModel;
          } else {
            throw new Error("No models available from the API");
          }
        } catch (modelFetchError) {
          console.error("Error fetching models:", modelFetchError);
          throw new Error(
            "Unable to determine model for OpenAI-compatible API",
          );
        }
      }

      if (!model) {
        throw new Error("OpenAI model configuration is missing");
      }

      const maxRetries = 5;
      const attemptedModels = new Set<string>();
      let currentAttempt = 0;
      let streamError: unknown = null;

      const tryNextModel = async (): Promise<void> => {
        if (currentAttempt >= maxRetries) {
          if (!response.headersSent) {
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: "Service unavailable - all models failed",
                lastError:
                  streamError instanceof Error
                    ? streamError.message
                    : "Unknown error",
              }),
            );
          }
          return;
        }

        if (model) {
          attemptedModels.add(model);
        }

        currentAttempt++;

        const stream = streamText({
          model: openaiProvider.chatModel(model as string),
          messages: requestBody.messages,
          temperature: requestBody.temperature,
          topP: requestBody.top_p,
          frequencyPenalty: requestBody.frequency_penalty,
          presencePenalty: requestBody.presence_penalty,
          maxOutputTokens: requestBody.max_tokens,
          maxRetries: 0,
          onError: async (error) => {
            streamError = error;

            if (
              availableModels.length === 0 &&
              !process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL
            ) {
              try {
                availableModels = await listOpenAiCompatibleModels(
                  process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL as string,
                  process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
                );
              } catch (refetchErr) {
                console.warn("Failed to refetch models:", refetchErr);
              }
            }

            if (availableModels.length > 0 && currentAttempt < maxRetries) {
              const nextModel = selectRandomModel(
                availableModels,
                attemptedModels,
              );
              if (nextModel) {
                console.warn(
                  `Model "${model}" failed, retrying with "${nextModel}" (Attempt ${currentAttempt}/${maxRetries})`,
                );
                model = nextModel;
                await new Promise((resolve) =>
                  setTimeout(resolve, 100 * currentAttempt),
                );
                await tryNextModel();
                return;
              }
            }

            if (!response.headersSent) {
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(
                JSON.stringify({
                  error: "Service unavailable - all models failed",
                }),
              );
            }
          },
        });

        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");

        try {
          for await (const part of stream.fullStream) {
            if (part.type === "text-delta") {
              const payload = createChunkPayload(model as string, part.text);
              response.write(`data: ${JSON.stringify(payload)}\n\n`);
            } else if (part.type === "finish") {
              const payload = createChunkPayload(
                model as string,
                undefined,
                "stop",
              );
              response.write(`data: ${JSON.stringify(payload)}\n\n`);
              response.write("data: [DONE]\n\n");
              response.end();
              return;
            }
          }
        } catch (iterationError) {
          console.error("Error during stream iteration:", iterationError);
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                error: "Stream iteration error",
              }),
            );
          }
        }
      };

      await tryNextModel();

      if (!response.headersSent) {
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            error:
              "Failed to generate text after multiple retries with different models",
          }),
        );
      }
    } catch (error) {
      console.error("Error in internal API endpoint:", error);
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  });
}

async function getRequestBody(
  request: Connect.IncomingMessage,
): Promise<ChatCompletionRequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(JSON.parse(body));
      } catch (_) {
        reject(new Error("Failed to parse request body"));
      }
    });

    request.on("error", (error) => {
      reject(new Error(`Request stream error: ${error.message}`));
    });
  });
}
