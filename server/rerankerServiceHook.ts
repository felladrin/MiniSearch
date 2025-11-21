import type { PreviewServer, ViteDevServer } from "vite";
import { startRerankerService, stopRerankerService } from "./rerankerService";

export async function rerankerServiceHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  try {
    await startRerankerService();
  } catch (error) {
    console.error("Failed to start reranker service:", error);
  }

  server.httpServer?.on("close", () => {
    stopRerankerService();
  });
}
