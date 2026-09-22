import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tokenizer } from "@huggingface/tokenizers";
import debug from "debug";
import { InferenceSession } from "onnxruntime-node";
import { downloadFileFromHuggingFaceRepository } from "../downloadFileFromHuggingFaceRepository.ts";

const SERVER_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const printMessage = createModelLogger(path.basename(import.meta.url));

/**
 * Creates a debug logger with the same enabled-always behavior used by the
 * model services.
 */
export function createModelLogger(moduleName: string) {
  const printMessage = debug(moduleName);
  printMessage.enabled = true;
  return printMessage;
}

function resolveModelPath(modelRepo: string, hfRepoFile: string) {
  return path.resolve(SERVER_DIR, "models", modelRepo, hfRepoFile);
}

// Replaces a cached file when its size differs from the Hub, not just when
// missing.
async function ensureModelFileExists(modelRepo: string, hfRepoFile: string) {
  const localPath = resolveModelPath(modelRepo, hfRepoFile);
  await downloadFileFromHuggingFaceRepository(modelRepo, hfRepoFile, localPath);
  return localPath;
}

// CPU-only, errors-only logging. The reranker is a dynamically quantized
// graph, the wrong shape for WebGPU (no kernels for the integer matmuls,
// shuttles them to the CPU: 812ms against 172ms for the same work, with scores
// drifting by up to 1.15 and reordering results). `coreml` is slower than CPU
// on dynamic shapes. The bi-encoder is fp32 and was not benchmarked on
// accelerators, but inherits this choice. logSeverityLevel 3 keeps startup
// quiet: ONNX Runtime otherwise warns that it assigned shape operators to CPU,
// which is expected and not actionable. The architecture is logged because it
// selects the quantized kernel, which is the part that varies between hosts.
function createOnnxSession(modelRepo: string, modelPath: string) {
  printMessage(
    `Creating CPU session for ${modelRepo} (arch: ${process.arch}, platform: ${process.platform})...`,
  );
  return InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    logSeverityLevel: 3,
  });
}

/**
 * Resolves the tokenizer's real pad token id from its config, or `null` when
 * the config declares no pad token at all — the reranker never pads, so a
 * missing pad must not fail its load. A pad token that is declared but cannot
 * be resolved raises instead: padding with an assumed id is wrong, because in
 * the XLM-RoBERTa exports id 0 is `<s>`, not `<pad>`, so a hardcoded 0
 * would inject BOS tokens at every pad position.
 */
function resolvePadTokenId(
  tokenizer: Tokenizer,
  tokenizerConfig: { pad_token?: unknown },
  modelRepo: string,
): number | null {
  if (!tokenizerConfig || !Object.hasOwn(tokenizerConfig, "pad_token")) {
    return null;
  }

  const padToken = tokenizerConfig.pad_token;
  if (typeof padToken !== "string" || padToken.length === 0) {
    throw new Error(
      `tokenizer_config.json for ${modelRepo} declares a malformed pad_token`,
    );
  }

  const padTokenId = tokenizer.token_to_id(padToken);
  if (padTokenId === undefined) {
    throw new Error(
      `pad token "${padToken}" is missing from the vocabulary of ${modelRepo}`,
    );
  }

  return padTokenId;
}

/**
 * Downloads model files from a Hugging Face repo and returns a ready
 * inference session, tokenizer, and the tokenizer's real pad token id. The
 * tokenizer files use the standard Hugging Face names when not overridden.
 */
export async function loadOnnxModel(
  modelRepo: string,
  modelFile: string,
  tokenizerFile = "tokenizer.json",
  tokenizerConfigFile = "tokenizer_config.json",
): Promise<{
  session: InferenceSession;
  tokenizer: Tokenizer;
  padTokenId: number | null;
}> {
  const [modelPath, tokenizerPath, tokenizerConfigPath] = await Promise.all([
    ensureModelFileExists(modelRepo, modelFile),
    ensureModelFileExists(modelRepo, tokenizerFile),
    ensureModelFileExists(modelRepo, tokenizerConfigFile),
  ]);

  const tokenizerConfig = JSON.parse(
    fs.readFileSync(tokenizerConfigPath, "utf8"),
  ) as { pad_token?: unknown };
  const tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync(tokenizerPath, "utf8")),
    tokenizerConfig,
  );
  const padTokenId = resolvePadTokenId(tokenizer, tokenizerConfig, modelRepo);
  const session = await createOnnxSession(modelRepo, modelPath);

  return { session, tokenizer, padTokenId };
}
