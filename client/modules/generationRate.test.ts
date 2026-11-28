import { describe, expect, it } from "vitest";
import { GenerationRateMeter } from "./generationRate";

/**
 * A meter on a clock the test moves by hand, so a rate never depends on how
 * long the test machine took between two statements.
 */
function meterOnClock() {
  let now = 0;
  const meter = new GenerationRateMeter(() => now);
  return {
    meter,
    /** Records text arriving at each of `times`, in milliseconds. */
    deltasAt: (...times: number[]) => {
      for (const time of times) {
        now = time;
        meter.onDelta();
      }
    },
  };
}

describe("GenerationRateMeter", () => {
  it("shows the rate the engine measured itself", () => {
    const { meter } = meterOnClock();
    meter.setMeasuredRate(23.766792915058094);

    expect(meter.rate()).toBe("23.8 tokens/s");
  });

  it("prefers the engine's measured rate to a reported count", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(0, 1000);
    meter.setTokenCount(500);
    meter.setMeasuredRate(12);

    expect(meter.rate()).toBe("12 tokens/s");
  });

  it("leaves the first token out of a reported count, since it came before the clock", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(1000, 6000);
    meter.setTokenCount(42);

    // 41 tokens over the 5 seconds between the first text and the last.
    expect(meter.rate()).toBe("8.2 tokens/s");
  });

  it("keeps a whole number whole", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(0, 2000);
    meter.setTokenCount(17);

    expect(meter.rate()).toBe("8 tokens/s");
  });

  it("shows nothing for text that arrived in one short burst", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(0, 249);
    meter.setTokenCount(300);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when the backend reports no count", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(0, 5000);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing for an answer of one token", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(0, 5000);
    meter.setTokenCount(1);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when no text arrived", () => {
    const { meter } = meterOnClock();
    meter.setTokenCount(42);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when the clock went backwards", () => {
    const { meter, deltasAt } = meterOnClock();
    deltasAt(5000, 1000);
    meter.setTokenCount(42);

    expect(meter.rate()).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -3])(
    "shows nothing for a measured rate of %s",
    (rate) => {
      const { meter } = meterOnClock();
      meter.setMeasuredRate(rate);

      expect(meter.rate()).toBeUndefined();
    },
  );
});
