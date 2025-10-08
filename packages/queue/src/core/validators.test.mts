import { describe, expect, it } from "vitest";

import { ConstructorValidator } from "./validators.mjs";

describe("ConstructorValidator", () => {
  describe("rejectExplicitUndefined", () => {
    it("should throw when value is undefined", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.rejectExplicitUndefined("field", undefined, "a string");
      }).toThrow(TypeError);
      expect((): void => {
        validator.rejectExplicitUndefined("field", undefined, "a string");
      }).toThrow(/field must be a string, got undefined/);
    });

    it("should not throw when value is not undefined", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.rejectExplicitUndefined("field", null, "a string");
      }).not.toThrow();
      expect((): void => {
        validator.rejectExplicitUndefined("field", "value", "a string");
      }).not.toThrow();
      expect((): void => {
        validator.rejectExplicitUndefined("field", 0, "a number");
      }).not.toThrow();
    });

    it("should include component name in error message", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "MyQueue",
      );

      expect((): void => {
        validator.rejectExplicitUndefined("jobId", undefined, "a function");
      }).toThrow(/\[MyQueue\]/);
    });
  });

  describe("requireFunction", () => {
    it("should throw when value is not a function", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFunction("handler", "not a function");
      }).toThrow(TypeError);
      expect((): void => {
        validator.requireFunction("handler", "not a function");
      }).toThrow(/handler must be a function, got string/);
    });

    it("should throw when value is undefined", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFunction("handler", undefined);
      }).toThrow(/handler must be a function, got undefined/);
    });

    it("should throw when value is null", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFunction("handler", null);
      }).toThrow(/handler must be a function, got object/);
    });

    it("should not throw when value is a function", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        validator.requireFunction("handler", () => {});
      }).not.toThrow();
      expect((): void => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        validator.requireFunction("handler", function () {});
      }).not.toThrow();
    });

    it("should narrow type to Function", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const value: unknown = () => {};

      // After calling requireFunction, value is narrowed to Function
      validator.requireFunction("handler", value);

      // This line will only compile if `value` has been narrowed to Function
      // This is a true compile-time check of the type guard
      const hasCallProperty = value.call !== undefined;
      expect(hasCallProperty).toBe(true);

      // Runtime check as sanity check
      expect(typeof value).toBe("function");
    });
  });

  describe("requireFiniteNonNegativeNumber", () => {
    it("should throw when value is not a number", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", "100");
      }).toThrow(/timeout must be a finite non-negative number, got 100/);
    });

    it("should throw when value is undefined", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", undefined);
      }).toThrow(/timeout must be a finite non-negative number, got undefined/);
    });

    it("should throw when value is negative", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", -100);
      }).toThrow(/timeout must be a finite non-negative number, got -100/);
    });

    it("should throw when value is Infinity", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", Infinity);
      }).toThrow(/timeout must be a finite non-negative number, got Infinity/);
    });

    it("should throw when value is NaN", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", NaN);
      }).toThrow(/timeout must be a finite non-negative number, got NaN/);
    });

    it("should not throw when value is zero", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", 0);
      }).not.toThrow();
    });

    it("should not throw when value is a positive number", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", 100);
      }).not.toThrow();
      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", 1.5);
      }).not.toThrow();
    });

    it("should narrow type to number", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );
      const value: unknown = 100;

      // After calling requireFiniteNonNegativeNumber, value is narrowed to number
      validator.requireFiniteNonNegativeNumber("timeout", value);

      // This line will only compile if `value` has been narrowed to number
      // This is a true compile-time check of the type guard
      const fixedValue = value.toFixed(2);
      expect(fixedValue).toBe("100.00");

      // Runtime check as sanity check
      expect(typeof value).toBe("number");
    });
  });

  describe("requireNonEmptyString", () => {
    it("should throw when value is not a string", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonEmptyString("name", 123);
      }).toThrow(/name must be a non-empty string, got number/);
    });

    it("should throw when value is empty string", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonEmptyString("name", "");
      }).toThrow(/name must be a non-empty string, got string/);
    });

    it("should throw when value is whitespace-only", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonEmptyString("name", "   ");
      }).toThrow(/name must be a non-empty string, got string/);
    });

    it("should throw when value is undefined", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonEmptyString("name", undefined);
      }).toThrow(/name must be a non-empty string, got undefined/);
    });

    it("should not throw when value is a non-empty string", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonEmptyString("name", "test");
      }).not.toThrow();
      expect((): void => {
        validator.requireNonEmptyString("name", "  test  ");
      }).not.toThrow();
    });

    it("should narrow type to string", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );
      const value: unknown = "test";

      // After calling requireNonEmptyString, value is narrowed to string
      validator.requireNonEmptyString("name", value);

      // This line will only compile if `value` has been narrowed to string
      // This is a true compile-time check of the type guard
      const lowerValue = value.toLowerCase();
      expect(lowerValue).toBe("test");

      // Runtime check as sanity check
      expect(typeof value).toBe("string");
    });
  });

  describe("requireNonNegativeNumber", () => {
    it("should throw when value is not a number", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonNegativeNumber("attempts", "3");
      }).toThrow(/attempts must be a non-negative number, got 3/);
    });

    it("should throw when value is negative", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonNegativeNumber("attempts", -1);
      }).toThrow(/attempts must be a non-negative number, got -1/);
    });

    it("should not throw when value is zero", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonNegativeNumber("attempts", 0);
      }).not.toThrow();
    });

    it("should not throw when value is positive", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonNegativeNumber("attempts", 3);
      }).not.toThrow();
    });

    it("should allow Infinity (unlike requireFiniteNonNegativeNumber)", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );

      expect((): void => {
        validator.requireNonNegativeNumber("max", Infinity);
      }).not.toThrow();
    });

    it("should narrow type to number", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "TestComponent",
      );
      const value: unknown = 3;

      // After calling requireNonNegativeNumber, value is narrowed to number
      validator.requireNonNegativeNumber("attempts", value);

      // This line will only compile if `value` has been narrowed to number
      // This is a true compile-time check of the type guard
      const fixedValue = value.toFixed(0);
      expect(fixedValue).toBe("3");

      // Runtime check as sanity check
      expect(typeof value).toBe("number");
    });
  });

  describe("component name in errors", () => {
    it("should use component name consistently across all validators", () => {
      const validator: ConstructorValidator = new ConstructorValidator(
        "Queue:my-queue",
      );

      expect((): void => {
        validator.rejectExplicitUndefined("field", undefined, "value");
      }).toThrow(/\[Queue:my-queue\]/);

      expect((): void => {
        validator.requireFunction("handler", "not-a-function");
      }).toThrow(/\[Queue:my-queue\]/);

      expect((): void => {
        validator.requireFiniteNonNegativeNumber("timeout", -1);
      }).toThrow(/\[Queue:my-queue\]/);

      expect((): void => {
        validator.requireNonEmptyString("name", "");
      }).toThrow(/\[Queue:my-queue\]/);

      expect((): void => {
        validator.requireNonNegativeNumber("attempts", -1);
      }).toThrow(/\[Queue:my-queue\]/);
    });
  });
});
