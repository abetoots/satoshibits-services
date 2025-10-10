/**
 * Tests for error handlers and transformers
 */

import { Result } from "@satoshibits/functional";
import { describe, expect, it } from "vitest";
import { fail } from "node:assert";

import type { ErrorType, OperationalError } from "./types.mjs";

import {
  handleErrorType,
  mapError,
  recoverWith,
  recoverWithDefault,
  toLoggableFormat,
  withContext,
} from "./handlers.mjs";
import {
  createCircuitBreakerError,
  createConfigurationError,
  createCriticalError,
  createOperationalError,
  createRetryError,
  createTimeoutError,
  createValidationError,
  isOperationalError,
} from "./types.mjs";

describe("Error Handlers", () => {
  describe("mapError", () => {
    it("should transform error type", () => {
      const transformer = (error: { message: string }) => ({
        ...error,
        transformed: true,
      });
      const result = Result.err({ message: "error" });

      const mapped = mapError(transformer)(result);

      expect(mapped.success).toBe(false);
      if (mapped.success) fail("Expected error");
      expect(mapped.error.transformed).toBe(true);
      expect(mapped.error.message).toBe("error");
    });

    it("should pass through successful results", () => {
      const transformer = () => ({ transformed: true });
      const result = Result.ok<unknown, { transformed: boolean }>("success");

      const mapped = mapError(transformer)(result);

      expect(mapped.success).toBe(true);
      if (!mapped.success) fail("Expected success");
      expect(mapped.data).toBe("success");
    });
  });

  describe("withContext", () => {
    it("should add context to error", () => {
      const error = createOperationalError("test error");
      const context = {
        operation: "test-op",
        component: "test-component",
      };

      const errorWithContext = withContext(context)(error);

      expect(errorWithContext.context?.operation).toBe("test-op");
      expect(errorWithContext.context?.component).toBe("test-component");
      expect(errorWithContext.message).toBe("test error");
    });

    it("should merge with existing context", () => {
      const error = createOperationalError("test", true, {
        existingKey: "existing",
      });
      const context: Record<string, unknown> = {
        newKey: "new",
      };

      const errorWithContext = withContext(context)(error);

      expect(errorWithContext.context?.existingKey).toBe("existing");
      expect(errorWithContext.context?.newKey).toBe("new");
    });

    describe("edge cases", () => {
      it("should overwrite existing keys with new values", () => {
        const error = createOperationalError("test", true, {
          userId: "old-id",
          operation: "old-op",
        });
        const context: Record<string, unknown> = {
          userId: "new-id",
          requestId: "req-123",
        };

        const errorWithContext = withContext(context)(error);

        // new value should overwrite old value
        expect(errorWithContext.context?.userId).toBe("new-id");
        // old value should be preserved if not overwritten
        expect(errorWithContext.context?.operation).toBe("old-op");
        // new key should be added
        expect(errorWithContext.context?.requestId).toBe("req-123");
      });

      it("should perform shallow merge for nested objects", () => {
        const error = createOperationalError("test", true, {
          metadata: { existingProp: "old", sharedProp: "existing" },
          topLevel: "preserved",
        });
        const context: Record<string, unknown> = {
          metadata: { newProp: "new", sharedProp: "overwritten" },
        };

        const errorWithContext = withContext(context)(error);

        // shallow merge: entire nested object is replaced, not merged
        expect(errorWithContext.context?.metadata).toEqual({
          newProp: "new",
          sharedProp: "overwritten",
        });
        expect(errorWithContext.context?.topLevel).toBe("preserved");
      });

      it("should handle circular references without crashing", () => {
        // create circular reference
        const circular: Record<string, unknown> = { foo: "bar" };
        circular.self = circular;

        const error = createOperationalError("test");

        // should not crash - implementation uses spread operator which handles this
        expect(() => {
          const errorWithContext = withContext(circular)(error);
          expect(errorWithContext.context?.foo).toBe("bar");
        }).not.toThrow();
      });

      it("should handle null and undefined values in context", () => {
        const error = createOperationalError("test", true, {
          existingKey: "existing",
        });
        const context: Record<string, unknown> = {
          nullValue: null,
          undefinedValue: undefined,
          zeroValue: 0,
          emptyString: "",
        };

        const errorWithContext = withContext(context)(error);

        // all values should be preserved, including falsy ones
        expect(errorWithContext.context?.existingKey).toBe("existing");
        expect(errorWithContext.context?.nullValue).toBe(null);
        expect(errorWithContext.context?.undefinedValue).toBe(undefined);
        expect(errorWithContext.context?.zeroValue).toBe(0);
        expect(errorWithContext.context?.emptyString).toBe("");
      });
    });

  });

  describe("toLoggableFormat", () => {
    it("should transform error to loggable object with default options", () => {
      const error = createOperationalError("test error", true);
      const loggable = toLoggableFormat(error);

      expect(loggable.tag).toBe("operational");
      expect(loggable.message).toBe("test error");
      expect(loggable.recoverable).toBe(true);
      expect(loggable.retryable).toBe(true);
      expect(loggable.context).toBeUndefined();
      expect(loggable.timestamp).toBeUndefined();
    });

    it("should include context when requested", () => {
      const error = createOperationalError("test", true, { userId: "123" });
      const loggable = toLoggableFormat(error, { includeContext: true });

      expect(loggable.context).toEqual({ userId: "123" });
    });

    it("should include timestamp when requested", () => {
      const before = new Date();
      const error = createOperationalError("test");
      const loggable = toLoggableFormat(error, { includeTimestamp: true });
      const after = new Date();

      expect(loggable.timestamp).toBeDefined();
      expect(typeof loggable.timestamp).toBe("string");

      // verify ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(loggable.timestamp).toMatch(iso8601Regex);

      // verify timestamp is current (within reasonable timeframe)
      const timestamp = new Date(loggable.timestamp as string);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should include both context and timestamp when both requested", () => {
      const error = createOperationalError("test", true, { operation: "fetch" });
      const loggable = toLoggableFormat(error, {
        includeContext: true,
        includeTimestamp: true,
      });

      expect(loggable.context).toEqual({ operation: "fetch" });
      expect(loggable.timestamp).toBeDefined();
    });
  });

  describe("recoverWithDefault", () => {
    it("should recover with default on matching error", () => {
      const result = Result.err(createOperationalError("error"));
      const recovered = recoverWithDefault(
        "default",
        isOperationalError,
      )(result);

      expect(recovered.success).toBe(true);
      if (!recovered.success) fail("Expected success");
      expect(recovered.data).toBe("default");
    });

    it("should not recover if predicate returns false", () => {
      const error = createConfigurationError("config error");
      const result = Result.err(error);
      const recovered = recoverWithDefault(
        "default",
        isOperationalError,
      )(result);

      expect(recovered.success).toBe(false);
      if (recovered.success) fail("Expected error");
      expect(recovered.error).toBe(error);
    });

    it("should pass through successful results", () => {
      const result = Result.ok<string, ErrorType>("original");
      const recovered = recoverWithDefault("default", isOperationalError)(result);

      expect(recovered.success).toBe(true);
      if (!recovered.success) fail("Expected success");
      expect(recovered.data).toBe("original");
    });

    it("should recover using error.recoverable flag from taxonomy", () => {
      // TimeoutError has recoverable: true in the error taxonomy
      const error = createTimeoutError("request timeout", 5000);
      const result = Result.err(error);
      const recovered = recoverWithDefault("default", (e) => e.recoverable)(result);

      expect(recovered.success).toBe(true);
      if (!recovered.success) fail("Expected success");
      expect(recovered.data).toBe("default");
    });

    it("should not recover errors with recoverable: false", () => {
      // ConfigurationError has recoverable: false
      const error = createConfigurationError("bad config");
      const result = Result.err(error);
      const recovered = recoverWithDefault("default", (e) => e.recoverable)(result);

      expect(recovered.success).toBe(false);
      if (recovered.success) fail("Expected error");
      expect(recovered.error).toBe(error);
    });
  });

  describe("recoverWith", () => {
    it("should try recovery strategies in order", () => {
      const strategies = [
        (error: { code: string }) =>
          error.code === "A" ? Result.ok("recovered A") : null,
        (error: { code: string }) =>
          error.code === "B" ? Result.ok("recovered B") : null,
        () => Result.ok("fallback"),
      ];

      const result = Result.err({ code: "B" });
      const recovered = recoverWith(strategies)(result);

      expect(recovered.success).toBe(true);
      if (!recovered.success) fail("Expected success");
      expect(recovered.data).toBe("recovered B");
    });

    it("should return original error if no strategy succeeds", () => {
      const strategies = [() => null, () => Result.err("different error")];

      const error = createOperationalError("original");
      const result = Result.err<never, string>(error as unknown as string);
      const recovered = recoverWith(strategies)(result);

      expect(recovered.success).toBe(false);
      if (recovered.success) fail("Expected error");
      expect(recovered.error).toBe(error);
    });

    describe("edge cases", () => {
      it("should verify strategies are tried in order", () => {
        const callOrder: string[] = [];
        const strategies = [
          (error: { code: string }) => {
            callOrder.push("A");
            return error.code === "A" ? Result.ok("recovered A") : null;
          },
          (error: { code: string }) => {
            callOrder.push("B");
            return error.code === "B" ? Result.ok("recovered B") : null;
          },
        ];

        const result = Result.err({ code: "B" });
        const recovered = recoverWith(strategies)(result);

        expect(recovered.success).toBe(true);
        expect(callOrder).toEqual(["A", "B"]); // verify order
      });

      it("should stop at first successful strategy", () => {
        const callOrder: string[] = [];
        const strategies = [
          (_error: string) => {
            callOrder.push("1");
            return null;
          },
          (_error: string) => {
            callOrder.push("2");
            return Result.ok<string, string>("success");
          },
          (_error: string) => {
            callOrder.push("3");
            return Result.ok<string, string>("never called");
          },
        ];

        const recovered = recoverWith(strategies)(Result.err<string, string>("error"));

        expect(callOrder).toEqual(["1", "2"]); // should not call strategy 3
        expect(recovered.success).toBe(true);
      });

      it("should return original error when all strategies return null", () => {
        const strategies = [() => null, () => null, () => null];

        const error = createOperationalError("original");
        const result = Result.err(error);
        const recovered = recoverWith(strategies)(result);

        expect(recovered.success).toBe(false);
        if (recovered.success) fail("Expected error");
        expect(recovered.error).toBe(error);
      });

      it("should handle empty strategies array", () => {
        const strategies: (() => Result<string, ErrorType> | null)[] = [];

        const error = createOperationalError("original");
        const result = Result.err(error);
        const recovered = recoverWith(strategies)(result);

        expect(recovered.success).toBe(false);
        if (recovered.success) fail("Expected error");
        expect(recovered.error).toBe(error);
      });

      it("should ignore strategies that return Result.err", () => {
        const strategies = [
          (_error: OperationalError) => Result.err<string, OperationalError>(createValidationError("strategy 1 error") as unknown as OperationalError),
          (_error: OperationalError) => Result.err<string, OperationalError>(createOperationalError("strategy 2 error")),
          (_error: OperationalError) => Result.ok<string, OperationalError>("recovered"),
        ];

        const result = Result.err<string, OperationalError>(createOperationalError("original"));
        const recovered = recoverWith(strategies)(result);

        expect(recovered.success).toBe(true);
        if (!recovered.success) fail("Expected success");
        expect(recovered.data).toBe("recovered");
      });

      it("should propagate exception when strategy throws", () => {
        const strategies = [
          (_error: OperationalError): Result<string, OperationalError> | null => {
            throw new Error("Strategy error");
          },
          (_error: OperationalError) => Result.ok<string, OperationalError>("recovered after throw"),
        ];

        const result = Result.err<string, OperationalError>(createOperationalError("original"));

        // current behavior: strategy exceptions propagate to caller
        // this documents the actual behavior - strategies must not throw
        expect(() => recoverWith(strategies)(result)).toThrow("Strategy error");
      });
    });
  });

  describe("handleErrorType", () => {
    it("should handle configuration errors", () => {
      const handlers = {
        configuration: (_error: ErrorType) => Result.ok("config handled"),
        operational: (_error: ErrorType) => Result.ok("operational handled"),
      };

      const error: ErrorType = createConfigurationError("config error");
      const result = handleErrorType(handlers)(error);

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBe("config handled");
    });

    it("should handle operational errors", () => {
      const handlers = {
        operational: (_error: ErrorType) => Result.ok("operational handled"),
      };

      const error: ErrorType = createOperationalError("op error");
      const result = handleErrorType(handlers)(error);

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBe("operational handled");
    });

    it("should handle critical errors", () => {
      const handlers = {
        critical: (_error: ErrorType) => Result.ok("critical handled"),
      };

      const error: ErrorType = createCriticalError("critical error");
      const result = handleErrorType(handlers)(error);

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBe("critical handled");
    });

    it("should handle validation errors", () => {
      const handlers = {
        validation: (_error: ErrorType) => Result.ok("validation handled"),
      };

      const error: ErrorType = createValidationError("validation error");
      const result = handleErrorType(handlers)(error);

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBe("validation handled");
    });

    it("should use default handler if no specific handler", () => {
      const handlers = {
        default: (_error: ErrorType) => Result.ok("default handled"),
      };

      const error: ErrorType = createOperationalError("op error");
      const result = handleErrorType(handlers)(error);

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBe("default handled");
    });

    it("should return error if no handler matches", () => {
      const handlers = {
        configuration: (_error: ErrorType) => Result.ok("config handled"),
      };

      const error: ErrorType = createOperationalError("op error");
      const result = handleErrorType(handlers)(error);

      expect(result.success).toBe(false);
      if (result.success) fail("Expected error");
      expect(result.error).toBe(error);
    });

    describe("resilience error types", () => {
      it("should handle retry errors without specific handler", () => {
        const handlers = {
          operational: (_error: ErrorType) => Result.ok("operational handled"),
        };

        const retryError = createRetryError(
          3,
          createOperationalError("failed", true)
        );
        const result = handleErrorType(handlers)(retryError);

        // no retry handler, should return original error
        expect(result.success).toBe(false);
        if (result.success) fail("Expected error");
        expect(result.error).toBe(retryError);
      });

      it("should handle retry errors with specific handler", () => {
        const handlers = {
          retry: (error: ErrorType) => Result.ok(`retry handled: ${error.message}`),
        };

        const retryError = createRetryError(
          3,
          createOperationalError("failed", true)
        );
        const result = handleErrorType(handlers)(retryError);

        expect(result.success).toBe(true);
        if (!result.success) fail("Expected success");
        expect(result.data).toContain("retry handled");
      });

      it("should handle circuit breaker errors without specific handler", () => {
        const handlers = {
          operational: (_error: ErrorType) => Result.ok("operational handled"),
        };

        const cbError = createCircuitBreakerError("open", new Date());
        const result = handleErrorType(handlers)(cbError);

        // no circuit-breaker handler, should return original error
        expect(result.success).toBe(false);
        if (result.success) fail("Expected error");
        expect(result.error).toBe(cbError);
      });

      it("should handle circuit breaker errors with specific handler", () => {
        const handlers = {
          "circuit-breaker": (error: ErrorType) =>
            Result.ok(`circuit breaker handled: ${error.message}`),
        };

        const cbError = createCircuitBreakerError("open", new Date());
        const result = handleErrorType(handlers)(cbError);

        expect(result.success).toBe(true);
        if (!result.success) fail("Expected success");
        expect(result.data).toContain("circuit breaker handled");
      });

      it("should handle timeout errors without specific handler", () => {
        const handlers = {
          operational: (_error: ErrorType) => Result.ok("operational handled"),
        };

        const timeoutError = createTimeoutError("fetchData", 5000);
        const result = handleErrorType(handlers)(timeoutError);

        // no timeout handler, should return original error
        expect(result.success).toBe(false);
        if (result.success) fail("Expected error");
        expect(result.error).toBe(timeoutError);
      });

      it("should handle timeout errors with specific handler", () => {
        const handlers = {
          timeout: (error: ErrorType) =>
            Result.ok(`timeout handled: ${error.message}`),
        };

        const timeoutError = createTimeoutError("fetchData", 5000);
        const result = handleErrorType(handlers)(timeoutError);

        expect(result.success).toBe(true);
        if (!result.success) fail("Expected success");
        expect(result.data).toContain("timeout handled");
      });

      it("should use default handler for all unhandled resilience error types", () => {
        const handlers = {
          default: (error: ErrorType) => Result.ok(`default: ${error.tag}`),
        };

        const errors: ErrorType[] = [
          createRetryError(3, createOperationalError("retry")),
          createCircuitBreakerError("open"),
          createTimeoutError("timeout", 1000),
        ];

        errors.forEach((error) => {
          const result = handleErrorType(handlers)(error);
          expect(result.success).toBe(true);
          if (!result.success) fail("Expected success");
          expect(result.data).toContain("default:");
        });
      });
    });
  });
});
