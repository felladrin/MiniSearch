type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Thresholds for one breaker, shared by every circuit it keeps. */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
}

interface CircuitMetrics {
  failures: number;
  successes: number;
  lastFailure?: number;
  state: CircuitState;
  /** Times this circuit has opened, which `resetMetrics` deliberately keeps. */
  opens: number;
}

const defaultOptions: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 3,
};

export class CircuitBreaker {
  private metrics: Map<string, CircuitMetrics> = new Map();
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  /** Runs `fn` under the named circuit, tripping it after repeated failures. */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.allows(key)) {
      throw new Error(`Circuit breaker is open for ${key}`);
    }

    try {
      const result = await fn();
      this.recordSuccess(key);
      return result;
    } catch (error) {
      this.recordFailure(key);
      throw error;
    }
  }

  /**
   * Whether a call under the named circuit may go ahead right now. An open
   * circuit whose reset timeout has elapsed becomes half-open here, so the
   * caller that asked is the one that probes it. With `recordSuccess` and
   * `recordFailure` this is `execute` taken apart, for a caller whose
   * failures are return values rather than exceptions.
   */
  allows(key: string): boolean {
    const metrics = this.metrics.get(key);
    if (metrics?.state !== "OPEN") return true;

    if (!this.shouldAttemptReset(metrics)) return false;

    metrics.state = "HALF_OPEN";
    return true;
  }

  /** A success under the named circuit: clears its failures, or closes it after a probe. */
  recordSuccess(key: string): void {
    // A circuit nothing has failed under is closed with no failures already,
    // so a success on it has nothing to record and no entry to create.
    const metrics = this.metrics.get(key);
    if (!metrics) return;

    if (metrics.state === "HALF_OPEN") {
      metrics.successes++;
      if (metrics.successes >= this.options.successThreshold) {
        this.resetMetrics(metrics);
      }
    } else {
      metrics.failures = 0;
    }
  }

  /** A failure under the named circuit, opening it at the threshold. */
  recordFailure(key: string): void {
    const metrics = this.getOrCreateMetrics(key);

    metrics.failures++;
    metrics.lastFailure = Date.now();
    metrics.successes = 0;

    if (
      metrics.failures >= this.options.failureThreshold &&
      metrics.state !== "OPEN"
    ) {
      metrics.state = "OPEN";
      metrics.opens++;
      setTimeout(() => {
        if (metrics.state === "OPEN") {
          metrics.state = "HALF_OPEN";
        }
      }, this.options.resetTimeout);
    }
  }

  getState(key: string): CircuitState {
    return this.metrics.get(key)?.state || "CLOSED";
  }

  /**
   * How often this circuit has opened. A closed circuit says nothing about
   * whether the instance spent the last hour serving no searches at all, which
   * is what this answers.
   */
  getOpens(key: string): number {
    return this.metrics.get(key)?.opens ?? 0;
  }

  private getOrCreateMetrics(key: string): CircuitMetrics {
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        failures: 0,
        successes: 0,
        state: "CLOSED",
        opens: 0,
      });
    }

    const metrics = this.metrics.get(key);
    if (!metrics) {
      throw new Error(`Failed to initialize circuit metrics for ${key}`);
    }
    return metrics;
  }

  private shouldAttemptReset(metrics: CircuitMetrics): boolean {
    if (metrics.state !== "OPEN") return false;
    if (!metrics.lastFailure) return true;

    const now = Date.now();
    return now - metrics.lastFailure > this.options.resetTimeout;
  }

  private resetMetrics(metrics: CircuitMetrics): void {
    metrics.failures = 0;
    metrics.successes = 0;
    metrics.lastFailure = undefined;
    metrics.state = "CLOSED";
  }
}
