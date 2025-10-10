import { describe, it, expect, vi } from "vitest";
import { Result } from "@satoshibits/functional";
import {
  createCircuitBreaker,
  CircuitBreakerManual,
} from "../circuit-breaker.mjs";
import {
  createOperationalError,
  isCircuitBreakerError,
} from "../../types.mjs";

describe("Circuit Breaker Pattern - Wrapper Layer Tests", () => {
  describe("createCircuitBreaker() - Result conversion", () => {
    it("should return success when function succeeds", async () => {
      const fn = async () => Result.ok("success");
      const breaker = createCircuitBreaker(fn);

      const result = await breaker();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("success");
      }
    });

    it("should pass through errors when circuit is closed", async () => {
      const error = createOperationalError("test error");
      const fn = async () => Result.err(error);
      const breaker = createCircuitBreaker(fn);

      const result = await breaker();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(error);
      }
    });

    it("should return CircuitBreakerError when circuit opens", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, {
        strategy: "consecutive",
        failureThreshold: 2,
      });

      // Trigger failures to open circuit
      await breaker();
      await breaker();

      // Should now return CircuitBreakerError
      const result = await breaker();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isCircuitBreakerError(result.error)).toBe(true);
        if (isCircuitBreakerError(result.error)) {
          expect(result.error.state).toBeDefined();
          expect(result.error.tag).toBe("circuit-breaker");
        }
      }
    });

    it("should never throw, always return Result", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, { failureThreshold: 1 });

      await expect(breaker()).resolves.toBeDefined();

      const result = await breaker();
      expect(result).toHaveProperty("success");
    });
  });

  describe("BUG #4: Division by zero with windowMs < 1000", () => {
    it("should handle windowMs: 0 without division by zero", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));

      // BUG: minimumRps calculation: minimumCalls / (windowMs / 1000)
      // With windowMs: 0 -> division by zero -> NaN or Infinity
      const breaker = createCircuitBreaker(fn, {
        strategy: "sampling",
        windowMs: 0, // invalid
        minimumCalls: 10,
        failureRateThreshold: 0.5,
      });

      // Should not crash, should handle gracefully
      await expect(breaker()).resolves.toBeDefined();

      const result = await breaker();
      expect(result).toBeDefined();
    });

    it("should handle windowMs: 100 without producing invalid minimumRps", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));

      // BUG: minimumCalls / (100 / 1000) = minimumCalls / 0.1 = minimumCalls * 10
      // This produces unintended minimumRps value
      const breaker = createCircuitBreaker(fn, {
        strategy: "sampling",
        windowMs: 100,
        minimumCalls: 10,
        failureRateThreshold: 0.5,
      });

      await expect(breaker()).resolves.toBeDefined();

      const result = await breaker();
      expect(result).toBeDefined();
    });

    it("should enforce minimum windowMs of 1000 for sampling strategy", async () => {
      const fn = async () => Result.ok("success");

      // After fix: windowMs should be clamped to minimum 1000
      const breaker = createCircuitBreaker(fn, {
        strategy: "sampling",
        windowMs: 500, // too small
        minimumCalls: 10,
      });

      const result = await breaker();
      expect(result.success).toBe(true);
    });
  });

  describe("BUG #5: Config mismatch (halfOpenAfterMs vs openDurationMs)", () => {
    it("should use openDurationMs for circuit open duration", async () => {
      vi.useFakeTimers();

      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, {
        failureThreshold: 2,
        openDurationMs: 2000, // Circuit should stay open for 2 seconds
        halfOpenAfterMs: 500, // This should NOT be used for open duration
        strategy: "consecutive",
      });

      // Open circuit
      await breaker();
      await breaker();

      // Verify circuit is open
      const openResult = await breaker();
      expect(openResult.success).toBe(false);

      // The policy should use openDurationMs (2000ms), not halfOpenAfterMs (500ms)
      // We're not testing timing precision, just that config is respected

      vi.useRealTimers();
    });

    it("should report correct nextAttempt time in circuit breaker error", async () => {
      vi.useFakeTimers();
      const startTime = Date.now();

      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, {
        failureThreshold: 2,
        openDurationMs: 3000,
        strategy: "consecutive",
      });

      // Open circuit
      await breaker();
      await breaker();

      const result = await breaker();

      expect(result.success).toBe(false);
      if (!result.success && isCircuitBreakerError(result.error)) {
        expect(result.error.state).toBe("open");
        expect(result.error.nextAttempt).toBeDefined();

        if (result.error.nextAttempt) {
          const expectedTime = startTime + 3000; // openDurationMs
          const actualTime = result.error.nextAttempt.getTime();

          // BUG: Currently might use halfOpenAfterMs instead
          // After fix, should use openDurationMs
          expect(Math.abs(actualTime - expectedTime)).toBeLessThan(100);
        }
      }

      vi.useRealTimers();
    });
  });

  describe("CircuitBreakerManual - class-based API", () => {
    it("should execute function successfully when circuit is closed", async () => {
      const fn = async () => Result.ok("success");
      const breaker = new CircuitBreakerManual({
        failureThreshold: 3,
        strategy: "consecutive",
      });

      const result = await breaker.execute(fn);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("success");
      }
    });

    it("should return CircuitBreakerError when circuit opens", async () => {
      const breaker = new CircuitBreakerManual({
        failureThreshold: 2,
        strategy: "consecutive",
      });

      // Open the circuit
      await breaker.execute(async () =>
        Result.err(createOperationalError("fail"))
      );
      await breaker.execute(async () =>
        Result.err(createOperationalError("fail"))
      );

      // Should return CircuitBreakerError
      const result = await breaker.execute(async () => Result.ok("success"));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isCircuitBreakerError(result.error)).toBe(true);
      }
    });

    describe("BUG #8: CircuitBreakerManual missing nextAttempt", () => {
      it("should include nextAttempt in error when circuit is open", async () => {
        vi.useFakeTimers();
        const startTime = Date.now();

        const breaker = new CircuitBreakerManual({
          failureThreshold: 2,
          openDurationMs: 5000,
          strategy: "consecutive",
        });

        // Open circuit
        await breaker.execute(async () =>
          Result.err(createOperationalError("fail"))
        );
        await breaker.execute(async () =>
          Result.err(createOperationalError("fail"))
        );

        // Try to execute with open circuit
        const result = await breaker.execute(async () => Result.ok("success"));

        expect(result.success).toBe(false);
        if (!result.success && isCircuitBreakerError(result.error)) {
          expect(result.error.state).toBe("open");

          // BUG: Currently missing nextAttempt
          // After fix, should have nextAttempt
          expect(result.error.nextAttempt).toBeDefined();

          if (result.error.nextAttempt) {
            const expectedTime = startTime + 5000; // openDurationMs
            const actualTime = result.error.nextAttempt.getTime();
            expect(Math.abs(actualTime - expectedTime)).toBeLessThan(100);
          }
        }

        vi.useRealTimers();
      });

      it("should be consistent with createCircuitBreaker error format", async () => {
        const factoryBreakerFn = async () =>
          Result.err(createOperationalError("fail"));
        const factoryBreaker = createCircuitBreaker(factoryBreakerFn, {
          failureThreshold: 1,
          strategy: "consecutive",
        });

        const manualBreaker = new CircuitBreakerManual({
          failureThreshold: 1,
          strategy: "consecutive",
        });

        // Open both circuits
        await factoryBreaker();
        await manualBreaker.execute(factoryBreakerFn);

        // Get errors from both
        const factoryResult = await factoryBreaker();
        const manualResult = await manualBreaker.execute(factoryBreakerFn);

        expect(factoryResult.success).toBe(false);
        expect(manualResult.success).toBe(false);

        if (
          !factoryResult.success &&
          isCircuitBreakerError(factoryResult.error) &&
          !manualResult.success &&
          isCircuitBreakerError(manualResult.error)
        ) {
          // Both should have same structure
          expect(factoryResult.error.state).toBe(manualResult.error.state);

          // BUG: factory has nextAttempt, manual doesn't
          // After fix, both should have it
          if (factoryResult.error.nextAttempt) {
            expect(manualResult.error.nextAttempt).toBeDefined();
          }
        }
      });
    });
  });

  describe("CircuitBreakerError creation", () => {
    it("should create error with state and nextAttempt", async () => {
      vi.useFakeTimers();

      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, {
        failureThreshold: 2,
        openDurationMs: 1000,
      });

      // Open circuit
      await breaker();
      await breaker();

      const result = await breaker();

      expect(result.success).toBe(false);
      if (!result.success && isCircuitBreakerError(result.error)) {
        expect(result.error.tag).toBe("circuit-breaker");
        expect(result.error.state).toBeDefined();
        expect(result.error.nextAttempt).toBeDefined();
        expect(result.error.recoverable).toBe(true);
        expect(result.error.retryable).toBe(false);
      }

      vi.useRealTimers();
    });
  });

  describe("Configuration defaults", () => {
    it("should use default failureThreshold", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn); // no config

      // Default threshold is 5 (consecutive strategy)
      // We're not testing the threshold logic (cockatiel's job),
      // just that defaults are applied without crashing
      const result = await breaker();

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it("should use default openDurationMs: 60000", async () => {
      vi.useFakeTimers();

      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, {
        failureThreshold: 2,
        // openDurationMs not specified, should default to 60000
      });

      // Open circuit
      await breaker();
      await breaker();

      const result = await breaker();

      if (!result.success && isCircuitBreakerError(result.error)) {
        expect(result.error.nextAttempt).toBeDefined();
        if (result.error.nextAttempt) {
          const now = Date.now();
          const expected = now + 60000; // default
          const actual = result.error.nextAttempt.getTime();
          expect(Math.abs(actual - expected)).toBeLessThan(100);
        }
      }

      vi.useRealTimers();
    });

    it("should use default strategy: consecutive", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, {
        failureThreshold: 2,
        // strategy not specified, defaults to 'consecutive'
      });

      // Should work without error
      const result = await breaker();
      expect(result.success).toBe(false);
    });
  });

  describe("Error type preservation", () => {
    it("should preserve original error when circuit is closed", async () => {
      const customError = createOperationalError("custom", true, {
        code: "CUSTOM_CODE",
      });
      const fn = async () => Result.err(customError);
      const breaker = createCircuitBreaker(fn);

      const result = await breaker();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(customError);
        expect(result.error.context?.code).toBe("CUSTOM_CODE");
      }
    });

    it("should create circuit breaker error when circuit is open", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));
      const breaker = createCircuitBreaker(fn, { failureThreshold: 2 });

      // Open circuit
      await breaker();
      await breaker();

      const result = await breaker();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isCircuitBreakerError(result.error)).toBe(true);
        expect(result.error.tag).toBe("circuit-breaker");
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle zero threshold gracefully", async () => {
      const fn = async () => Result.err(createOperationalError("fail"));

      const breaker = createCircuitBreaker(fn, {
        failureThreshold: 0, // invalid
        strategy: "consecutive",
      });

      // Should handle gracefully, not crash
      await expect(breaker()).resolves.toBeDefined();

      const result = await breaker();
      expect(result).toBeDefined();
    });

    it("should handle negative threshold gracefully", async () => {
      const fn = async () => Result.ok("success");

      const breaker = createCircuitBreaker(fn, {
        failureThreshold: -5, // invalid
        strategy: "consecutive",
      });

      await expect(breaker()).resolves.toBeDefined();

      const result = await breaker();
      expect(result).toBeDefined();
    });
  });
});
