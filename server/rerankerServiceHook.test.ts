import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startRerankerService,
  stopRerankerService,
} from "./rerankerService.ts";
import { rerankerServiceHook } from "./rerankerServiceHook.ts";
import { startWebSearchService } from "./webSearchService.ts";

vi.mock("./rerankerService.ts", () => ({
  startRerankerService: vi.fn(),
  stopRerankerService: vi.fn(),
}));

vi.mock("./webSearchService.ts", () => ({
  startWebSearchService: vi.fn(),
}));

type ServerWithCloseHandler = {
  httpServer?: {
    on: ReturnType<typeof vi.fn>;
  };
};

function createServer(withHttpServer = true): ServerWithCloseHandler {
  return withHttpServer ? { httpServer: { on: vi.fn() } } : {};
}

describe("rerankerServiceHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startRerankerService).mockResolvedValue(undefined);
    vi.mocked(startWebSearchService).mockResolvedValue(undefined);
    vi.mocked(stopRerankerService).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts both services and stops the reranker when the server closes", async () => {
    const server = createServer();

    await rerankerServiceHook(
      server as unknown as Parameters<typeof rerankerServiceHook>[0],
    );

    expect(startRerankerService).toHaveBeenCalledOnce();
    expect(startWebSearchService).toHaveBeenCalledOnce();
    expect(server.httpServer?.on).toHaveBeenCalledWith(
      "close",
      expect.any(Function),
    );

    const closeHandler = server.httpServer?.on.mock.calls[0][1] as () => void;
    closeHandler();
    await Promise.resolve();
    expect(stopRerankerService).toHaveBeenCalledOnce();
  });

  it("continues startup and logs when the reranker fails", async () => {
    const error = new Error("reranker unavailable");
    vi.mocked(startRerankerService).mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const server = createServer();

    await rerankerServiceHook(
      server as unknown as Parameters<typeof rerankerServiceHook>[0],
    );

    expect(startWebSearchService).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to start reranker service:",
      error,
    );
  });

  it("continues startup and logs when the web search service fails", async () => {
    const error = new Error("search service unavailable");
    vi.mocked(startWebSearchService).mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const server = createServer();

    await rerankerServiceHook(
      server as unknown as Parameters<typeof rerankerServiceHook>[0],
    );

    expect(startRerankerService).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to start web search service:",
      error,
    );
  });

  it("logs a shutdown failure without rejecting the close callback", async () => {
    const error = new Error("release failed");
    vi.mocked(stopRerankerService).mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const server = createServer();

    await rerankerServiceHook(
      server as unknown as Parameters<typeof rerankerServiceHook>[0],
    );
    const closeHandler = server.httpServer?.on.mock.calls[0][1] as () => void;

    expect(() => closeHandler()).not.toThrow();
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to stop reranker service:",
      error,
    );
  });

  it("does not register a close handler when no HTTP server exists", async () => {
    await rerankerServiceHook(
      createServer(false) as unknown as Parameters<
        typeof rerankerServiceHook
      >[0],
    );

    expect(startRerankerService).toHaveBeenCalledOnce();
    expect(startWebSearchService).toHaveBeenCalledOnce();
  });
});
