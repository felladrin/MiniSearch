import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./circuitBreaker";

describe("CircuitBreaker", () => {
  describe("constructor", () => {
    it("should use default options when no options provided", () => {
      const cb = new CircuitBreaker();
      expect(cb).toBeDefined();
    });

    it("should accept custom options", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 10,
        resetTimeout: 60000,
        successThreshold: 5,
      });
      expect(cb).toBeDefined();
    });
  });

  describe("getState", () => {
    it("should return CLOSED for unknown key", () => {
      const cb = new CircuitBreaker();
      expect(cb.getState("unknown")).toBe("CLOSED");
    });

    it("should return current state after successful execution", async () => {
      const cb = new CircuitBreaker();
      await cb.execute("test-key", async () => "success");
      expect(cb.getState("test-key")).toBe("CLOSED");
    });
  });

  describe("execute", () => {
    it("should execute async function successfully", async () => {
      const cb = new CircuitBreaker();
      const result = await cb.execute("test-key", async () => 42);
      expect(result).toBe(42);
    });

    it("should return string result", async () => {
      const cb = new CircuitBreaker();
      const result = await cb.execute("string-key", async () => "hello");
      expect(result).toBe("hello");
    });

    it("should propagate error from function", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 10 });
      await expect(
        cb.execute("error-key", async () => {
          throw new Error("function error");
        }),
      ).rejects.toThrow("function error");
    });

    it("should track failures and eventually open circuit", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 100,
      });

      await expect(
        cb.execute("fail-key", async () => {
          throw new Error("fail1");
        }),
      ).rejects.toThrow();

      await expect(
        cb.execute("fail-key", async () => {
          throw new Error("fail2");
        }),
      ).rejects.toThrow();

      const stateAfter = cb.getState("fail-key");
      expect(stateAfter === "OPEN" || stateAfter === "HALF_OPEN").toBe(true);
    });
  });
});
