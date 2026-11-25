import { withTimeout } from "./withTimeout";

type OpenAIModel = { id: string };

export function selectRandomModel(
  models: OpenAIModel[],
  excludeIds: Set<string> = new Set(),
): string | null {
  if (!models || models.length === 0) return null;
  const availableModels = models.filter((m) => !excludeIds.has(m.id));
  if (availableModels.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * availableModels.length);
  return availableModels[randomIndex].id;
}

function makeOpenAIHeaders(apiKey?: string): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
  };
}

/** How long a `/models` request may take before it gives up. */
const LIST_MODELS_TIMEOUT_MS = 10_000;

/**
 * Lists the models of an OpenAI-compatible server. Gives up after
 * `LIST_MODELS_TIMEOUT_MS`, or earlier when `signal` aborts, so a server that
 * never answers cannot leave the caller waiting.
 */
export async function listOpenAiCompatibleModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<OpenAIModel[]> {
  if (!baseUrl) throw new Error("Base URL is required to list models");

  const normalizedBase = baseUrl.replace(/\/$/, "");
  const response = await fetch(`${normalizedBase}/models`, {
    headers: makeOpenAIHeaders(apiKey),
    signal: withTimeout(signal, LIST_MODELS_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const items: unknown[] = Array.isArray(data?.data) ? data.data : [];
  // A non-conforming server may list entries without a usable id; skip them.
  return items.filter(
    (m): m is OpenAIModel =>
      typeof (m as OpenAIModel | null)?.id === "string" &&
      (m as OpenAIModel).id !== "",
  );
}
