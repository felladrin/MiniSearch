/**
 * How fast one answer streamed in, for the muted line under it.
 *
 * A rate only comes out when it is exact, from one of two sources:
 *
 * - The engine measured it: wllama's last chunk carries llama.cpp's own
 *   `timings.predicted_per_second`, the decode speed with model load and the
 *   prompt left out. The browser model reloads itself on every answer, so
 *   anything timed from the request would read far slower than the model is.
 * - The backend reported how many tokens it wrote. The clock then runs from
 *   the first streamed text to the last, and the first token is left out of
 *   the count because it was generated before the clock started.
 *
 * Nothing is ever guessed from characters or from chunk counts, because an
 * estimate shown as an exact rate is worse than no rate.
 */
export class GenerationRateMeter {
  private readonly now: () => number;
  private firstDeltaTime: number | undefined;
  private lastDeltaTime: number | undefined;
  private reportedTokens: number | undefined;
  private measuredRate: number | undefined;

  /** `now` is injectable so a test can place the deltas on a timeline. */
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Records that text arrived, which moves the clock but counts no token. */
  onDelta(): void {
    const time = this.now();
    this.firstDeltaTime ??= time;
    this.lastDeltaTime = time;
  }

  /** The completion token count the backend reported, when it reports one. */
  setTokenCount(count: number | undefined): void {
    this.reportedTokens = count;
  }

  /** A rate the engine measured itself, in tokens per second. */
  setMeasuredRate(tokensPerSecond: number | undefined): void {
    this.measuredRate = tokensPerSecond;
  }

  /** The speed for the answer card, or nothing when it is not known exactly. */
  rate(): string | undefined {
    return formatRate(this.measuredRate ?? this.rateFromReportedCount());
  }

  private rateFromReportedCount(): number | undefined {
    const tokens = this.reportedTokens;
    if (
      tokens === undefined ||
      this.firstDeltaTime === undefined ||
      this.lastDeltaTime === undefined
    ) {
      return undefined;
    }
    const elapsedMs = this.lastDeltaTime - this.firstDeltaTime;
    // Text that arrives in one burst behind a buffering proxy would claim
    // thousands of tokens per second, so a span this short says nothing.
    if (elapsedMs < MIN_MEASURED_SPAN_MS) return undefined;
    return ((tokens - 1) * 1000) / elapsedMs;
  }
}

const MIN_MEASURED_SPAN_MS = 250;

function formatRate(tokensPerSecond: number | undefined): string | undefined {
  if (
    tokensPerSecond === undefined ||
    !Number.isFinite(tokensPerSecond) ||
    tokensPerSecond <= 0
  ) {
    return undefined;
  }
  // One decimal, so a browser model at 3.4 tokens/s does not read as 3,
  // and a whole number keeps no ".0" behind it.
  const rounded = Math.round(tokensPerSecond * 10) / 10;
  return rounded > 0 ? `${rounded} tokens/s` : undefined;
}
