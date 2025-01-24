import type { PreviewServer, ViteDevServer } from "vite";
import { startRerankerService, stopRerankerService } from "./rerankerService";

export async function rerankerServiceHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  const serverProcess = await startRerankerService();

  server.httpServer?.on("close", () => {
    stopRerankerService(serverProcess);
  });
}
