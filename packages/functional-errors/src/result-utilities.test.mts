/* eslint-disable @typescript-eslint/only-throw-error, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-return */

import { describe, it, expect, vi } from "vitest";
import { Result } from "@satoshibits/functional";

import type { ErrorType } from "./types.mjs";

import {
  createOperationalError,
} from "./types.mjs";
import {
  tryCatch,
  tryCatchSync,
} from "./result-utilities.mjs";

describe("Result Utilities", () => {
  const customError: ErrorType = {
    ...createOperationalError("Custom error"),
    tag: "operational" as const,
  };

  // standard error transform for test cases
  const defaultErrorTransform = (error: unknown): ErrorType =>
    createOperationalError(
      error instanceof Error ? error.message : String(error),
      false
    );

  describe("tryCatch()", () => {
    it("should return Result.ok on successful promise resolution", async () => {
      const result = await tryCatch(() => Promise.resolve(42), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(42);
      }
    });

    it("should handle promises that resolve to objects", async () => {
      const data = { id: 1, name: "test" };
      const result = await tryCatch(() => Promise.resolve(data), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("should handle promises that resolve to falsy values", async () => {
      // test null
      let result: Result<unknown, ErrorType> = await tryCatch(() => Promise.resolve(null), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(null);
      }

      // test undefined
      result = await tryCatch(() => Promise.resolve(undefined), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(undefined);
      }

      // test 0
      result = await tryCatch(() => Promise.resolve(0), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0);
      }

      // test false
      result = await tryCatch(() => Promise.resolve(false), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }

      // test empty string
      result = await tryCatch(() => Promise.resolve(""), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("");
      }
    });

    it("should return Result.err on promise rejection with Error", async () => {
      const error = new Error("Something went wrong");
      const result = await tryCatch(() => Promise.reject(error), defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Something went wrong");
        expect(result.error.tag).toBe("operational");
      }
    });

    it("should handle rejection with non-Error primitives", async () => {
      // string
      let result = await tryCatch(() => Promise.reject("string error"), defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("string error");
      }

      // number
      result = await tryCatch(() => Promise.reject(42), defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("42");
      }

      // null
      result = await tryCatch(() => Promise.reject(null), defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("null");
      }
    });

    it("should handle rejection with objects", async () => {
      const result = await tryCatch(() =>
        Promise.reject({ message: "custom error", code: 500 }),
        defaultErrorTransform
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("[object Object]");
      }
    });

    it("should use errorTransform when provided", async () => {
      const error = new Error("Original error");
      const transform = vi.fn((e: unknown) => customError);

      const result = await tryCatch(() => Promise.reject(error), transform);

      expect(transform).toHaveBeenCalledTimes(1);
      expect(transform).toHaveBeenCalledWith(error);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(customError);
      }
    });

    it("should handle errorTransform that throws", async () => {
      const error = new Error("Original error");
      const transform = () => {
        throw new Error("Transform failed");
      };

      const result = await tryCatch(() => Promise.reject(error), transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: Transform failed");
        expect(result.error.tag).toBe("operational");
        // CRITICAL: verify retryable is false to prevent infinite retry loops
        expect(result.error.retryable).toBe(false);
        // verify recoverable flag (operational errors are always recoverable)
        expect(result.error.recoverable).toBe(true);
      }
    });

    it("should handle errorTransform that throws non-Error values", async () => {
      const error = new Error("Original error");

      // test string throw
      let transform = () => {
        throw "Transform failed with string";
      };
      let result = await tryCatch(() => Promise.reject(error), transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: Transform failed with string");
        expect(result.error.tag).toBe("operational");
        expect(result.error.retryable).toBe(false);
      }

      // test number throw
      transform = () => {
        throw 42;
      };
      result = await tryCatch(() => Promise.reject(error), transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: 42");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle errorTransform that throws null or undefined", async () => {
      const error = new Error("Original error");

      // test null throw
      let transform = () => {
        throw null;
      };
      let result = await tryCatch(() => Promise.reject(error), transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: null");
        expect(result.error.tag).toBe("operational");
        expect(result.error.retryable).toBe(false);
      }

      // test undefined throw
      transform = () => {
        throw undefined;
      };
      result = await tryCatch(() => Promise.reject(error), transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: undefined");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle async functions that throw", async () => {
      const result = await tryCatch(async () => {
        await Promise.resolve(); // ensure it's async
        throw new Error("Async error");
      }, defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Async error");
      }
    });
  });

  describe("tryCatchSync()", () => {
    it("should return Result.ok on successful execution", () => {
      const result = tryCatchSync(() => 42, defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(42);
      }
    });

    it("should handle functions that return objects", () => {
      const data = { id: 1, name: "test" };
      const result = tryCatchSync(() => data, defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("should handle functions that return falsy values", () => {
      // test null
      let result: Result<unknown, ErrorType> = tryCatchSync(() => null, defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(null);
      }

      // test undefined
      result = tryCatchSync(() => undefined, defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(undefined);
      }

      // test 0
      result = tryCatchSync(() => 0, defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0);
      }

      // test false
      result = tryCatchSync(() => false, defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }

      // test empty string
      result = tryCatchSync(() => "", defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("");
      }
    });

    it("should return Result.err when function throws Error", () => {
      const result = tryCatchSync(() => {
        throw new Error("Sync error");
      }, defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("Sync error");
        expect(result.error.tag).toBe("operational");
      }
    });

    it("should handle non-Error thrown values", () => {
      // string
      let result = tryCatchSync(() => {
        throw "string error";
      }, defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("string error");
      }

      // number
      result = tryCatchSync(() => {
        throw 42;
      }, defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("42");
      }

      // object
      result = tryCatchSync(() => {
        throw { message: "custom", code: 500 };
      }, defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe("[object Object]");
      }
    });

    it("should use errorTransform when provided", () => {
      const error = new Error("Original error");
      const transform = vi.fn((e: unknown) => customError);

      const result = tryCatchSync(() => {
        throw error;
      }, transform);

      expect(transform).toHaveBeenCalledTimes(1);
      expect(transform).toHaveBeenCalledWith(error);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(customError);
      }
    });

    it("should handle errorTransform that throws", () => {
      const error = new Error("Original error");
      const transform = () => {
        throw new Error("Transform failed");
      };

      const result = tryCatchSync(() => {
        throw error;
      }, transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: Transform failed");
        expect(result.error.tag).toBe("operational");
        // CRITICAL: verify retryable is false to prevent infinite retry loops
        expect(result.error.retryable).toBe(false);
        // verify recoverable flag (operational errors are always recoverable)
        expect(result.error.recoverable).toBe(true);
      }
    });

    it("should handle errorTransform that throws non-Error values", () => {
      const error = new Error("Original error");

      // test string throw
      let transform = () => {
        throw "Transform failed with string";
      };
      let result = tryCatchSync(() => {
        throw error;
      }, transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: Transform failed with string");
        expect(result.error.tag).toBe("operational");
        expect(result.error.retryable).toBe(false);
      }

      // test number throw
      transform = () => {
        throw 42;
      };
      result = tryCatchSync(() => {
        throw error;
      }, transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: 42");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should handle errorTransform that throws null or undefined", () => {
      const error = new Error("Original error");

      // test null throw
      let transform = () => {
        throw null;
      };
      let result = tryCatchSync(() => {
        throw error;
      }, transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: null");
        expect(result.error.tag).toBe("operational");
        expect(result.error.retryable).toBe(false);
      }

      // test undefined throw
      transform = () => {
        throw undefined;
      };
      result = tryCatchSync(() => {
        throw error;
      }, transform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error transform failed: undefined");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("should work with JSON.parse", () => {
      const validJson = '{"key": "value"}';
      const invalidJson = "{invalid}";

      let result = tryCatchSync(() => JSON.parse(validJson), defaultErrorTransform);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key: "value" });
      }

      result = tryCatchSync(() => JSON.parse(invalidJson), defaultErrorTransform);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("JSON");
      }
    });
  });
});
