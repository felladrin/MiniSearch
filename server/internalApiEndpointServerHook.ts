import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type CoreMessage, type Message, streamText } from "ai";
import type { Connect, PreviewServer, ViteDevServer } from "vite";
import { verifyTokenAndRateLimit } from "./verifyTokenAndRateLimit";

interface ChatCompletionRequestBody {
  messages: CoreMessage[] | Omit<Message, "id">[];
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
  model: string;
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
    if (!request.url.startsWith("/inference")) return next();

    const authHeader = request.headers.authorization;
    const tokenPrefix = "Bearer ";
    const token = authHeader?.startsWith(tokenPrefix)
      ? authHeader.slice(tokenPrefix.length)
      : null;

    const authResult = await verifyTokenAndRateLimit(token);

    if (!authResult.isAuthorized) {
      response.statusCode = authResult.statusCode;
      response.end(authResult.error);
      return;
    }

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
      const model = process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL;

      if (!model) {
        throw new Error("OpenAI model configuration is missing");
      }

      const stream = streamText({
        model: openaiProvider.chatModel(model),
        messages: requestBody.messages,
        temperature: requestBody.temperature,
        topP: requestBody.top_p,
        frequencyPenalty: requestBody.frequency_penalty,
        presencePenalty: requestBody.presence_penalty,
        maxTokens: requestBody.max_tokens,
      });

      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");

      try {
        for await (const part of stream.fullStream) {
          if (part.type === "text-delta") {
            const payload = createChunkPayload(model, part.textDelta);
            response.write(`data: ${JSON.stringify(payload)}\n\n`);
          } else if (part.type === "finish") {
            const payload = createChunkPayload(model, undefined, "stop");
            response.write(`data: ${JSON.stringify(payload)}\n\n`);
            response.write("data: [DONE]\n\n");
            response.end();
          }
        }
      } catch (streamError) {
        console.error("Error in stream processing:", streamError);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "Stream processing error" }));
        } else {
          response.end();
        }
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
      } catch (error) {
        reject(new Error("Failed to parse request body"));
      }
    });

    request.on("error", (error) => {
      reject(new Error(`Request stream error: ${error.message}`));
    });
  });
}
