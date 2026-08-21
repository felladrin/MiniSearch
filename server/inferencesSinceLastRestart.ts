/**
 * Aggregate counters for the AI answers served through `/inference`.
 *
 * Counts and durations only. The obvious thing to record about an inference is
 * the conversation, and that is the whole of what the user typed, so none of it
 * is kept: no prompt, no message, no answer, no token, and no timestamp per
 * request. Model ids are configuration rather than user data, and the endpoint
 * already sends them to the browser in every chunk, so those are named.
 */

/**
 * How a request that reached the streaming block ended. A request refused at
 * token verification is not one of these; those are counted as rejections in
 * `authorizationSinceLastRestart.ts`, and a request refused for its method or
 * its content type is answered before either counter is reached.
 */
export type InferenceOutcome =
  | "streamed"
  | "failedBeforeFirstToken"
  | "failedMidStream"
  | "abandoned"
  | "badRequest"
  | "notConfigured"
  | "modelListUnavailable"
  | "noModelAvailable"
  | "internalError"
  | "unclassified";

const outcomes: Record<InferenceOutcome, number> = {
  streamed: 0,
  failedBeforeFirstToken: 0,
  failedMidStream: 0,
  abandoned: 0,
  badRequest: 0,
  notConfigured: 0,
  modelListUnavailable: 0,
  noModelAvailable: 0,
  internalError: 0,
  unclassified: 0,
};

interface ModelCounts {
  attempted: number;
  streamed: number;
  failed: number;
  abandoned: number;
}

const byModel = new Map<string, ModelCounts>();

let totalAttempts = 0;
let requestsWithAttempts = 0;
let totalFirstTokenMs = 0;
let answersWithFirstToken = 0;
let totalStreamMs = 0;
let modelFallbacks = 0;
let modelsRefetched = 0;
let streamsEndedWithoutFinish = 0;

function countsFor(model: string): ModelCounts {
  const existing = byModel.get(model);
  if (existing) return existing;
  const created = { attempted: 0, streamed: 0, failed: 0, abandoned: 0 };
  byModel.set(model, created);
  return created;
}

export function recordModelAttempt(model: string): void {
  countsFor(model).attempted++;
}

export function recordModelStreamed(model: string): void {
  countsFor(model).streamed++;
}

export function recordModelFailure(model: string): void {
  countsFor(model).failed++;
}

/**
 * The client left while this model was streaming. Counted so that a model's
 * `attempted` always equals `streamed` plus `failed` plus this, rather than
 * quietly losing the attempts nobody stayed to read.
 */
export function recordModelAbandoned(model: string): void {
  countsFor(model).abandoned++;
}

/** A retry moved to another model, which is the only reason the pool exists. */
export function recordModelFallback(): void {
  modelFallbacks++;
}

export function recordModelsRefetched(): void {
  modelsRefetched++;
}

/**
 * The upstream closed a stream without a finish part. Counted per attempt
 * rather than per request, because the retry can still land on another model
 * and the request can still end as `streamed`.
 */
export function recordStreamEndedWithoutFinish(): void {
  streamsEndedWithoutFinish++;
}

/**
 * Records one finished request. `firstTokenMs` is the wait the user actually
 * felt, so it is kept apart from `durationMs`, which covers the whole answer.
 */
export function recordInference({
  outcome,
  durationMs,
  firstTokenMs,
  attempts,
}: {
  outcome: InferenceOutcome;
  durationMs: number;
  firstTokenMs?: number;
  attempts: number;
}): void {
  outcomes[outcome]++;
  totalStreamMs += durationMs;
  totalAttempts += attempts;
  if (attempts > 0) requestsWithAttempts++;
  if (firstTokenMs !== undefined) {
    totalFirstTokenMs += firstTokenMs;
    answersWithFirstToken++;
  }
}

/**
 * Every outcome sums to `requests`, so a request that stops being recorded
 * shows up as a gap rather than being lost silently. `outcomes.unclassified` is
 * that gap made visible: it should always be zero, and a non-zero value means
 * a path through the handler no longer reports what it did.
 */
export function getInferenceStats() {
  const { streamed, ...failed } = outcomes;
  const requests = Object.values(outcomes).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    requests,
    streamed,
    streamedRate: Number(((streamed / requests) * 100 || 0).toFixed(1)),
    averageTimeToFirstTokenMs: Math.round(
      totalFirstTokenMs / answersWithFirstToken || 0,
    ),
    averageDurationMs: Math.round(totalStreamMs / requests || 0),
    // Over the requests that reached the model loop at all: a request that
    // never had a model to try would otherwise drag the average below 1 and
    // make a thrashing pool look healthier the more unrelated traffic arrives.
    averageAttempts: Number(
      (totalAttempts / requestsWithAttempts || 0).toFixed(2),
    ),
    modelFallbacks,
    modelsRefetched,
    streamsEndedWithoutFinish,
    failed,
    byModel: Object.fromEntries(
      [...byModel].map(([model, counts]) => [model, { ...counts }]),
    ),
  };
}
