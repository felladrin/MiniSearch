type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
}

interface CircuitMetrics {
  failures: number;
  successes: number;
  lastFailure?: number;
  state: CircuitState;
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

  /**
   * Execute a function with circuit breaker protection
   * @param key - Unique identifier for the circuit (e.g., model name)
   * @param fn - Function to execute
   * @returns Promise that resolves with the function result or rejects with an error
   */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const metrics = this.getOrCreateMetrics(key);

    if (metrics.state === "OPEN") {
      if (this.shouldAttemptReset(metrics)) {
        metrics.state = "HALF_OPEN";
      } else {
        throw new Error(`Circuit breaker is open for ${key}`);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess(metrics);
      return result;
    } catch (error) {
      this.recordFailure(metrics);
      throw error;
    }
  }

  /**
   * Get the current state of a circuit
   * @param key - Circuit identifier
   * @returns Current circuit state
   */
  getState(key: string): CircuitState {
    return this.metrics.get(key)?.state || "CLOSED";
  }

  private getOrCreateMetrics(key: string): CircuitMetrics {
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        failures: 0,
        successes: 0,
        state: "CLOSED",
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

  private recordSuccess(metrics: CircuitMetrics): void {
    if (metrics.state === "HALF_OPEN") {
      metrics.successes++;
      if (metrics.successes >= this.options.successThreshold) {
        this.resetMetrics(metrics);
      }
    } else {
      metrics.failures = 0;
    }
  }

  private recordFailure(metrics: CircuitMetrics): void {
    metrics.failures++;
    metrics.lastFailure = Date.now();
    metrics.successes = 0;

    if (
      metrics.failures >= this.options.failureThreshold &&
      metrics.state !== "OPEN"
    ) {
      metrics.state = "OPEN";
      setTimeout(() => {
        if (metrics.state === "OPEN") {
          metrics.state = "HALF_OPEN";
        }
      }, this.options.resetTimeout);
    }
  }

  private resetMetrics(metrics: CircuitMetrics): void {
    metrics.failures = 0;
    metrics.successes = 0;
    metrics.lastFailure = undefined;
    metrics.state = "CLOSED";
  }
}
