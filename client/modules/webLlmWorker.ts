import { MLCEngineWorkerHandler, MLCEngine } from "@mlc-ai/web-llm";

const engine = new MLCEngine();
const handler = new MLCEngineWorkerHandler(engine);
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
