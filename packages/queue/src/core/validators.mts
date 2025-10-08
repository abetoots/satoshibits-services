/**
 * Constructor validation utilities for consistent behavior across Queue and Worker
 */

/**
 * Validates constructor parameters with consistent error messages
 * and assertion signatures for type narrowing
 */
export class ConstructorValidator {
  constructor(private readonly componentName: string) {}

  /**
   * Validates that a value is not explicitly undefined
   * Throws TypeError with descriptive message
   */
  rejectExplicitUndefined(
    field: string,
    value: unknown,
    expectedType: string,
  ): void {
    if (value === undefined) {
      throw new TypeError(
        `[${this.componentName}] ${field} must be ${expectedType}, got undefined`,
      );
    }
  }

  /**
   * Validates that a value is a function
   * Throws TypeError if not a function or explicitly undefined
   */
  requireFunction(
    field: string,
    value: unknown,
  ): asserts value is (...args: unknown[]) => unknown {
    if (typeof value !== "function") {
      throw new TypeError(
        `[${this.componentName}] ${field} must be a function, got ${typeof value}`,
      );
    }
  }

  /**
   * Validates that a number is finite and non-negative
   * Throws TypeError if invalid
   */
  requireFiniteNonNegativeNumber(
    field: string,
    value: unknown,
  ): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new TypeError(
        `[${this.componentName}] ${field} must be a finite non-negative number, got ${String(value)}`,
      );
    }
  }

  /**
   * Validates that a string is non-empty
   * Throws TypeError if empty or not a string
   */
  requireNonEmptyString(
    field: string,
    value: unknown,
  ): asserts value is string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(
        `[${this.componentName}] ${field} must be a non-empty string, got ${typeof value}`,
      );
    }
  }

  /**
   * Validates that a number is non-negative
   * Throws TypeError if negative or not a number
   */
  requireNonNegativeNumber(
    field: string,
    value: unknown,
  ): asserts value is number {
    if (typeof value !== "number" || value < 0) {
      throw new TypeError(
        `[${this.componentName}] ${field} must be a non-negative number, got ${String(value)}`,
      );
    }
  }
}
