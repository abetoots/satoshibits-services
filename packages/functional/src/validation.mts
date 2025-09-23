/**
 * @module validation
 * @description Functional validation utilities using Result types for composable,
 * type-safe data validation. This module provides a rich set of validators and
 * combinators for building complex validation schemas. Unlike traditional validation
 * libraries that throw exceptions, all validators return Result types, making
 * error handling explicit and composable. Validators can be combined, transformed,
 * and reused to build sophisticated validation logic.
 *
 * ### For Dummies
 * - Validators are tiny functions that say "valid" or "here’s why not"—never exceptions.
 * - Chain them to collect multiple errors instead of stopping at the first failure.
 * - Everything returns a `Result`, so you keep success and error flows explicit.
 *
 * ### Decision Tree
 * - Need simple value checks? Grab primitives from `validators.string`, `validators.number`, etc.
 * - Combining rules for one field? Use `Validation.all(ruleA, ruleB, ...)`.
 * - Optional field? Wrap with `Validation.optional(rule)`.
 * - Validating objects? Build a `schema({ ... })` and reuse it.
 * - Handling errors? Inspect the returned `ValidationError`—it stores every message.
 *
 * @example
 * ```typescript
 * import { Validation, validators, schema, ValidationError } from './validation.mts';
 *
 * // simple validators
 * const validateAge = validators.number.between(0, 150);
 * const validateEmail = validators.string.email();
 *
 * // combining validators
 * const validatePassword = Validation.all(
 *   validators.string.minLength(8),
 *   validators.string.matches(/[A-Z]/, 'Must contain uppercase'),
 *   validators.string.matches(/[0-9]/, 'Must contain number')
 * );
 *
 * // object validation schema
 * const userSchema = schema({
 *   name: validators.string.nonEmpty(),
 *   email: validateEmail,
 *   age: Validation.optional(validateAge),
 *   password: validatePassword
 * });
 *
 * // using the validator
 * const result = userSchema({
 *   name: 'John Doe',
 *   email: 'john@example.com',
 *   age: 30,
 *   password: 'SecurePass123'
 * });
 *
 * if (result.success) {
 *   console.log('Valid user:', result.data);
 * } else {
 *   console.error('Validation errors:', result.error.errors);
 * }
 * ```
 *
 * @category Core
 * @since 2025-07-03
 */

import { Result } from "./result.mjs";

/**
 * Custom validation error that can hold multiple error messages.
 * @description Extends the standard Error class to accumulate multiple validation
 * errors. This allows validators to collect all errors rather than failing on
 * the first error, providing better user experience for form validation.
 *
 * @category Errors
 * @example
 * // Creating validation errors
 * const error = new ValidationError(['Name is required', 'Email is invalid']);
 * console.log(error.message); // "Validation failed: Name is required, Email is invalid"
 *
 * @example
 * // Working with errors
 * if (!result.success) {
 *   const validationError = result.error;
 *   console.log('First error:', validationError.firstError());
 *   console.log('All errors:', validationError.errors);
 *
 *   if (validationError.hasError('Email is invalid')) {
 *     // Handle email error specifically
 *   }
 * }
 *
 * @since 2025-07-03
 */
export class ValidationError extends Error {
  /**
   * Creates a new ValidationError with the given error messages.
   *
   * @param {string[]} errors - Array of error messages
   */
  constructor(public readonly errors: string[]) {
    super(`Validation failed: ${errors.join(", ")}`);
    this.name = "ValidationError";
  }

  /**
   * Adds additional errors to this validation error.
   * @description Creates a new ValidationError with the combined errors.
   * The original error remains unchanged (immutable).
   *
   * @param {string[]} newErrors - Additional error messages to add
   * @returns {ValidationError} A new ValidationError with all errors
   *
   * @example
   * const error1 = new ValidationError(['Name required']);
   * const error2 = error1.addErrors(['Email invalid']);
   * // error2.errors => ['Name required', 'Email invalid']
   * // error1.errors => ['Name required'] (unchanged)
   */
  addErrors(newErrors: string[]): ValidationError {
    return new ValidationError([...this.errors, ...newErrors]);
  }

  /**
   * Checks if this error contains a specific error message.
   * @description Useful for conditional error handling based on specific
   * validation failures.
   *
   * @param {string} error - The error message to check for
   * @returns {boolean} True if the error message is present
   *
   * @example
   * if (!result.success && result.error.hasError('Email is invalid')) {
   *   showEmailHelp();
   * }
   */
  hasError(error: string): boolean {
    return this.errors.includes(error);
  }

  /**
   * Gets the first error message.
   * @description Returns the first error in the list, useful when you only
   * want to display one error at a time.
   *
   * @returns {string | undefined} The first error message or undefined if no errors
   *
   * @example
   * const firstError = validationError.firstError();
   * if (firstError) {
   *   showToast(firstError);
   * }
   */
  firstError(): string | undefined {
    return this.errors[0];
  }
}

/**
 * A validator is a function that takes a value and returns a Result.
 * @description The core type of the validation system. Validators are pure functions
 * that take a value and return either a successful Result with the (possibly transformed)
 * value, or a failed Result with a ValidationError.
 *
 * @template T - The type of value being validated
 *
 * @category Types
 * @example
 * // Simple validator
 * const isPositive: Validator<number> = (n) =>
 *   n > 0 ? Result.ok(n) : Result.err(new ValidationError(['Must be positive']));
 *
 * @example
 * // Transforming validator
 * const trimString: Validator<string> = (s) =>
 *   Result.ok(s.trim());
 *
 * @since 2025-07-03
 */
export type Validator<T> = (value: T) => Result<T, ValidationError>;

/**
 * Validation utilities for creating and composing validators.
 * @description The main namespace for validation combinators and utilities.
 * Provides methods for creating, combining, and transforming validators
 * in a functional style.
 *
 * @category Utilities
 * @since 2025-07-03
 */
export const Validation = {
  /**
   * Creates a validator that always succeeds.
   * @description Useful as a default validator or when conditionally applying
   * validation. The value passes through unchanged.
   *
   * @template T - The type of value
   * @returns {Validator<T>} A validator that always returns success
   *
   * @category Constructors
   * @example
   * // Conditional validation
   * const validator = shouldValidate
   *   ? validators.string.email()
   *   : Validation.success();
   *
   * @since 2025-07-03
   */
  success:
    <T,>(): Validator<T> =>
    (value: T) =>
      Result.ok(value),

  /**
   * Creates a validator that always fails with the given error.
   * @description Useful for custom validation logic or placeholder validators
   * during development.
   *
   * @template T - The type of value
   * @param {string} error - The error message
   * @returns {Validator<T>} A validator that always returns failure
   *
   * @category Constructors
   * @example
   * // Feature flag validation
   * const validator = featureEnabled
   *   ? actualValidator
   *   : Validation.failure('Feature not available');
   *
   * @since 2025-07-03
   */
  failure:
    <T,>(error: string): Validator<T> =>
    () =>
      Result.err(new ValidationError([error])),

  /**
   * Creates a validator from a predicate function.
   * @description The fundamental building block for custom validators. Converts
   * a boolean-returning function into a validator.
   *
   * @template T - The type of value to validate
   * @param {function(T): boolean} predicate - Function that returns true if valid
   * @param {string} error - Error message if validation fails
   * @returns {Validator<T>} A validator based on the predicate
   *
   * @category Constructors
   * @example
   * // Custom age validator
   * const isAdult = Validation.fromPredicate(
   *   (age: number) => age >= 18,
   *   'Must be 18 or older'
   * );
   *
   * @example
   * // Complex validation
   * const isValidUsername = Validation.fromPredicate(
   *   (username: string) => /^[a-zA-Z0-9_]{3,20}$/.test(username),
   *   'Username must be 3-20 characters, alphanumeric or underscore'
   * );
   *
   * @since 2025-07-03
   */
  fromPredicate:
    <T,>(predicate: (value: T) => boolean, error: string): Validator<T> =>
    (value: T) =>
      predicate(value)
        ? Result.ok(value)
        : Result.err(new ValidationError([error])),

  /**
   * Combines multiple validators using AND logic.
   * @description All validators must pass for the validation to succeed.
   * Collects all errors from all validators before returning, providing
   * comprehensive feedback.
   *
   * @template T - The type of value to validate
   * @param {Validator<T>[]} validators - Validators to combine
   * @returns {Validator<T>} A validator that requires all validations to pass
   *
   * @category Combinators
   * @example
   * // Password validation
   * const validatePassword = Validation.all(
   *   validators.string.minLength(8),
   *   validators.string.matches(/[A-Z]/, 'Must contain uppercase'),
   *   validators.string.matches(/[0-9]/, 'Must contain number'),
   *   validators.string.matches(/[!@#$%]/, 'Must contain special character')
   * );
   *
   * @example
   * // Numeric range validation
   * const validatePercentage = Validation.all(
   *   validators.number.min(0),
   *   validators.number.max(100),
   *   validators.number.integer()
   * );
   *
   * @since 2025-07-03
   */
  all:
    <T,>(...validators: Validator<T>[]): Validator<T> =>
    (value: T) => {
      const errors: string[] = [];

      for (const validator of validators) {
        const result = validator(value);
        if (!result.success) {
          errors.push(
            ...(result as { success: false; error: ValidationError }).error
              .errors,
          );
        }
      }

      return errors.length === 0
        ? Result.ok(value)
        : Result.err(new ValidationError(errors));
    },

  /**
   * Combines multiple validators using OR logic.
   * @description At least one validator must pass for the validation to succeed.
   * Returns the result of the first successful validator, or all errors if
   * none succeed.
   *
   * @template T - The type of value to validate
   * @param {Validator<T>[]} validators - Validators to try
   * @returns {Validator<T>} A validator that requires at least one validation to pass
   *
   * @category Combinators
   * @example
   * // Multiple format support
   * const validateDate = Validation.any(
   *   validators.string.matches(/^\d{4}-\d{2}-\d{2}$/, 'Invalid ISO date'),
   *   validators.string.matches(/^\d{2}\/\d{2}\/\d{4}$/, 'Invalid US date')
   * );
   *
   * @example
   * // Flexible identifier
   * const validateIdentifier = Validation.any(
   *   validators.string.matches(/^\d+$/, 'Not a numeric ID'),
   *   validators.string.email(),
   *   validators.string.matches(/^[A-Z]{2,}$/, 'Not a code')
   * );
   *
   * @since 2025-07-03
   */
  any:
    <T,>(...validators: Validator<T>[]): Validator<T> =>
    (value: T) => {
      const errors: string[] = [];

      for (const validator of validators) {
        const result = validator(value);
        if (result.success) {
          return result;
        } else {
          errors.push(
            ...(result as { success: false; error: ValidationError }).error
              .errors,
          );
        }
      }

      return Result.err(new ValidationError(errors));
    },

  /**
   * Transforms the validated value if validation passes.
   * @description Note: The returned validator still takes an input of type T.
   * This is the functor map operation for validators, allowing value transformation
   * after successful validation.
   *
   * @template T - The input type
   * @template U - The output type
   * @param {function(T): U} fn - Function to transform the validated value
   * @returns {function(Validator<T>): function(T): Result<U, ValidationError>} A function that transforms validators
   *
   * @category Transformations
   * @example
   * // Normalize email
   * const normalizeEmail = Validation.map((email: string) => email.toLowerCase());
   * const validateEmail = normalizeEmail(validators.string.email());
   *
   * @example
   * // Parse and validate
   * const parseNumber = Validation.map((s: string) => parseInt(s, 10));
   * const validateNumericString = parseNumber(
   *   validators.string.matches(/^\d+$/, 'Must be numeric')
   * );
   *
   * @since 2025-07-03
   */
  map:
    <T, U>(fn: (value: T) => U) =>
    (validator: Validator<T>): ((value: T) => Result<U, ValidationError>) => {
      return (value: T): Result<U, ValidationError> => {
        const result = validator(value);
        return result.success
          ? Result.ok(fn(result.data))
          : (result as Result<U, ValidationError>);
      };
    },

  /**
   * Chains validators together.
   * @description The choice of the second validator depends on the successful
   * result of the first. This is the monadic bind operation for validators,
   * enabling dynamic validation based on previous results.
   *
   * @template T - The type being validated
   * @param {function(T): Validator<T>} fn - Function that returns the next validator
   * @returns {function(Validator<T>): Validator<T>} A function that chains validators
   *
   * @category Combinators
   * @example
   * // Conditional validation based on value
   * const validateScore = Validation.flatMap((score: number) => {
   *   if (score < 0) return Validation.failure('Negative scores not allowed');
   *   if (score > 100) return validators.number.max(200); // Allow bonus points
   *   return Validation.success();
   * });
   *
   * @example
   * // Dynamic validation
   * const validateField = Validation.flatMap((field: { type: string; value: any }) => {
   *   switch (field.type) {
   *     case 'email': return validators.string.email();
   *     case 'number': return validators.number.positive();
   *     default: return Validation.success();
   *   }
   * });
   *
   * @since 2025-07-03
   */
  flatMap:
    <T,>(fn: (value: T) => Validator<T>) =>
    (validator: Validator<T>): Validator<T> => {
      return (value: T): Result<T, ValidationError> => {
        const result = validator(value);
        if (result.success) {
          // Get the next validator based on the validated data
          const nextValidator = fn(result.data);
          // Apply the next validator to the successfully validated data
          return nextValidator(result.data);
        }
        // For error case, we return the original error
        return result;
      };
    },

  /**
   * Validates an optional value.
   * @description If the value is null or undefined, validation passes.
   * Otherwise, applies the validator. Useful for optional form fields
   * or nullable database columns.
   *
   * @template T - The type being validated
   * @param {Validator<T>} validator - Validator to apply if value is present
   * @returns {Validator<T | null | undefined>} A validator that handles optional values
   *
   * @category Modifiers
   * @example
   * // Optional email field
   * const validateOptionalEmail = Validation.optional(
   *   validators.string.email()
   * );
   *
   * validateOptionalEmail(null); // => { success: true, data: null }
   * validateOptionalEmail('user@example.com'); // => validates as email
   *
   * @example
   * // In object schema
   * const userSchema = schema({
   *   name: validators.string.nonEmpty(),
   *   email: validators.string.email(),
   *   phone: Validation.optional(validators.string.matches(/^\d{10}$/))
   * });
   *
   * @since 2025-07-03
   */
  optional:
    <T,>(validator: Validator<T>): Validator<T | null | undefined> =>
    (value: T | null | undefined) => {
      if (value === null || value === undefined) {
        return Result.ok(value);
      }
      return validator(value);
    },

  /**
   * Makes a validator required.
   * @description Fails if value is null or undefined. This is a type guard
   * that narrows T | null | undefined to T.
   *
   * @template T - The required type
   * @param {string} error - Error message if value is missing
   * @returns {Validator<T | null | undefined>} A validator that requires presence
   *
   * @category Modifiers
   * @example
   * // Basic usage
   * const required = Validation.required<string>();
   * required(null); // => { success: false, error: 'Value is required' }
   * required('hello'); // => { success: true, data: 'hello' }
   *
   * @example
   * // Combining with other validators
   * const validateName = Validation.all(
   *   Validation.required<string>('Name is required'),
   *   validators.string.minLength(2)
   * );
   *
   * @since 2025-07-03
   */
  required:
    <T,>(error = "Value is required"): Validator<T | null | undefined> =>
    (value: T | null | undefined) => {
      if (value === null || value === undefined) {
        return Result.err(new ValidationError([error]));
      }
      return Result.ok(value);
    },

  /**
   * Validates each item in an array.
   * @description Applies the same validator to each element of an array,
   * collecting all errors with their indices. Returns a new array with
   * validated (and possibly transformed) items.
   *
   * @template T - The type of array elements
   * @param {Validator<T>} itemValidator - Validator to apply to each item
   * @returns {Validator<T[]>} A validator for arrays
   *
   * @category Collections
   * @example
   * // Validate array of emails
   * const validateEmails = Validation.array(
   *   validators.string.email()
   * );
   *
   * const result = validateEmails([
   *   'user@example.com',
   *   'invalid-email',
   *   'admin@example.com'
   * ]);
   * // Error: "[1]: Invalid email format"
   *
   * @example
   * // Complex item validation
   * const validateUsers = Validation.array(
   *   schema({
   *     name: validators.string.nonEmpty(),
   *     age: validators.number.positive()
   *   })
   * );
   *
   * @since 2025-07-03
   */
  array:
    <T,>(itemValidator: Validator<T>): Validator<T[]> =>
    (values: T[]) => {
      const errors: string[] = [];
      const validatedItems: T[] = [];

      values.forEach((value, index) => {
        const result = itemValidator(value);
        if (result.success) {
          validatedItems.push(result.data);
        } else {
          errors.push(
            ...(
              result as { success: false; error: ValidationError }
            ).error.errors.map((err) => `[${index}]: ${err}`),
          );
        }
      });

      return errors.length === 0
        ? Result.ok(validatedItems)
        : Result.err(new ValidationError(errors));
    },

  /**
   * Validates properties of an object.
   * @description Validates specified properties of an object using individual
   * validators. Unspecified properties are passed through unchanged. Errors
   * are prefixed with the property name for clarity.
   *
   * @template T - The object type
   * @param {object} validators - Map of property names to validators
   * @returns {Validator<T>} A validator for the object
   *
   * @category Objects
   * @example
   * // Partial object validation
   * const validatePerson = Validation.object({
   *   name: validators.string.nonEmpty(),
   *   age: validators.number.positive()
   * });
   *
   * const result = validatePerson({
   *   name: 'John',
   *   age: -5,
   *   extra: 'ignored'
   * });
   * // Error: "age: Number must be positive"
   *
   * @see schema - Type-safe alternative for complete object validation
   * @since 2025-07-03
   */
  object:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Needed for flexible object validation
    <T extends Record<string, any>>(validators: {
        [K in keyof T]?: Validator<T[K]>;
      }): Validator<T> =>
      (obj: T) => {
        const errors: string[] = [];
        let validatedObj: T | null = null;

        for (const [key, validator] of Object.entries(validators)) {
          if (validator) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Type erasure from Object.entries
            const result = (validator as Validator<any>)(obj[key]);
            if (!result.success) {
              errors.push(
                ...(
                  result as { success: false; error: ValidationError }
                ).error.errors.map((err: string) => `${key}: ${err}`),
              );
            } else if (result.data !== obj[key]) {
              // Lazily create a copy only if data is transformed
              validatedObj ??= { ...obj };
              (validatedObj as Record<string, unknown>)[key] = result.data;
            }
          }
        }

        return errors.length === 0
          ? Result.ok(validatedObj ?? obj)
          : Result.err(new ValidationError(errors));
      },
};

/**
 * Common validators for primitive types.
 * @description Pre-built validators for common validation scenarios.
 * These validators can be used directly or combined with the Validation
 * combinators to create more complex validation logic.
 *
 * @category Validators
 * @example
 * // Using validators directly
 * const emailValidator = validators.string.email();
 * const ageValidator = validators.number.between(0, 150);
 *
 * @example
 * // Combining validators
 * const strongPassword = Validation.all(
 *   validators.string.minLength(12),
 *   validators.string.matches(/[A-Z]/, 'Need uppercase'),
 *   validators.string.matches(/[a-z]/, 'Need lowercase'),
 *   validators.string.matches(/[0-9]/, 'Need number')
 * );
 *
 * @since 2025-07-03
 */
export const validators = {
  /**
   * String validators.
   * @description Validators for string values including length checks,
   * format validation, and pattern matching.
   *
   * @category String Validators
   * @since 2025-07-03
   */
  string: {
    minLength: (min: number): Validator<string> =>
      Validation.fromPredicate(
        (str: string) => str.length >= min,
        `String must be at least ${min} characters long`,
      ),

    maxLength: (max: number): Validator<string> =>
      Validation.fromPredicate(
        (str: string) => str.length <= max,
        `String must be at most ${max} characters long`,
      ),

    nonEmpty: (): Validator<string> =>
      Validation.fromPredicate(
        (str: string) => str.trim().length > 0,
        "String cannot be empty",
      ),

    email: (): Validator<string> =>
      Validation.fromPredicate(
        // A more permissive regex, see https://emailregex.com/
        (str: string) =>
          /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(
            str,
          ),
        "Invalid email format",
      ),

    url: (): Validator<string> =>
      Validation.fromPredicate((str: string) => {
        try {
          new URL(str);
          return true;
        } catch {
          return false;
        }
      }, "Invalid URL format"),

    matches: (
      pattern: RegExp,
      error = "String does not match pattern",
    ): Validator<string> =>
      Validation.fromPredicate((str: string) => pattern.test(str), error),

    oneOf: (options: string[]): Validator<string> =>
      Validation.fromPredicate(
        (str: string) => options.includes(str),
        `String must be one of: ${options.join(", ")}`,
      ),
  },

  /**
   * Number validators.
   */
  number: {
    min: (min: number): Validator<number> =>
      Validation.fromPredicate(
        (num: number) => num >= min,
        `Number must be at least ${min}`,
      ),

    max: (max: number): Validator<number> =>
      Validation.fromPredicate(
        (num: number) => num <= max,
        `Number must be at most ${max}`,
      ),

    positive: (): Validator<number> =>
      Validation.fromPredicate(
        (num: number) => num > 0,
        "Number must be positive",
      ),

    nonNegative: (): Validator<number> =>
      Validation.fromPredicate(
        (num: number) => num >= 0,
        "Number must be non-negative",
      ),

    integer: (): Validator<number> =>
      Validation.fromPredicate(
        (num: number) => Number.isInteger(num),
        "Number must be an integer",
      ),

    between: (min: number, max: number): Validator<number> =>
      Validation.fromPredicate(
        (num: number) => num >= min && num <= max,
        `Number must be between ${min} and ${max}`,
      ),
  },

  /**
   * Array validators.
   */
  array: {
    minLength: <T,>(min: number): Validator<T[]> =>
      Validation.fromPredicate(
        (arr: T[]) => arr.length >= min,
        `Array must have at least ${min} items`,
      ),

    maxLength: <T,>(max: number): Validator<T[]> =>
      Validation.fromPredicate(
        (arr: T[]) => arr.length <= max,
        `Array must have at most ${max} items`,
      ),

    nonEmpty: <T,>(): Validator<T[]> =>
      Validation.fromPredicate(
        (arr: T[]) => arr.length > 0,
        "Array cannot be empty",
      ),

    unique: <T,>(): Validator<T[]> =>
      Validation.fromPredicate(
        (arr: T[]) => new Set(arr).size === arr.length,
        "Array must contain unique items",
      ),
  },

  /**
   * Date validators.
   */
  date: {
    after: (date: Date): Validator<Date> =>
      Validation.fromPredicate(
        (d: Date) => d > date,
        `Date must be after ${date.toISOString()}`,
      ),

    before: (date: Date): Validator<Date> =>
      Validation.fromPredicate(
        (d: Date) => d < date,
        `Date must be before ${date.toISOString()}`,
      ),

    future: (): Validator<Date> =>
      Validation.fromPredicate(
        (d: Date) => d > new Date(),
        "Date must be in the future",
      ),

    past: (): Validator<Date> =>
      Validation.fromPredicate(
        (d: Date) => d < new Date(),
        "Date must be in the past",
      ),
  },

  /**
   * Object validators.
   */
  object: {
    hasProperty: <T extends object>(prop: keyof T): Validator<T> =>
      Validation.fromPredicate(
        (obj: T) => prop in obj,
        `Object must have property '${String(prop)}'`,
      ),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Flexible for any object type
    notEmpty: (): Validator<Record<string, any>> =>
      Validation.fromPredicate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Matches return type
        (obj: Record<string, any>) => Object.keys(obj).length > 0,
        "Object cannot be empty",
      ),
  },
};

/**
 * Utility for creating complex validation schemas.
 * @description Type-safe wrapper around Validation.object that requires
 * validators for all properties of the type. This ensures complete
 * validation coverage for object types.
 *
 * @template T - The object type to validate
 * @param {object} validators - Validators for each property of T
 * @returns {Validator<T>} A validator for objects of type T
 *
 * @category Schema
 * @example
 * // Type-safe user validation
 * interface User {
 *   name: string;
 *   email: string;
 *   age: number;
 * }
 *
 * const userValidator = schema<User>({
 *   name: validators.string.nonEmpty(),
 *   email: validators.string.email(),
 *   age: validators.number.between(0, 150)
 * });
 *
 * @example
 * // Nested schemas
 * const addressValidator = schema({
 *   street: validators.string.nonEmpty(),
 *   city: validators.string.nonEmpty(),
 *   zipCode: validators.string.matches(/^\d{5}$/)
 * });
 *
 * const personValidator = schema({
 *   name: validators.string.nonEmpty(),
 *   address: addressValidator
 * });
 *
 * @since 2025-07-03
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Needed for flexible object validation
export const schema = <T extends Record<string, any>>(validators: {
  [K in keyof T]: Validator<T[K]>;
}): Validator<T> => Validation.object(validators);

/**
 * Validates a value and returns either the validated value or throws the error.
 * @description Use sparingly, only when you're certain validation should pass.
 * This bridges the Result-based validation system with exception-based code.
 *
 * @template T - The type being validated
 * @param {Validator<T>} validator - The validator to apply
 * @returns {function(T): T} A function that validates or throws
 * @throws {ValidationError} If validation fails
 *
 * @category Utilities
 * @example
 * // Configuration validation at startup
 * const validateConfig = validateOrThrow(
 *   schema({
 *     port: validators.number.between(1, 65535),
 *     host: validators.string.nonEmpty()
 *   })
 * );
 *
 * // Throws if invalid, otherwise returns validated config
 * const config = validateConfig(loadConfig());
 *
 * @example
 * // Input sanitization
 * const sanitizeEmail = validateOrThrow(
 *   Validation.map((s: string) => s.toLowerCase())(
 *     validators.string.email()
 *   )
 * );
 *
 * @since 2025-07-03
 */
export const validateOrThrow =
  <T,>(validator: Validator<T>) =>
  (value: T): T => {
    const result = validator(value);
    if (result.success) {
      return result.data;
    } else {
      throw (result as { success: false; error: ValidationError }).error;
    }
  };
