import { describe, expect, it } from "vitest";
import { sleep, sleepUntilIdle } from "./sleep";

describe("sleep", () => {
  it("should resolve after specified milliseconds", async () => {
    const start = Date.now();
    await sleep(10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(8);
  });

  it("should resolve quickly for 0 milliseconds", async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  it("should resolve for larger delays", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe("sleepUntilIdle", () => {
  it("should resolve quickly", async () => {
    const start = Date.now();
    await sleepUntilIdle();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});
