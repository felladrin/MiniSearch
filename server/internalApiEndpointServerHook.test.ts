import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./handleTokenVerification", () => ({
  handleTokenVerification: vi.fn(),
}));

import { handleTokenVerification } from "./handleTokenVerification";
import { internalApiEndpointServerHook } from "./internalApiEndpointServerHook";

function createRequest(body: unknown): IncomingMessage {
  const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  request.url = "/inference?token=abc";
  request.method = "POST";
  request.headers = {
    host: "localhost:3000",
    "content-type": "application/json",
  };
  return request;
}

function createResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function getRegisteredHandler() {
  const use = vi.fn();
  internalApiEndpointServerHook({
    middlewares: { use },
  } as unknown as Parameters<typeof internalApiEndpointServerHook>[0]);
  return use.mock.calls[0][0] as (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => Promise<void>;
}

describe("internalApiEndpointServerHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handleTokenVerification).mockResolvedValue({
      shouldContinue: true,
    });
  });

  it.each([
    {
      name: "messages is missing",
      body: {},
      expectedPath: "messages",
    },
    {
      name: "messages is empty",
      body: { messages: [] },
      expectedPath: "messages",
    },
    {
      name: "a message role is invalid",
      body: { messages: [{ role: "admin", content: "hello" }] },
      expectedPath: "messages.0.role",
    },
    {
      name: "message content is not a string",
      body: { messages: [{ role: "user", content: 42 }] },
      expectedPath: "messages.0.content",
    },
  ])("responds 400 when $name", async ({ body, expectedPath }) => {
    const handler = getRegisteredHandler();
    const response = createResponse();

    await handler(createRequest(body), response, vi.fn());

    expect(response.statusCode).toBe(400);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    const payload = JSON.parse(response.end.mock.calls[0][0]);
    expect(payload.error).toContain(`Invalid request body: ${expectedPath}`);
  });
});
