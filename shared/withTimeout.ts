/** Aborts when `signal` does, or after `ms` milliseconds, whichever comes first. */
export function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
