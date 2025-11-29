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
let serverProcess: ChildProcess | null = null;
let restartTimeout: NodeJS.Timeout | null = null;

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

  serverProcess = spawn(
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
      "auto",
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

  serverProcess.on("exit", (code, signal) => {
    printMessage(
      `Reranker service exited with code: ${code}, signal: ${signal}`,
    );
    isReady = false;

    if (restartTimeout) clearTimeout(restartTimeout);
    restartTimeout = setTimeout(() => {
      printMessage("Attempting to restart reranker service...");
      startRerankerService();
    }, 5000);
  });

  serverProcess.on("error", (error) => {
    printMessage(`Reranker service error: ${error.message}`);
    isReady = false;
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
          const warmupResponse = await fetch(
            `http://${SERVICE_HOST}:${SERVICE_PORT}/v1/rerank`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "rerank",
                query: "test",
                documents: ["test document"],
                top_n: 1,
              }),
            },
          );
          if (warmupResponse.ok) {
            isReady = true;
            resolve();
          } else {
            const errorBody = await warmupResponse.text().catch(() => "");
            printMessage(
              `Warmup failed: ${warmupResponse.statusText} - ${errorBody}`,
            );
            setTimeout(checkReady, 500);
          }
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

export function stopRerankerService() {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
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
  if (!documents || documents.length === 0) {
    return [];
  }

  if (!isReady) {
    throw new Error("Reranker service is not ready");
  }

  if (VERBOSE_MODE) {
    console.time("Time to rerank");
  }

  try {
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
      const errorBody = await response
        .text()
        .catch(() => "Unable to read error body");
      printMessage(`Reranking error response: ${errorBody}`);
      throw new Error(
        `Reranking failed: ${response.statusText} - ${errorBody}`,
      );
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("Reranking failed")) {
      printMessage("Reranking service error detected, marking as not ready");
      isReady = false;
      if (serverProcess) {
        serverProcess.kill();
      }
    }
    throw error;
  }
}
