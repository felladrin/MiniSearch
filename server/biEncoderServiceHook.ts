import type { PreviewServer, ViteDevServer } from "vite";
import {
  startBiEncoderService,
  stopBiEncoderService,
} from "./biEncoderService.ts";

export async function biEncoderServiceHook<
  T extends ViteDevServer | PreviewServer,
>(server: T) {
  try {
    await startBiEncoderService();
  } catch (error) {
    console.error("Failed to start bi-encoder service:", error);
  }

  server.httpServer?.on("close", () => {
    stopBiEncoderService().catch((error) => {
      console.error("Failed to stop bi-encoder service:", error);
    });
  });
}
