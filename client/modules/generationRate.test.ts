import { describe, expect, it } from "vitest";
import { GenerationRateMeter } from "./generationRate";

/**
 * A meter on a clock the test moves by hand, so a rate never depends on how
 * long the test machine took between two statements.
 */
function meterOnClock() {
  let now = 0;
  return {
    set: (milliseconds: number) => {
      now = milliseconds;
    },
    meter: new GenerationRateMeter(() => now),
  };
}

/** Places `count` tokens on the clock, the last one at `lastAt`. */
function streamTokens(
  meter: GenerationRateMeter,
  set: (milliseconds: number) => void,
  count: number,
  firstAt: number,
  lastAt: number,
) {
  const step = count > 1 ? (lastAt - firstAt) / (count - 1) : 0;
  for (let index = 0; index < count; index++) {
    set(firstAt + step * index);
    meter.onToken();
  }
}

describe("GenerationRateMeter", () => {
  it("measures the tokens between the first token and the last one", () => {
    const { meter, set } = meterOnClock();

    streamTokens(meter, set, 42, 1000, 2000);

    expect(meter.rate()).toBe("42 tokens/s");
  });

  it("leaves everything before the first token out of the rate", () => {
    const { meter, set } = meterOnClock();

    // The model spent 30 seconds loading and warming up, then answered.
    streamTokens(meter, set, 11, 30000, 31000);

    expect(meter.rate()).toBe("11 tokens/s");
  });

  it("rounds to one decimal", () => {
    const { meter, set } = meterOnClock();

    streamTokens(meter, set, 10, 0, 3000);

    expect(meter.rate()).toBe("3.3 tokens/s");
  });

  it("keeps a whole number whole", () => {
    const { meter, set } = meterOnClock();

    streamTokens(meter, set, 20, 0, 1000);

    expect(meter.rate()).toBe("20 tokens/s");
  });

  it("shows nothing for an answer of one token", () => {
    const { meter, set } = meterOnClock();

    set(5000);
    meter.onToken();

    // One token spans no time, and dividing by zero is no rate.
    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when no token arrived", () => {
    const { meter } = meterOnClock();

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when the rate is too small to name", () => {
    const { meter, set } = meterOnClock();

    meter.onDelta();
    set(60000);
    meter.onDelta();
    meter.setTokenCount(1);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when the token count is not known", () => {
    const { meter, set } = meterOnClock();

    meter.onDelta();
    set(5000);
    meter.onDelta();
    meter.setTokenCount(undefined);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when the backend reports no generated token", () => {
    const { meter, set } = meterOnClock();

    meter.onDelta();
    set(5000);
    meter.onDelta();
    meter.setTokenCount(0);

    expect(meter.rate()).toBeUndefined();
  });

  it("counts a delta as time and not as a token", () => {
    const { meter, set } = meterOnClock();

    // Three deltas of any size, and the exact count the backend reported.
    meter.onDelta();
    set(2000);
    meter.onDelta();
    set(4000);
    meter.onDelta();
    meter.setTokenCount(50);

    expect(meter.rate()).toBe("12.5 tokens/s");
  });

  it("shows nothing for a count that is not a number", () => {
    const { meter, set } = meterOnClock();

    meter.onDelta();
    set(1000);
    meter.onDelta();
    meter.setTokenCount(Number.NaN);

    expect(meter.rate()).toBeUndefined();
  });

  it("shows nothing when the clock went backwards", () => {
    const { meter, set } = meterOnClock();

    set(5000);
    meter.onToken();
    set(4000);
    meter.onToken();

    expect(meter.rate()).toBeUndefined();
  });
});
