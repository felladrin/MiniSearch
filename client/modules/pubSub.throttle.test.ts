import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const throttleInterval = 1000 / 12;

// Each test gets its own copy of the module, so the throttle window opened by
// one test cannot decide whether the next test's first write is a leading one.
async function loadResponseChannel() {
  vi.resetModules();
  return await import("./pubSub");
}

/** Subscribes to the response channel and records each published value. */
function collectPublished(
  responsePubSub: [
    unknown,
    (listener: (value: string) => void) => () => void,
    unknown,
  ],
) {
  const published: string[] = [];
  const unsubscribe = responsePubSub[1]((value) => {
    published.push(value);
  });
  return { published, unsubscribe };
}

describe("response publishing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes one leading and one trailing value per throttle window", async () => {
    const { responsePubSub, updateResponse } = await loadResponseChannel();
    const { published, unsubscribe } = collectPublished(responsePubSub);

    updateResponse("Hello");
    updateResponse("Hello world");
    updateResponse("Hello world!!!");

    expect(published).toEqual(["Hello"]);

    vi.advanceTimersByTime(throttleInterval);

    expect(published).toEqual(["Hello", "Hello world!!!"]);

    unsubscribe();
  });

  it("publishes the final value immediately and drops the queued trailing write", async () => {
    const {
      getResponse,
      responsePubSub,
      updateResponse,
      updateResponseImmediately,
    } = await loadResponseChannel();
    const { published, unsubscribe } = collectPublished(responsePubSub);

    updateResponse("Hello");
    updateResponse("Hello world, but truncated");

    updateResponseImmediately("Hello world, the complete answer");

    expect(getResponse()).toBe("Hello world, the complete answer");

    vi.advanceTimersByTime(throttleInterval * 3);

    expect(getResponse()).toBe("Hello world, the complete answer");
    expect(published).toEqual(["Hello", "Hello world, the complete answer"]);

    unsubscribe();
  });
});
