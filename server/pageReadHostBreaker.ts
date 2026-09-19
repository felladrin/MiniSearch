import type { PageReadOutcome } from "./pageReadsSinceLastRestart.ts";
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
} from "./utils/circuitBreaker.ts";

/**
 * The outcomes that are the host's doing, and so count toward boxing it: a
 * bot wall or rate limit (`httpForbidden`), any other non-ok status, a read
 * that hit the deadline, and a connection that was refused or dropped. A dead
 * link (`httpNotFound`) is the host answering, a page with too little text is
 * the page's fault, and `blocked` never reached the host at all, so none of
 * those count, and each of them resets the run of refusals the way a read
 * that worked does.
 */
const HOST_REFUSALS: ReadonlySet<string> = new Set<PageReadOutcome>([
  "httpForbidden",
  "httpOtherError",
  "timedOut",
  "failed",
]);

/**
 * One circuit per host in front of the page reader, in the shape of the
 * SearXNG breaker: after `failureThreshold` refusals in a row a host is
 * skipped for `resetTimeout`, then one read is let through to probe it, and a
 * success closes the circuit again. Unlike the SearXNG breaker it sits in
 * front of code that reports its failures as return values rather than
 * exceptions, so it drives the circuit through `admit` and `settle` instead
 * of `execute`.
 *
 * The host names it keys on stay in this object and never reach `/status`,
 * the log, or a counter: a host comes from a search result, so naming it
 * would say something about what someone searched for. What leaves here is
 * how often a circuit opened.
 */
export class PageReadHostBreaker {
  private readonly circuits: CircuitBreaker;
  /**
   * Hosts with a half-open probe in flight. Reads run in parallel over a
   * batch, and the class admits every caller while a circuit is half-open,
   * so without this a host that appears twice in the batch would be probed
   * twice, which is the double read the breaker exists to stop.
   */
  private readonly probing = new Set<string>();
  private opens = 0;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.circuits = new CircuitBreaker(options);
  }

  /**
   * Whether a read from `host` may go ahead now. Every admitted read must be
   * settled, or a half-open host keeps waiting for a probe that never ends.
   */
  admit(host: string): boolean {
    if (!this.circuits.allows(host)) return false;

    if (this.circuits.getState(host) === "HALF_OPEN") {
      if (this.probing.has(host)) return false;
      this.probing.add(host);
    }

    return true;
  }

  /** Records how an admitted read from `host` ended. */
  settle(host: string, outcome: string): void {
    this.probing.delete(host);

    if (!HOST_REFUSALS.has(outcome)) {
      this.circuits.recordSuccess(host);
      return;
    }

    const opensBefore = this.circuits.getOpens(host);
    this.circuits.recordFailure(host);
    this.opens += this.circuits.getOpens(host) - opensBefore;
  }

  /** How often any host's circuit has opened, which names no host. */
  getOpens(): number {
    return this.opens;
  }
}

/**
 * Three refusals rather than the SearXNG breaker's five: a refused read costs
 * the batch its whole wait, up to the 6 s deadline, and on the public instance
 * the hosts that refuse do so on every read, so the third is as sure as the
 * fifth. Five minutes rather than one: at that instance's rate the same host
 * comes back minutes apart, within one user's run of searches, and a minute's
 * box would usually have expired by then. One healthy probe closes it again,
 * as it does for SearXNG.
 */
export const pageReadHostBreaker = new PageReadHostBreaker({
  failureThreshold: 3,
  resetTimeout: 300_000,
  successThreshold: 1,
});

/**
 * How often a host's circuit has opened, for `/status`, beside the skipped
 * reads it counts under `pageReads.skipped.skippedByBreaker`: the skips
 * measure what the box saved, the opens are what `failureThreshold` moves.
 */
export function getPageReadCircuitStats() {
  return {
    circuitOpens: pageReadHostBreaker.getOpens(),
  };
}
