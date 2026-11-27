import type { IncomingMessage, ServerResponse } from "node:http";
import { vi } from "vitest";

/** The middleware an endpoint hook mounted on `server.middlewares`. */
export type HookHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;

/** A request carrying only the fields the endpoint hooks read. */
export function createRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:3000" },
  } as unknown as IncomingMessage;
}

/** A request whose `Host` header cannot be parsed. */
export function createRequestWithBadHost(url: string): IncomingMessage {
  return { url, headers: { host: "bad host" } } as unknown as IncomingMessage;
}

/** A response that records `setHeader` and `end` instead of writing. */
export function createResponse() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    setHeader: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

/**
 * Registers `hook` on a fake server and returns the middleware it mounted.
 * The fake only needs `middlewares.use`, so the hook's real server type is
 * cast away here rather than repeated in every hook test file.
 */
export function getRegisteredHookHandler<S>(
  hook: (server: S) => void,
): HookHandler {
  const use = vi.fn();
  hook({ middlewares: { use } } as unknown as S);
  return use.mock.calls[0][0] as HookHandler;
}
