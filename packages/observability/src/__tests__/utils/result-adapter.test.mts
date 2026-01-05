/**
 * Tests for Universal Result Adapter
 */
import { describe, it, expect } from "vitest";
import {
  getResultAdapter,
  isResultLike,
  extractResultError,
  extractResultValue,
  isResultSuccess,
  isResultFailure,
} from "../../utils/result-adapter.mjs";

describe("Universal Result Adapter", () => {
  describe("@satoshibits/functional-errors pattern", () => {
    const successResult = {
      success: true,
      value: "test-value",
      error: null,
    };

    const errorResult = {
      success: false,
      value: null,
      error: new Error("test error"),
    };

    it("should detect @satoshibits success result", () => {
      const adapter = getResultAdapter(successResult);
      expect(adapter).not.toBeNull();
      expect(adapter!.isSuccess()).toBe(true);
      expect(adapter!.getValue()).toBe("test-value");
      expect(adapter!.getError()).toBeUndefined();
    });

    it("should detect @satoshibits error result", () => {
      const adapter = getResultAdapter(errorResult);
      expect(adapter).not.toBeNull();
      expect(adapter!.isSuccess()).toBe(false);
      expect(adapter!.getValue()).toBeUndefined();
      expect(adapter!.getError()).toBeInstanceOf(Error);
      expect(adapter!.getError()!.message).toBe("test error");
    });
  });

  describe("Rust-style Result pattern", () => {
    const successResult = {
      isOk: () => true,
      isErr: () => false,
      unwrap: () => "rust-value",
      unwrapErr: () => {
        throw new Error("Called unwrapErr on Ok");
      },
    };

    const errorResult = {
      isOk: () => false,
      isErr: () => true,
      unwrap: () => {
        throw new Error("Called unwrap on Err");
      },
      unwrapErr: () => new Error("rust error"),
    };

    it("should detect Rust-style success result", () => {
      const adapter = getResultAdapter(successResult);
      expect(adapter).not.toBeNull();
      expect(adapter!.isSuccess()).toBe(true);
      expect(adapter!.getValue()).toBe("rust-value");
      expect(adapter!.getError()).toBeUndefined();
    });

    it("should detect Rust-style error result", () => {
      const adapter = getResultAdapter(errorResult);
      expect(adapter).not.toBeNull();
      expect(adapter!.isSuccess()).toBe(false);
      expect(adapter!.getValue()).toBeUndefined();
      expect(adapter!.getError()).toBeInstanceOf(Error);
      expect(adapter!.getError()!.message).toBe("rust error");
    });

    it("should handle Rust-style with value/error properties", () => {
      const rustWithProps = {
        isOk: () => true,
        isErr: () => false,
        value: "prop-value",
      };

      const adapter = getResultAdapter(rustWithProps);
      expect(adapter!.getValue()).toBe("prop-value");
    });
  });

  describe("fp-ts Either pattern with _tag", () => {
    const rightResult = {
      _tag: "Right" as const,
      right: "fp-ts-value",
    };

    const leftResult = {
      _tag: "Left" as const,
      left: new Error("fp-ts error"),
    };

    it("should detect fp-ts Right result", () => {
      const adapter = getResultAdapter(rightResult);
      expect(adapter).not.toBeNull();
      expect(adapter!.isSuccess()).toBe(true);
      expect(adapter!.getValue()).toBe("fp-ts-value");
      expect(adapter!.getError()).toBeUndefined();
    });

    it("should detect fp-ts Left result", () => {
      const adapter = getResultAdapter(leftResult);
      expect(adapter).not.toBeNull();
      expect(adapter!.isSuccess()).toBe(false);
      expect(adapter!.getValue()).toBeUndefined();
      expect(adapter!.getError()).toBeInstanceOf(Error);
    });
  });

  describe("fp-ts Either pattern with methods", () => {
    const rightResult = {
      isRight: () => true,
      isLeft: () => false,
      right: "method-value",
    };

    const leftResult = {
      isRight: () => false,
      isLeft: () => true,
      left: new Error("method error"),
    };

    it("should detect fp-ts method-style Right", () => {
      const adapter = getResultAdapter(rightResult);
      expect(adapter!.isSuccess()).toBe(true);
      expect(adapter!.getValue()).toBe("method-value");
    });

    it("should detect fp-ts method-style Left", () => {
      const adapter = getResultAdapter(leftResult);
      expect(adapter!.isSuccess()).toBe(false);
      expect(adapter!.getError()).toBeInstanceOf(Error);
    });
  });

  describe("Generic ok/err pattern", () => {
    const okResult = {
      ok: true,
      value: "generic-value",
      error: null,
    };

    const errResult = {
      success: false,
      data: null,
      err: new Error("generic error"),
    };

    it("should detect generic ok pattern", () => {
      const adapter = getResultAdapter(okResult);
      expect(adapter!.isSuccess()).toBe(true);
      expect(adapter!.getValue()).toBe("generic-value");
    });

    it("should detect generic err pattern", () => {
      const adapter = getResultAdapter(errResult);
      expect(adapter!.isSuccess()).toBe(false);
      expect(adapter!.getError()).toBeInstanceOf(Error);
    });
  });

  describe("Non-Result types", () => {
    it("should return null for primitives", () => {
      expect(getResultAdapter("string")).toBeNull();
      expect(getResultAdapter(123)).toBeNull();
      expect(getResultAdapter(true)).toBeNull();
      expect(getResultAdapter(null)).toBeNull();
      expect(getResultAdapter(undefined)).toBeNull();
    });

    it("should return null for non-Result objects", () => {
      expect(getResultAdapter({ foo: "bar" })).toBeNull();
      expect(getResultAdapter({ value: 123 })).toBeNull();
      expect(getResultAdapter([])).toBeNull();
    });
  });

  describe("Helper functions", () => {
    const successResult = { success: true, value: "helper-test" };
    const errorResult = { success: false, error: new Error("helper-error") };
    const nonResult = { foo: "bar" };

    describe("isResultLike", () => {
      it("should identify Result-like objects", () => {
        expect(isResultLike(successResult)).toBe(true);
        expect(isResultLike(errorResult)).toBe(true);
        expect(isResultLike(nonResult)).toBe(false);
        expect(isResultLike("not-result")).toBe(false);
      });
    });

    describe("extractResultError", () => {
      it("should extract error from failure Result", () => {
        const error = extractResultError(errorResult);
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toBe("helper-error");
      });

      it("should return null for success Result", () => {
        expect(extractResultError(successResult)).toBeNull();
      });

      it("should return null for non-Result", () => {
        expect(extractResultError(nonResult)).toBeNull();
      });
    });

    describe("extractResultValue", () => {
      it("should extract value from success Result", () => {
        expect(extractResultValue(successResult)).toBe("helper-test");
      });

      it("should return null for error Result", () => {
        expect(extractResultValue(errorResult)).toBeNull();
      });

      it("should return null for non-Result", () => {
        expect(extractResultValue(nonResult)).toBeNull();
      });
    });

    describe("isResultSuccess", () => {
      it("should return true for success Result", () => {
        expect(isResultSuccess(successResult)).toBe(true);
      });

      it("should return false for error Result", () => {
        expect(isResultSuccess(errorResult)).toBe(false);
      });

      it("should return false for non-Result", () => {
        expect(isResultSuccess(nonResult)).toBe(false);
      });
    });

    describe("isResultFailure", () => {
      it("should return false for success Result", () => {
        expect(isResultFailure(successResult)).toBe(false);
      });

      it("should return true for error Result", () => {
        expect(isResultFailure(errorResult)).toBe(true);
      });

      it("should return false for non-Result", () => {
        expect(isResultFailure(nonResult)).toBe(false);
      });
    });
  });

  describe("Edge cases and robustness", () => {
    it("should handle missing unwrap methods gracefully", () => {
      const rustLike = {
        isOk: () => true,
        isErr: () => false,
        value: "fallback-value",
      };

      const adapter = getResultAdapter(rustLike);
      expect(adapter!.getValue()).toBe("fallback-value");
    });

    it("should handle objects with partial patterns", () => {
      const partialResult = {
        success: true,
        // Missing error property - should not match
      };

      expect(getResultAdapter(partialResult)).toBeNull();
    });

    it("should prioritize more specific patterns", () => {
      // Object that could match multiple patterns
      const ambiguous = {
        isOk: () => true,
        isErr: () => false,
        success: false, // This should be ignored due to priority
        unwrap: () => "rust-priority",
      };

      const adapter = getResultAdapter(ambiguous);
      expect(adapter!.getValue()).toBe("rust-priority");
    });

    it("should handle complex nested values", () => {
      const complexResult = {
        success: true,
        value: {
          nested: {
            data: "complex-value",
            array: [1, 2, 3],
          },
        },
      };

      const adapter = getResultAdapter(complexResult);
      expect(adapter!.getValue()).toEqual({
        nested: {
          data: "complex-value",
          array: [1, 2, 3],
        },
      });
    });
  });
});