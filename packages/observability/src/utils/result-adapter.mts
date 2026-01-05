/**
 * Universal Result Adapter for Functional Programming Libraries
 * 
 * Provides agnostic handling of different Result type implementations to ensure
 * the observability library works with any functional programming approach.
 * Supports automatic detection and unified handling of Result patterns from
 * popular libraries without requiring users to write adapter code.
 * 
 * @fileoverview
 * This module implements the Adapter Pattern to provide a unified interface for
 * different Result type implementations commonly used in functional programming.
 * The adapter automatically detects Result-like objects and provides a consistent
 * API for success/error handling regardless of the underlying library.
 * 
 * @author Observability Team
 * @since 1.0.0
 * 
 * @example
 * ```typescript
 * import { getResultAdapter, isResultLike } from './result-adapter.mjs';
 * 
 * // Works with @satoshibits/functional-errors
 * const satoshiResult = { success: true, value: "data", error: null };
 * const adapter1 = getResultAdapter(satoshiResult);
 * 
 * // Works with Rust-style Results
 * const rustResult = { 
 *   isOk: () => true, 
 *   isErr: () => false, 
 *   unwrap: () => "data" 
 * };
 * const adapter2 = getResultAdapter(rustResult);
 * 
 * // Works with fp-ts Either
 * const fptsResult = { _tag: "Right", right: "data" };
 * const adapter3 = getResultAdapter(fptsResult);
 * 
 * // All adapters provide the same interface
 * console.log(adapter1?.isSuccess()); // true
 * console.log(adapter2?.getValue());  // "data"
 * console.log(adapter3?.getError());  // undefined
 * ```
 */

/**
 * Unified interface for all Result types
 * 
 * Provides a consistent API for interacting with any Result-like object,
 * regardless of the underlying implementation. This interface abstracts away
 * the differences between various Result type libraries.
 * 
 * @template T - The success value type
 * @template E - The error type
 * 
 * @public
 * @since 1.0.0
 */
interface IAdaptedResult<T, E> {
  /**
   * Check if the Result represents a successful outcome
   * @returns True if the Result contains a success value, false if it contains an error
   */
  isSuccess(): boolean;
  
  /**
   * Extract the success value from the Result
   * @returns The success value if available, undefined if the Result represents an error
   */
  getValue(): T | undefined;
  
  /**
   * Extract the error from the Result
   * @returns The error if the Result represents a failure, undefined if it represents success
   */
  getError(): E | undefined;
}

/**
 * Detect and adapt any Result-like type to our unified interface
 * 
 * Analyzes the input object using duck typing to identify Result patterns from
 * various functional programming libraries. Returns an adapter that provides a
 * unified interface regardless of the underlying Result implementation.
 * 
 * @template T - The expected success value type
 * @template E - The expected error type (defaults to Error)
 * 
 * @param input - The potentially Result-like object to analyze and adapt
 * @returns An adapter implementing IAdaptedResult, or null if not Result-like
 * 
 * @public
 * @since 1.0.0
 * 
 * @example
 * ```typescript
 * // @satoshibits/functional-errors pattern
 * const satoshiResult = { success: true, value: "data", error: null };
 * const adapter = getResultAdapter<string>(satoshiResult);
 * if (adapter?.isSuccess()) {
 *   console.log(adapter.getValue()); // "data"
 * }
 * 
 * // Rust-style pattern
 * const rustResult = { isOk: () => true, unwrap: () => "data" };
 * const rustAdapter = getResultAdapter<string>(rustResult);
 * 
 * // fp-ts Either pattern
 * const either = { _tag: "Right", right: "data" };
 * const eitherAdapter = getResultAdapter<string>(either);
 * ```
 * 
 * @remarks
 * Supported Result patterns (in order of precedence):
 * 1. Rust-style: Objects with `isOk()` and `isErr()` methods
 * 2. @satoshibits/functional-errors: Objects with `success` boolean and `error` properties
 * 3. fp-ts Either with `_tag`: Objects with `_tag: "Right"|"Left"`
 * 4. fp-ts Either with methods: Objects with `isRight()` and `isLeft()` methods
 * 5. Generic patterns: Objects with success/ok and error/err/failure properties
 * 
 * Returns null for non-objects or objects that don't match any Result pattern.
 */
export function getResultAdapter<T = unknown, E = Error>(
  input: unknown
): IAdaptedResult<T, E> | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const obj = input as Record<string, unknown>;

  // Rust-style: .isOk() / .isErr() methods
  if ('isOk' in obj && typeof obj.isOk === 'function' && 'isErr' in obj) {
    return {
      isSuccess: () => (obj.isOk as () => boolean)(),
      getValue: () => {
        if ((obj.isOk as () => boolean)()) {
          // Try common unwrap patterns
          if ('unwrap' in obj && typeof obj.unwrap === 'function') {
            return (obj.unwrap as () => T)();
          }
          if ('value' in obj) {
            return obj.value as T;
          }
        }
        return undefined;
      },
      getError: () => {
        if ((obj.isErr as () => boolean)()) {
          // Try common unwrap patterns
          if ('unwrapErr' in obj && typeof obj.unwrapErr === 'function') {
            return (obj.unwrapErr as () => E)();
          }
          if ('error' in obj) {
            return obj.error as E;
          }
        }
        return undefined;
      },
    };
  }

  // @satoshibits/functional-errors: .success property
  if ('success' in obj && typeof obj.success === 'boolean' && 'error' in obj) {
    return {
      isSuccess: () => obj.success as boolean,
      getValue: () => {
        if (obj.success) {
          return ('value' in obj ? obj.value : obj.data) as T;
        }
        return undefined;
      },
      getError: () => {
        if (!obj.success) {
          return obj.error as E;
        }
        return undefined;
      },
    };
  }

  // fp-ts: ._tag property
  if ('_tag' in obj && (obj._tag === 'Right' || obj._tag === 'Left')) {
    return {
      isSuccess: () => obj._tag === 'Right',
      getValue: () => {
        if (obj._tag === 'Right' && 'right' in obj) {
          return obj.right as T;
        }
        return undefined;
      },
      getError: () => {
        if (obj._tag === 'Left' && 'left' in obj) {
          return obj.left as E;
        }
        return undefined;
      },
    };
  }

  // fp-ts: .isRight() / .isLeft() methods  
  if ('isRight' in obj && typeof obj.isRight === 'function' && 'isLeft' in obj) {
    return {
      isSuccess: () => (obj.isRight as () => boolean)(),
      getValue: () => {
        if ((obj.isRight as () => boolean)()) {
          return ('right' in obj ? obj.right : obj.value) as T;
        }
        return undefined;
      },
      getError: () => {
        if ((obj.isLeft as () => boolean)()) {
          return ('left' in obj ? obj.left : obj.error) as E;
        }
        return undefined;
      },
    };
  }

  // Generic success/failure pattern (broader catch-all)
  if (('ok' in obj || 'success' in obj) && ('err' in obj || 'error' in obj || 'failure' in obj)) {
    // More robust check - ensure success properties are explicitly true
    const isSuccess = obj.ok === true || obj.success === true;
    return {
      isSuccess: () => isSuccess,
      getValue: () => {
        if (isSuccess) {
          return ('value' in obj ? obj.value : obj.data) as T;
        }
        return undefined;
      },
      getError: () => {
        if (!isSuccess) {
          return (obj.err ?? obj.error ?? obj.failure) as E;
        }
        return undefined;
      },
    };
  }

  return null;
}

/**
 * Type guard to check if a value is Result-like
 */
export function isResultLike(value: unknown): boolean {
  return getResultAdapter(value) !== null;
}

/**
 * Helper to safely extract error from any Result type
 */
export function extractResultError<E = Error>(result: unknown): E | null {
  const adapter = getResultAdapter<unknown, E>(result);
  if (!adapter) return null;
  
  return adapter.isSuccess() ? null : adapter.getError() ?? null;
}

/**
 * Helper to safely extract value from any Result type
 */
export function extractResultValue<T = unknown>(result: unknown): T | null {
  const adapter = getResultAdapter<T, unknown>(result);
  if (!adapter) return null;
  
  return adapter.isSuccess() ? adapter.getValue() ?? null : null;
}

/**
 * Helper to check if any Result type represents success
 */
export function isResultSuccess(result: unknown): boolean {
  const adapter = getResultAdapter(result);
  return adapter?.isSuccess() ?? false;
}

/**
 * Helper to check if any Result type represents failure
 */
export function isResultFailure(result: unknown): boolean {
  const adapter = getResultAdapter(result);
  if (!adapter) return false;
  return !adapter.isSuccess();
}