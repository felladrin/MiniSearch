import { Connect, PreviewServer, ViteDevServer } from "vite";
import OpenAI from "openai";
import { Stream } from "openai/streaming.mjs";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { argon2Verify } from "hash-wasm";
import { getSearchToken } from "./searchToken";
import { isVerifiedToken, addVerifiedToken } from "./verifiedTokens";

const rateLimiter = new RateLimiterMemory({
  points: 2,
  duration: 10,
});

export function internalApiEndpointServerHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  server.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith("/inference")) return next();

    const authHeader = request.headers.authorization;
    const tokenPrefix = "Bearer ";
    const token =
      authHeader && authHeader.startsWith(tokenPrefix)
        ? authHeader.slice(tokenPrefix.length)
        : null;

    if (!token) {
      response.statusCode = 401;
      response.end("Missing or invalid Authorization header.");
      return;
    }

    if (!isVerifiedToken(token)) {
      let isValidToken = false;

      try {
        isValidToken = await argon2Verify({
          password: getSearchToken(),
          hash: token,
        });
      } catch (error) {
        void error;
      }

      if (isValidToken) {
        addVerifiedToken(token);
      } else {
        response.statusCode = 401;
        response.end("Unauthorized.");
        return;
      }
    }

    try {
      await rateLimiter.consume(token);
    } catch {
      response.statusCode = 429;
      response.end("Too many requests.");
      return;
    }

    const openai = new OpenAI({
      baseURL: process.env.INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL,
      apiKey: process.env.INTERNAL_OPENAI_COMPATIBLE_API_KEY,
    });

    try {
      const requestBody = await getRequestBody(request);
      const completion = await openai.chat.completions.create({
        ...requestBody,
        model: process.env.INTERNAL_OPENAI_COMPATIBLE_API_MODEL,
        stream: true,
      });
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");
      const stream = OpenAIStream(completion);
      stream.pipeTo(
        new WritableStream({
          write(chunk) {
            response.write(chunk);
          },
          close() {
            response.end();
          },
        }),
      );
    } catch (error) {
      console.error("Error in internal API endpoint:", error);
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}

async function getRequestBody(
  request: Connect.IncomingMessage,
): Promise<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function OpenAIStream(
  completion: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
) {
  return new ReadableStream({
    async start(controller) {
      for await (const chunk of completion) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          const payload = {
            id: chunk.id,
            object: "chat.completion.chunk",
            created: chunk.created,
            model: chunk.model,
            choices: [
              {
                index: 0,
                delta: { content },
                finish_reason: chunk.choices[0].finish_reason,
              },
            ],
          };
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        }
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
