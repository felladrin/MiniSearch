import {
  type Agent,
  createServer,
  type IncomingMessage,
  request,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
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

/**
 * Runs `hook` on a real HTTP server on an ephemeral port, with a `next` that
 * answers 404. Only a real connection shows what a mid-upload refusal costs a
 * keep-alive caller, which is what the socket tests check.
 */
export async function startHookServer(
  hook: (server: never) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const middlewares = {
      use: (handler: (req: unknown, res: unknown, next: () => void) => void) =>
        handler(req, res, () => {
          res.statusCode = 404;
          res.end();
        }),
    };
    hook({ middlewares } as never);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * POSTs `payload` to `path` and resolves with `status=<code>`, or
 * `error=<code>` when the socket itself failed, which is how a dropped
 * keep-alive connection reaches the caller.
 */
export function postThroughSocket(
  port: number,
  path: string,
  agent: Agent,
  payload: string | Buffer,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise<string>((resolve) => {
    const req = request(
      { port, method: "POST", path, agent, headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(`status=${res.statusCode}`));
      },
    );
    req.on("error", (error) =>
      resolve(`error=${(error as NodeJS.ErrnoException).code}`),
    );
    req.end(payload);
  });
}
