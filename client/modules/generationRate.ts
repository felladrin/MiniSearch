/**
 * How fast one answer streamed in, for the muted line under it.
 *
 * The clock runs from the first generated token to the last one on purpose.
 * Model load, warmup and network time sit before the first token, and the
 * browser model reloads itself on every answer, so a rate measured from the
 * request would read far slower than the model is.
 *
 * A rate only comes out when the token count is known exactly: either the
 * backend streams one token per chunk, or it reports how many completion
 * tokens it wrote. Nothing is ever guessed from characters or from chunk
 * counts, because an estimate shown as an exact rate is worse than no rate.
 */
export class GenerationRateMeter {
  private readonly now: () => number;
  private firstTokenTime: number | undefined;
  private lastTokenTime: number | undefined;
  private countedTokens = 0;
  private reportedTokens: number | undefined;

  /** `now` is injectable so a test can place the tokens on a timeline. */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Records one generated token: the browser model streams exactly one per chunk. */
  onToken(): void {
    this.stamp();
    this.countedTokens += 1;
  }

  /** Records that text arrived without counting it: an API delta is not one token. */
  onDelta(): void {
    this.stamp();
  }

  /** The completion token count the backend reported, when it reports one. */
  setTokenCount(count: number | undefined): void {
    this.reportedTokens = count;
  }

  /** The speed for the answer card, or nothing when it is not known exactly. */
  rate(): string | undefined {
    const tokens = this.reportedTokens ?? this.countedTokens;
    const elapsedMs = this.elapsedMs;
    if (tokens <= 0 || elapsedMs <= 0) return undefined;

    const tokensPerSecond = (tokens * 1000) / elapsedMs;
    if (!Number.isFinite(tokensPerSecond)) return undefined;

    // One decimal, so a browser model at 3.4 tokens/s does not read as 3,
    // and a whole number keeps no ".0" behind it.
    const rounded = Math.round(tokensPerSecond * 10) / 10;
    return rounded > 0 ? `${rounded} tokens/s` : undefined;
  }

  /** How long the first token to the last one took; zero until two have arrived. */
  private get elapsedMs(): number {
    if (this.firstTokenTime === undefined || this.lastTokenTime === undefined) {
      return 0;
    }
    return this.lastTokenTime - this.firstTokenTime;
  }

  private stamp(): void {
    const time = this.now();
    this.firstTokenTime ??= time;
    this.lastTokenTime = time;
  }
}
