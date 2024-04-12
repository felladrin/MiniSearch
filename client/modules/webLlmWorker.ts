import { EngineWorkerHandler, Engine } from "@mlc-ai/web-llm";

const engine = new Engine();
const handler = new EngineWorkerHandler(engine);
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
