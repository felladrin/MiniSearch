import { appName, appRepository, appVersion } from "./appInfo";
import { addLogEntry } from "./logEntries";
import {
  getSettings,
  getTextGenerationState,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { sleep } from "./sleep";
import {
  ChatGenerationError,
  canStartResponding,
  defaultContextSize,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

interface HordeResponse {
  id: string;
  kudos: number;
}

interface HordeStatusResponse {
  generations?: { text: string; model: string }[];
  done?: boolean;
  faulted?: boolean;
  is_possible?: boolean;
}

interface HordeModelInfo {
  performance: number;
  queued: number;
  jobs: number;
  eta: number;
  type: string;
  name: string;
  count: number;
}

interface HordeWorkerInfo {
  models: string[];
  max_length: number;
}

interface HordeModelStatsResponse {
  month?: Record<string, number>;
}

interface HordeUserInfo {
  username: string;
  kudos: number;
}

const AI_HORDE_BASE_URL = "https://aihorde.net/api/v2";

const aiHordeClientAgent = `${appName}:${appVersion}:${appRepository}`;
const userMarker = "**USER**:";
const assistantMarker = "**ASSISTANT**:";

const HTTP_HEADERS = {
  CONTENT_TYPE: "Content-Type",
  CLIENT_AGENT: "Client-Agent",
  ACCEPT: "accept",
  API_KEY: "apikey",
} as const;

function buildHordeUrl(path: string) {
  return `${AI_HORDE_BASE_URL}${path}`;
}

/** Anonymous AI Horde API key; the lowest-priority tier when the horde is busy. */
export const aiHordeDefaultApiKey = "0000000000";

// How many of the most-requested models an unpinned request asks the horde for.
const TOP_HORDE_MODEL_COUNT = 5;

// A model whose workers all stop short of this cuts the answer off, so an
// unpinned request never goes to it.
const MIN_HORDE_MODEL_RESPONSE_TOKENS = 1024;

// The monthly-request statistics response is large, so the ranking is reused for a while.
const TOP_HORDE_MODEL_CACHE_MS = 5 * 60 * 1000;

// A hung ranking endpoint must not stall the generation; it falls back instead.
const HORDE_RANKING_FETCH_TIMEOUT_MS = 10 * 1000;

const GENERATION_NOT_POSSIBLE_MESSAGE =
  "Generation not possible with the selected model";

// A status check that fails this many times in a row ends the generation.
// Until then a rate limit or a gateway hiccup is retried, waiting 1 s, 2 s,
// 4 s and so on, up to the cap.
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
const MAX_POLL_RETRY_DELAY_MS = 8 * 1000;

/**
 * A non-ok answer from the AI Horde API. The status is kept so a poll can
 * tell a passing rate limit from a job that is gone.
 */
class HordeHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HordeHttpError";
    this.status = status;
  }
}

/**
 * Reads a Horde JSON body, or throws with the server's own message when the
 * response is not ok. Horde explains a refusal (a bad key, a rate limit) in
 * the body, and that reason is what the user needs to see.
 */
async function readHordeJson<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  let message = fallbackMessage;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) {
      message = body.message;
    }
  } catch {
    // A gateway error page is HTML, not JSON, and the status says enough.
  }
  throw new HordeHttpError(
    response.status,
    `${message} (HTTP ${response.status})`,
  );
}

/**
 * A status poll is an idempotent GET, so anything that can pass on its own is
 * worth another try: a rate limit, a server error, a body that is not JSON
 * (an HTML error page from a gateway) and a dropped connection. Any other
 * HTTP error, such as a 404 for an expired job, will not get better.
 */
function isTransientPollFailure(error: unknown): boolean {
  if (error instanceof HordeHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return error instanceof SyntaxError || error instanceof TypeError;
}

function getEffectiveHordeApiKey(
  settings: ReturnType<typeof getSettings> = getSettings(),
) {
  return settings.hordeApiKey || aiHordeDefaultApiKey;
}

async function startGeneration(
  messages: ChatMessage[],
  signal?: AbortSignal,
  models?: string[],
) {
  const settings = getSettings();
  const aiHordeApiKey = getEffectiveHordeApiKey(settings);
  const aiHordeMaxResponseLengthInTokens =
    aiHordeApiKey === aiHordeDefaultApiKey ? 512 : 1024;
  const response = await fetch(buildHordeUrl("/generate/text/async"), {
    method: "POST",
    signal,
    headers: {
      [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
      [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
      [HTTP_HEADERS.API_KEY]: aiHordeApiKey,
    },
    body: JSON.stringify({
      prompt: formatPrompt(messages),
      params: {
        max_context_length: defaultContextSize,
        max_length: aiHordeMaxResponseLengthInTokens,
        singleline: false,
        temperature: 0.35,
        top_p: 1.0,
        min_p: 0.0,
        top_k: 40,
        rep_pen: 1,
        stop_sequence: [userMarker, assistantMarker],
        validated_backends: false,
      },
      models,
    }),
  });

  const data = await readHordeJson<HordeResponse>(
    response,
    "Failed to start generation",
  );
  if (!data.id) {
    throw new Error("Failed to start generation");
  }

  return data;
}

async function handleGenerationStatus(
  generationId: string,
  onUpdate: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const aiHordeApiKey = getEffectiveHordeApiKey();
  let lastText = "";

  try {
    // Only read after a poll that answered, which is the only way out of the
    // loop other than a throw.
    let status: HordeStatusResponse = {};
    let consecutivePollFailures = 0;

    while (true) {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }

      let polled: HordeStatusResponse | undefined;
      try {
        const response = await fetch(
          buildHordeUrl(`/generate/text/status/${generationId}`),
          {
            method: "GET",
            signal,
            headers: {
              [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
              [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
              [HTTP_HEADERS.API_KEY]: aiHordeApiKey,
            },
          },
        );
        polled = await readHordeJson<HordeStatusResponse>(
          response,
          "Failed to check generation status",
        );
        consecutivePollFailures = 0;
      } catch (error) {
        consecutivePollFailures++;
        // Never a ChatGenerationError: "not possible" has to stay reserved for
        // a real is_possible: false, since it makes the automatic mode submit
        // a second round of jobs.
        if (
          signal?.aborted ||
          !isTransientPollFailure(error) ||
          consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES
        ) {
          throw error;
        }
        addLogEntry(`AI Horde status check failed, retrying: ${error}`);
      }

      if (polled) {
        status = polled;
        const generation = status.generations?.[0];
        if (generation?.text && generation.text !== lastText) {
          lastText = generation.text;
          if (generation.model) {
            addLogEntry(
              `AI Horde completed the generation using the model "${generation.model}"`,
            );
          }
          onUpdate(lastText.split(userMarker)[0]);
        }
      }

      const pending =
        polled === undefined ||
        (!polled.done && !polled.faulted && polled.is_possible);

      if (pending) {
        await sleep(
          polled
            ? 1000
            : Math.min(
                1000 * 2 ** (consecutivePollFailures - 1),
                MAX_POLL_RETRY_DELAY_MS,
              ),
        );
      }

      if (getTextGenerationState() === "interrupted") {
        // Stop only ends the polling here; without a cancel the queued job
        // would keep running on the Horde and keep spending kudos.
        await cancelGeneration(generationId).catch(() => {});
        throw new ChatGenerationError("Generation interrupted");
      }

      if (!pending || signal?.aborted) break;
    }

    if (signal?.aborted) {
      throw new Error("Request was aborted");
    }

    if (status.faulted) {
      throw new ChatGenerationError("Generation failed");
    }

    if (!status.is_possible) {
      throw new ChatGenerationError(GENERATION_NOT_POSSIBLE_MESSAGE);
    }

    const generatedText = status.generations?.[0]?.text;

    if (!generatedText) {
      throw new Error("No text generated");
    }

    return generatedText.split(userMarker)[0];
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("Request was aborted");
    }
    if (error instanceof ChatGenerationError) {
      throw error;
    }
    throw new Error(`Error while checking generation status: ${error}`);
  }
}

async function cancelGeneration(generationId: string): Promise<void> {
  const aiHordeApiKey = getEffectiveHordeApiKey();
  try {
    const response = await fetch(
      buildHordeUrl(`/generate/text/status/${generationId}`),
      {
        method: "DELETE",
        headers: {
          [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
          [HTTP_HEADERS.CONTENT_TYPE]: "application/json",
          [HTTP_HEADERS.API_KEY]: aiHordeApiKey,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Cancel request failed: ${response.status} ${response.statusText}`,
      );
    }

    addLogEntry(`Successfully cancelled generation ${generationId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    addLogEntry(`Failed to cancel generation ${generationId}: ${errorMessage}`);
    throw new Error(`Failed to cancel generation: ${errorMessage}`);
  }
}

export async function fetchHordeModels(
  signal?: AbortSignal,
): Promise<HordeModelInfo[]> {
  const response = await fetch(
    buildHordeUrl("/status/models?type=text&model_state=all"),
    {
      method: "GET",
      signal,
      headers: {
        [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
        [HTTP_HEADERS.ACCEPT]: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch AI Horde models");
  }

  return response.json();
}

async function fetchHordeTextWorkers(
  signal?: AbortSignal,
): Promise<HordeWorkerInfo[]> {
  const response = await fetch(buildHordeUrl("/workers?type=text"), {
    method: "GET",
    signal,
    headers: {
      [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
      [HTTP_HEADERS.ACCEPT]: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch AI Horde workers");
  }

  return response.json();
}

async function fetchHordeModelMonthlyRequests(
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const response = await fetch(buildHordeUrl("/stats/text/models"), {
    method: "GET",
    signal,
    headers: {
      [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
      [HTTP_HEADERS.ACCEPT]: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch AI Horde model request statistics");
  }

  const data = (await response.json()) as HordeModelStatsResponse;
  if (!data.month) {
    throw new Error(
      "AI Horde model request statistics are missing the monthly counter",
    );
  }
  return data.month;
}

let topHordeModelsCache: { modelNames: string[]; expiresAt: number } | null =
  null;

// The text models with an online worker that writes at least
// MIN_HORDE_MODEL_RESPONSE_TOKENS, ranked by requests this month: the
// community's own vote on which models are worth using. The horde never hands
// a job to a worker whose max_length is below the request's, so one capable
// worker is enough. Cached because the statistics response is large and the
// ranking shifts slowly.
async function getTopHordeModels(): Promise<string[]> {
  if (topHordeModelsCache && Date.now() < topHordeModelsCache.expiresAt) {
    return topHordeModelsCache.modelNames;
  }

  const signal = AbortSignal.timeout(HORDE_RANKING_FETCH_TIMEOUT_MS);
  const [workers, monthlyRequests] = await Promise.all([
    fetchHordeTextWorkers(signal),
    fetchHordeModelMonthlyRequests(signal),
  ]);

  const capableModelNames = new Set(
    workers
      .filter((worker) => worker.max_length >= MIN_HORDE_MODEL_RESPONSE_TOKENS)
      .flatMap((worker) => worker.models),
  );
  const modelNames = [...capableModelNames]
    .sort((a, b) => (monthlyRequests[b] ?? 0) - (monthlyRequests[a] ?? 0))
    .slice(0, TOP_HORDE_MODEL_COUNT);

  topHordeModelsCache = {
    modelNames,
    expiresAt: Date.now() + TOP_HORDE_MODEL_CACHE_MS,
  };
  return modelNames;
}

export async function fetchHordeUserInfo(
  apiKey: string,
): Promise<HordeUserInfo | null> {
  const response = await fetch(buildHordeUrl("/find_user"), {
    headers: {
      [HTTP_HEADERS.API_KEY]: apiKey,
      [HTTP_HEADERS.CLIENT_AGENT]: aiHordeClientAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`);
  }

  const data = await response.json();
  if (typeof data?.username !== "string" || typeof data?.kudos !== "number") {
    addLogEntry(
      "AI Horde returned a malformed user info response; treating the key as anonymous",
    );
    return null;
  }

  return {
    username: data.username,
    kudos: data.kudos,
  };
}

export async function generateTextWithHorde() {
  await canStartResponding();
  updateTextGenerationState("preparingToGenerate");
  const messages = getDefaultChatMessages(
    await getFormattedSearchResults(true),
  );
  // Horde answers only once the queued job is done, so the first text
  // arrives on the poll that ends the loop. Entering "generating" before the
  // job is submitted shows the response card and its Stop button for the
  // whole queue wait, which is what makes an interrupt possible at all.
  updateTextGenerationState("generating");
  await executeHordeGeneration(messages, (text) => {
    updateResponse(text);
  });
}

export async function generateChatWithHorde(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
) {
  return await executeHordeGeneration(messages, onUpdate);
}

async function raceGenerations(
  messages: ChatMessage[],
  models: string[] | undefined,
  onUpdate: (text: string) => void,
): Promise<string> {
  const controllers: AbortController[] = [
    new AbortController(),
    new AbortController(),
  ];
  try {
    const startPromises = controllers.map(async (ctrl) => {
      const generation = await startGeneration(messages, ctrl.signal, models);
      return { id: generation.id, ctrl };
    });

    const startResults = await Promise.allSettled(startPromises);
    const generations: Array<{ id: string; ctrl: AbortController }> =
      startResults
        .map((generationPromise) =>
          generationPromise.status === "fulfilled"
            ? generationPromise.value
            : null,
        )
        .filter(
          (generation): generation is { id: string; ctrl: AbortController } =>
            generation !== null,
        );

    if (generations.length === 0) {
      throw new Error("Failed to start any AI Horde generation");
    }

    const raceState = { winnerId: null as string | null, hasWinner: false };
    const statusPromises = generations.map((generation) =>
      handleGenerationStatus(
        generation.id,
        (text: string) => {
          if (!raceState.hasWinner) {
            raceState.winnerId = generation.id;
            raceState.hasWinner = true;
          }
          if (raceState.winnerId === generation.id) {
            onUpdate(text);
          }
        },
        generation.ctrl.signal,
      ).then((result: string) => ({ result, generationId: generation.id })),
    );

    const winner = await Promise.race(statusPromises);

    await Promise.all(
      generations
        .filter((generation) => generation.id !== winner.generationId)
        .map((generation) => {
          try {
            generation.ctrl.abort();
          } catch (abortError) {
            addLogEntry(
              `Failed to abort generation ${generation.id}: ${abortError}`,
            );
          }
          return cancelGeneration(generation.id).catch((cancelError: Error) => {
            addLogEntry(
              `Failed to cancel generation ${generation.id}: ${cancelError}`,
            );
          });
        }),
    );

    return winner.result;
  } catch (error) {
    controllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (abortError) {
        addLogEntry(`Failed to abort controller: ${abortError}`);
      }
    });
    throw error;
  }
}

async function executeHordeGeneration(
  messages: ChatMessage[],
  onUpdate: (text: string) => void,
): Promise<string> {
  const settings = getSettings();

  if (settings.hordeModel) {
    const generation = await startGeneration(messages, undefined, [
      settings.hordeModel,
    ]);
    return await handleGenerationStatus(generation.id, onUpdate);
  }

  let topModels: string[] = [];
  try {
    topModels = await getTopHordeModels();
  } catch (error) {
    addLogEntry(
      `Failed to rank AI Horde models by requests this month, falling back to any available model: ${error}`,
    );
  }

  // The ranking fetch widened the window between the user pressing stop and
  // the jobs being submitted; close it before submitting.
  if (getTextGenerationState() === "interrupted") {
    throw new ChatGenerationError("Generation interrupted");
  }

  try {
    return await raceGenerations(
      messages,
      topModels.length > 0 ? topModels : undefined,
      onUpdate,
    );
  } catch (error) {
    if (
      topModels.length > 0 &&
      error instanceof ChatGenerationError &&
      error.message === GENERATION_NOT_POSSIBLE_MESSAGE
    ) {
      addLogEntry(
        "None of the top AI Horde models could take the generation, retrying with any available model",
      );
      return await raceGenerations(messages, undefined, onUpdate);
    }
    throw error;
  }
}

function formatPrompt(messages: ChatMessage[]): string {
  return `${messages
    .map((msg) => `**${msg.role?.toUpperCase()}**:\n${msg.content}`)
    .join("\n\n")}\n\n${assistantMarker}\n`;
}
