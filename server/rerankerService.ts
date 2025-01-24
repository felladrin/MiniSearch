import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import debug from "debug";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository";

const fileName = path.basename(import.meta.url);
const printMessage = debug(fileName);
debug.enable(fileName);

const SERVER_HOST = "127.0.0.1";
const SERVER_PORT = 8012;
const VERBOSE_MODE = false;
const MODEL_HF_REPO = "Felladrin/gguf-Q8_0-bge-reranker-v2-m3";
const MODEL_HF_FILE = "bge-reranker-v2-m3-q8_0.gguf";

let isReady = false;

export function getRerankerModelPath() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "models",
    MODEL_HF_REPO,
    MODEL_HF_FILE,
  );
}

async function ensureModelExists(modelPath: string) {
  await downloadFileFromHuggingFaceRepository(
    MODEL_HF_REPO,
    MODEL_HF_FILE,
    modelPath,
  );
}

export async function startRerankerService() {
  printMessage("Preparing model...");
  const modelPath = getRerankerModelPath();
  await ensureModelExists(modelPath);
  printMessage("Starting service...");

  const contextSize = 8192;
  const threads = Math.min(Math.max(1, os.cpus().length - 2), 16);
  const batchSize = Math.ceil(contextSize / threads);

  const serverProcess = spawn(
    "llama-server",
    [
      "--model",
      modelPath,
      "--ctx-size",
      contextSize.toString(),
      "--parallel",
      threads.toString(),
      "--batch-size",
      batchSize.toString(),
      "--ubatch-size",
      batchSize.toString(),
      "--flash-attn",
      "--host",
      SERVER_HOST,
      "--port",
      SERVER_PORT.toString(),
      "--log-verbosity",
      VERBOSE_MODE ? "1" : "0",
      "--reranking",
      "--pooling",
      "rank",
    ],
    {
      stdio: [
        "ignore",
        VERBOSE_MODE ? "pipe" : "ignore",
        VERBOSE_MODE ? "pipe" : "ignore",
      ],
    },
  );

  serverProcess.stderr?.on("data", (data) => {
    printMessage(data.toString());
  });

  await new Promise<void>((resolve) => {
    const checkReady = async () => {
      try {
        const response = await fetch(
          `http://${SERVER_HOST}:${SERVER_PORT}/health`,
        );
        const responseJson = (await response.json()) as {
          status: "ok" | string;
        };
        if (responseJson.status === "ok") {
          isReady = true;
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      } catch {
        setTimeout(checkReady, 100);
      }
    };
    checkReady();
  });

  printMessage("Service ready!");

  return serverProcess;
}

export function stopRerankerService(serverProcess: ChildProcess | null) {
  if (serverProcess) {
    serverProcess.kill();
  }
}

export async function getRerankerStatus() {
  if (!isReady) {
    return false;
  }

  try {
    const response = await fetch(`http://${SERVER_HOST}:${SERVER_PORT}/health`);
    const responseJson = (await response.json()) as { status: "ok" | string };
    return responseJson.status === "ok";
  } catch {
    return false;
  }
}

export async function rerank(query: string, documents: string[]) {
  if (!isReady) {
    throw new Error("Reranker service is not ready");
  }

  const response = await fetch(
    `http://${SERVER_HOST}:${SERVER_PORT}/v1/rerank`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "rerank",
        query,
        documents,
        top_n: documents.length,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Reranking failed: ${response.statusText}`);
  }

  const result = await response.json();
  return result.results;
}
