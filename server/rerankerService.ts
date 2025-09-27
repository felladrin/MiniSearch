import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import debug from "debug";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository";

const fileName = path.basename(import.meta.url);
const printMessage = debug(fileName);
printMessage.enabled = true;

const SERVICE_HOST = "127.0.0.1";
const SERVICE_PORT = 8012;
const VERBOSE_MODE = false;
const MODEL_HF_REPO = "Felladrin/gguf-jina-reranker-v1-tiny-en";
const MODEL_HF_FILE = "jina-reranker-v1-tiny-en-Q8_0.gguf";

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

  const contextSize = 2048;

  const serverProcess = spawn(
    "llama-server",
    [
      "--model",
      modelPath,
      "--ctx-size",
      contextSize.toString(),
      "--batch-size",
      contextSize.toString(),
      "--ubatch-size",
      contextSize.toString(),
      "--flash-attn",
      "on",
      "--host",
      SERVICE_HOST,
      "--port",
      SERVICE_PORT.toString(),
      "--log-verbosity",
      VERBOSE_MODE ? "1" : "0",
      "--threads",
      "1",
      "--parallel",
      "1",
      "--no-warmup",
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
          `http://${SERVICE_HOST}:${SERVICE_PORT}/health`,
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
    const response = await fetch(
      `http://${SERVICE_HOST}:${SERVICE_PORT}/health`,
    );
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

  if (VERBOSE_MODE) {
    console.time("Time to rerank");
  }

  const response = await fetch(
    `http://${SERVICE_HOST}:${SERVICE_PORT}/v1/rerank`,
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

  const jsonResponse = await response.json();

  const results = jsonResponse.results as {
    index: number;
    relevance_score: number;
  }[];

  if (VERBOSE_MODE) {
    console.timeEnd("Time to rerank");
    const sortedResults = results
      .slice()
      .sort((a, b) => b.relevance_score - a.relevance_score);
    const rankedDocuments = results.map(({ index, relevance_score }) => ({
      document: documents[index],
      ranking_position:
        sortedResults.findIndex((result) => result.index === index) + 1,
      relevance_score,
    }));
    printMessage(rankedDocuments);
  }

  return results;
}
