import { describe, it, expect, vi } from "vitest";
import { Result } from "@satoshibits/functional";
import {
  retry,
  retrySync,
  createRetry,
} from "../retry.mjs";
import {
  createOperationalError,
  createValidationError,
  isRetryError,
  type ErrorType,
} from "../../types.mjs";

describe("Retry Pattern - Wrapper Layer Tests", () => {
  describe("retry() - Result conversion", () => {
    it("should return success immediately if function succeeds", async () => {
      const fn = vi.fn(() => Promise.resolve(Result.ok("success")));

      const result = await retry(fn);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("success");
      }
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should convert Result.err to RetryError when exhausted", async () => {
      const originalError = createOperationalError("fail", true);
      const fn = async () => Result.err(originalError);

      const result = await retry(fn, { maxAttempts: 3 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isRetryError(result.error)).toBe(true);
        if (isRetryError(result.error)) {
          expect(result.error.attempts).toBeDefined();
          expect(result.error.lastError).toBe(originalError);
          expect(result.error.tag).toBe("retry");
        }
      }
    });

    it("should not retry non-retryable errors", async () => {
      let attempts = 0;

      const fn = async () => {
        attempts++;
        return Result.err(createValidationError("not retryable")); // retryable: false
      };

      const result = await retry(fn, { maxAttempts: 5 });

      expect(attempts).toBe(1); // should stop immediately
      expect(result.success).toBe(false);
      if (!result.success) {
        // should return original error, not wrapped in RetryError
        expect(result.error.tag).toBe("validation");
        expect(isRetryError(result.error)).toBe(false);
      }
    });

    it("should retry retryable errors until success", async () => {
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount < 3) {
          return Result.err(createOperationalError("fail", true));
        }
        return Result.ok("success");
      };

      const result = await retry(fn, { maxAttempts: 5 });

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });

    it("should never throw, always return Result", async () => {
      const fn = async () => Result.err(createOperationalError("fail", true));

      await expect(retry(fn, { maxAttempts: 2 })).resolves.toBeDefined();

      const result = await retry(fn, { maxAttempts: 2 });
      expect(result).toHaveProperty("success");
    });
  });

  describe("BUG #1 & #2: maxAttempts validation", () => {
    it("should handle maxAttempts: 0 gracefully without throwing", async () => {
      const fn = vi.fn(() =>
        Promise.resolve(Result.err(createOperationalError("fail", true)))
      );

      // should validate and enforce minimum maxAttempts
      const result = await retry(fn, { maxAttempts: 0 });

      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalled(); // should attempt at least once after validation
    });

    it("should handle negative maxAttempts gracefully", async () => {
      const fn = vi.fn(() =>
        Promise.resolve(Result.err(createOperationalError("fail", true)))
      );

      const result = await retry(fn, { maxAttempts: -5 });

      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalled(); // should attempt at least once after validation
    });

    it("retrySync should handle maxAttempts: 0 without throwing Error", () => {
      const fn = vi.fn(() => Result.err(createOperationalError("fail", true)));

      // BUG: Currently throws "Internal error: retrySync completed without success or error"
      // After fix: should return Result, not throw
      expect(() => retrySync(fn, { maxAttempts: 0 })).not.toThrow();

      const result = retrySync(fn, { maxAttempts: 0 });
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalled();
    });

    it("retrySync should handle negative maxAttempts without throwing Error", () => {
      const fn = vi.fn(() => Result.err(createOperationalError("fail", true)));

      expect(() => retrySync(fn, { maxAttempts: -3 })).not.toThrow();

      const result = retrySync(fn, { maxAttempts: -3 });
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalled();
    });
  });

  describe("BUG #3: Type assertion bypass in retry predicate", () => {
    it("should handle non-ErrorType errors safely", async () => {
      const fn = async () => {
        // simulate wrapped function that somehow produces non-ErrorType
        const error = { message: "not an ErrorType" }; // missing retryable property
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return Result.err(error as any);
      };

      // BUG: Currently may throw TypeError when accessing error.retryable
      // After fix: should handle gracefully without throwing
      await expect(retry(fn, { maxAttempts: 2 })).resolves.toBeDefined();
    });

    it("should safely validate retryable property before accessing", async () => {
      const fn = async () => {
        // return object without retryable property
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return Result.err({ tag: "operational", message: "fail" } as any);
      };

      const customShouldRetry = (error: ErrorType) => {
        // this will fail if error doesn't have retryable or is not properly validated
        return error.retryable === true;
      };

      // should not throw, should handle gracefully
      await expect(
        retry(fn, { maxAttempts: 3, shouldRetry: customShouldRetry })
      ).resolves.toBeDefined();
    });
  });

  describe("BUG #6: Jitter generator configuration", () => {
    it("should respect jitter: false config", async () => {
      const fn = async () => Result.ok("success");

      // should use noJitterGenerator when jitter is false
      // we're not testing timing, just that it doesn't crash
      const result = await retry(fn, {
        maxAttempts: 1,
        jitter: false,
      });

      expect(result.success).toBe(true);
    });

    it("should respect jitter: true config (default)", async () => {
      const fn = async () => Result.ok("success");

      // should use decorrelatedJitterGenerator when jitter is true
      const result = await retry(fn, {
        maxAttempts: 1,
        jitter: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("retrySync() - synchronous wrapper", () => {
    it("should return success immediately if function succeeds", () => {
      const fn = vi.fn(() => Result.ok("success"));

      const result = retrySync(fn);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("success");
      }
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry retryable errors", () => {
      let callCount = 0;

      const fn = () => {
        callCount++;
        if (callCount < 3) {
          return Result.err(createOperationalError("fail", true));
        }
        return Result.ok("success");
      };

      const result = retrySync(fn, { maxAttempts: 3 });

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });

    it("should stop retrying on non-retryable errors", () => {
      let attempts = 0;

      const fn = () => {
        attempts++;
        return Result.err(createValidationError("not retryable"));
      };

      const result = retrySync(fn, { maxAttempts: 5 });

      expect(attempts).toBe(1);
      expect(result.success).toBe(false);
    });

    it("should return RetryError when max attempts exhausted", () => {
      let attempts = 0;

      const fn = () => {
        attempts++;
        return Result.err(createOperationalError("fail", true));
      };

      const result = retrySync(fn, { maxAttempts: 3 });

      expect(result.success).toBe(false);
      expect(attempts).toBe(3);
      if (!result.success) {
        expect(isRetryError(result.error)).toBe(true);
        if (isRetryError(result.error)) {
          expect(result.error.attempts).toBe(3);
        }
      }
    });
  });

  describe("Custom shouldRetry predicate", () => {
    it("should respect custom shouldRetry function", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        return Result.err(
          createOperationalError("fail", true, { code: "CUSTOM_ERROR" })
        );
      };

      const customShouldRetry = (error: ErrorType) => {
        // only retry if error has specific code
        return error.context?.code === "RETRY_ME";
      };

      const result = await retry(fn, {
        maxAttempts: 5,
        shouldRetry: customShouldRetry,
      });

      expect(attempts).toBe(1); // should not retry because code is CUSTOM_ERROR, not RETRY_ME
      expect(result.success).toBe(false);
    });
  });

  describe("RetryError creation", () => {
    it("should include attempt count in RetryError", async () => {
      const fn = async () => Result.err(createOperationalError("fail", true));

      const result = await retry(fn, { maxAttempts: 5 });

      expect(result.success).toBe(false);
      if (!result.success && isRetryError(result.error)) {
        expect(result.error.attempts).toBeDefined();
        expect(result.error.message).toContain("Maximum retry attempts");
      }
    });

    it("should include lastError in RetryError", async () => {
      const originalError = createOperationalError("original failure", true);
      const fn = async () => Result.err(originalError);

      const result = await retry(fn, { maxAttempts: 2 });

      expect(result.success).toBe(false);
      if (!result.success && isRetryError(result.error)) {
        expect(result.error.lastError).toBe(originalError);
      }
    });

    it("should create proper RetryError with correct properties", async () => {
      const fn = async () => Result.err(createOperationalError("fail", true));

      const result = await retry(fn, { maxAttempts: 3 });

      expect(result.success).toBe(false);
      if (!result.success && isRetryError(result.error)) {
        expect(result.error.tag).toBe("retry");
        expect(result.error.recoverable).toBe(false);
        expect(result.error.retryable).toBe(false);
        expect(result.error.attempts).toBeDefined();
        expect(result.error.lastError).toBeDefined();
      }
    });
  });

  describe("Configuration defaults", () => {
    it("should use default maxAttempts when not provided", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        return Result.err(createOperationalError("fail", true));
      };

      await retry(fn); // no config provided

      // default maxAttempts is 3 (but cockatiel might add 1, so we check it was called)
      expect(attempts).toBeGreaterThanOrEqual(3);
    });

    it("should use default jitter: true", async () => {
      const fn = async () => Result.ok("success");

      // default jitter: true, just verify it doesn't crash
      const result = await retry(fn);
      expect(result.success).toBe(true);
    });
  });

  describe("createRetry() - factory with reusable policy", () => {
    it("should create a reusable retry function", async () => {
      const fn = vi.fn(() => Promise.resolve(Result.ok("success")));

      const retryFn = createRetry(fn, { maxAttempts: 3 });

      // call multiple times to verify policy reuse
      const result1 = await retryFn();
      const result2 = await retryFn();
      const result3 = await retryFn();

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should retry retryable errors using the same policy", async () => {
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount % 2 === 0) {
          return Result.ok("success");
        }
        return Result.err(createOperationalError("fail", true));
      };

      const retryFn = createRetry(fn, { maxAttempts: 3 });

      // first call: fails once then succeeds
      callCount = 0;
      const result1 = await retryFn();
      expect(result1.success).toBe(true);

      // second call: fails once then succeeds (policy reused)
      callCount = 0;
      const result2 = await retryFn();
      expect(result2.success).toBe(true);
    });

    it("should return RetryError when exhausted", async () => {
      const originalError = createOperationalError("fail", true);
      const fn = async () => Result.err(originalError);

      const retryFn = createRetry(fn, { maxAttempts: 2 });

      const result = await retryFn();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isRetryError(result.error)).toBe(true);
        if (isRetryError(result.error)) {
          expect(result.error.lastError).toBe(originalError);
        }
      }
    });

    it("should not retry non-retryable errors", async () => {
      let attempts = 0;

      const fn = async () => {
        attempts++;
        return Result.err(createValidationError("not retryable"));
      };

      const retryFn = createRetry(fn, { maxAttempts: 5 });

      const result = await retryFn();

      expect(attempts).toBe(1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.tag).toBe("validation");
        expect(isRetryError(result.error)).toBe(false);
      }
    });

    it("should respect custom shouldRetry predicate", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        return Result.err(
          createOperationalError("fail", true, { code: "CUSTOM_ERROR" })
        );
      };

      const customShouldRetry = (error: ErrorType) => {
        return error.context?.code === "RETRY_ME";
      };

      const retryFn = createRetry(fn, {
        maxAttempts: 5,
        shouldRetry: customShouldRetry,
      });

      const result = await retryFn();

      expect(attempts).toBe(1);
      expect(result.success).toBe(false);
    });

    it("should handle multiple parallel calls with same retry function", async () => {
      let callCount = 0;

      const fn = async () => {
        callCount++;
        return Result.ok(`call-${callCount}`);
      };

      const retryFn = createRetry(fn, { maxAttempts: 3 });

      // execute multiple calls in parallel
      const results = await Promise.all([
        retryFn(),
        retryFn(),
        retryFn(),
      ]);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      expect(callCount).toBe(3);
    });

    it("should match retry() behavior for successful operations", async () => {
      const fn = async () => Result.ok("success");

      const directResult = await retry(fn, { maxAttempts: 3 });
      const factoryFn = createRetry(fn, { maxAttempts: 3 });
      const factoryResult = await factoryFn();

      expect(directResult).toEqual(factoryResult);
    });

    it("should match retry() behavior for failed operations", async () => {
      const error = createOperationalError("fail", true);
      const fn = async () => Result.err(error);

      const directResult = await retry(fn, { maxAttempts: 2 });
      const factoryFn = createRetry(fn, { maxAttempts: 2 });
      const factoryResult = await factoryFn();

      expect(directResult.success).toBe(false);
      expect(factoryResult.success).toBe(false);

      if (!directResult.success && !factoryResult.success) {
        expect(isRetryError(directResult.error)).toBe(true);
        expect(isRetryError(factoryResult.error)).toBe(true);
      }
    });
  });
});
