import debug from "debug";
import { vi } from "vitest";

/**
 * Captures what a module logs. `debug` resolves its writer at call time, so
 * replacing it here catches everything the module logs through `debug`, which
 * under jsdom never reaches `console` in a spy-able way. The console spies
 * cover the calls the module makes directly, so a new logging line is caught
 * whichever it uses.
 */
export function startLogCapture() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const originalLog = debug.log;
  debug.log = record;
  const spies = (["log", "info", "warn", "error", "debug"] as const).map(
    (method) => vi.spyOn(console, method).mockImplementation(record),
  );

  return {
    lines,
    stop() {
      debug.log = originalLog;
      for (const spy of spies) spy.mockRestore();
    },
  };
}
