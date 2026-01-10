import type { PreviewServer, ViteDevServer } from "vite";
import { startRerankerService, stopRerankerService } from "./rerankerService";
import { startWebSearchService } from "./webSearchService";

export async function rerankerServiceHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  try {
    await startRerankerService();
  } catch (error) {
    console.error("Failed to start reranker service:", error);
  }

  try {
    await startWebSearchService();
  } catch (error) {
    console.error("Failed to start web search service:", error);
  }

  server.httpServer?.on("close", () => {
    stopRerankerService();
  });
}
