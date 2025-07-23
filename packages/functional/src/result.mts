/**
 * @module result
 * @description Type-safe error handling without exceptions using the Result pattern.
 * Result types represent operations that can either succeed with a value or fail
 * with an error. This provides a functional alternative to try-catch blocks,
 * making error handling explicit and composable. Similar to Rust's Result type
 * or fp-ts's Either, but with a simpler API focused on practical use cases.
 * 
 * @example
 * ```typescript
 * import { Result, unwrap, safe } from './result.mts';
 * 
 * // basic usage
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) {
 *     return Result.err('Division by zero');
 *   }
 *   return Result.ok(a / b);
 * }
 * 
 * // composing operations
 * const result = Result.flatMap((x: number) => divide(x, 2))(
 *   Result.map((x: number) => x * 10)(
 *     divide(20, 4)
 *   )
 * );
 * // => { success: true, data: 25 }
 * 
 * // error handling
 * const safeOperation = Result.orElse(
 *   (error: string) => Result.ok(0) // default value on error
 * )(divide(10, 0));
 * // => { success: true, data: 0 }
 * ```
 * 
 * @category Core
 * @since 2025-07-03
 */

/**
 * Result type for handling business errors without exceptions.
 * @description Represents either a successful operation with data or a failure with an error.
 * This discriminated union enables type-safe error handling where errors are
 * values rather than exceptions.
 * 
 * @template T - The type of the success value
 * @template E - The type of the error value (defaults to string)
 * 
 * @category Types
 * @example
 * ```typescript
 * // Success case
 * const success: Result<number> = { success: true, data: 42 };
 * 
 * // Failure case
 * const failure: Result<number> = { success: false, error: 'Not found' };
 * 
 * // Custom error types
 * type ApiError = { code: number; message: string };
 * const apiFailure: Result<User, ApiError> = {
 *   success: false,
 *   error: { code: 404, message: 'User not found' }
 * };
 * ```
 * 
 * @since 2025-07-03
 */
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Result utility functions for working with Result types.
 * @description Provides a functional API for creating, transforming, and composing Results.
 * All functions are curried to support functional composition and partial application.
 * 
 * @category Utilities
 * @since 2025-07-03
 */
export const Result = {
  /**
   * Creates a successful Result containing the given data.
   * @description Factory function for creating success cases. The error type
   * can be inferred from context or explicitly specified.
   * 
   * @template T - The type of the success value
   * @template E - The type of the error (defaults to never for success cases)
   * @param {T} data - The success value to wrap
   * @returns {Result<T, E>} A successful Result containing the data
   * 
   * @category Constructors
   * @example
   * // Basic usage
   * const result = Result.ok(42);
   * // => { success: true, data: 42 }
   * 
   * @example
   * // With explicit types
   * const typed: Result<number, string> = Result.ok(42);
   * 
   * @example
   * // In a function
   * function getUser(id: string): Result<User, string> {
   *   const user = database.find(id);
   *   return user ? Result.ok(user) : Result.err('User not found');
   * }
   * 
   * @since 2025-07-03
   */
  ok: <T, E = never>(data: T): Result<T, E> => ({ success: true, data }),

  /**
   * Creates a failed Result containing the given error.
   * @description Factory function for creating failure cases. The success type
   * can be inferred from context or explicitly specified.
   * 
   * @template T - The type of the success value (defaults to never for error cases)
   * @template E - The type of the error (defaults to string)
   * @param {E} error - The error value to wrap
   * @returns {Result<T, E>} A failed Result containing the error
   * 
   * @category Constructors
   * @example
   * // Basic usage
   * const result = Result.err('Something went wrong');
   * // => { success: false, error: 'Something went wrong' }
   * 
   * @example
   * // With custom error type
   * interface ValidationError {
   *   field: string;
   *   message: string;
   * }
   * 
   * const error: Result<number, ValidationError> = Result.err({
   *   field: 'age',
   *   message: 'Must be positive'
   * });
   * 
   * @since 2025-07-03
   */
  err: <T = never, E = string>(error: E): Result<T, E> => ({
    success: false,
    error,
  }),

  /**
   * Transforms the data inside a successful Result using the given function.
   * @description If the Result is a failure, returns the failure unchanged.
   * This is the functor map operation for Result types.
   * 
   * @template T - The input success type
   * @template U - The output success type
   * @template E - The error type
   * @param {function(T): U} f - Function to transform the success value
   * @returns {function(Result<T, E>): Result<U, E>} A function that transforms Results
   * 
   * @category Transformations
   * @example
   * // Basic transformation
   * const double = Result.map((x: number) => x * 2);
   * double(Result.ok(21)); // => { success: true, data: 42 }
   * double(Result.err('error')); // => { success: false, error: 'error' }
   * 
   * @example
   * // Chaining transformations
   * const result = Result.map((s: string) => s.toUpperCase())(
   *   Result.map((n: number) => n.toString())(
   *     Result.ok(42)
   *   )
   * );
   * // => { success: true, data: '42' }
   * 
   * @since 2025-07-03
   */
  map:
    <T, U, E>(f: (data: T) => U) =>
    (result: Result<T, E>): Result<U, E> =>
      result.success ? Result.ok(f(result.data)) : result as Result<U, E>,

  /**
   * Chains Result-returning operations.
   * @description If the first Result is successful, applies the function to its data.
   * If it's a failure, returns the failure. This is the monadic bind operation
   * for Result types, enabling sequential composition of fallible operations.
   * 
   * @template T - The input success type
   * @template U - The output success type
   * @template E - The error type
   * @param {function(T): Result<U, E>} f - Function that returns a new Result
   * @returns {function(Result<T, E>): Result<U, E>} A function that chains Results
   * 
   * @category Combinators
   * @example
   * // Chaining fallible operations
   * function parseNumber(s: string): Result<number, string> {
   *   const n = Number(s);
   *   return isNaN(n) ? Result.err('Not a number') : Result.ok(n);
   * }
   * 
   * function safeDivide(n: number): Result<number, string> {
   *   return n === 0 ? Result.err('Division by zero') : Result.ok(100 / n);
   * }
   * 
   * const result = Result.flatMap(safeDivide)(
   *   parseNumber('5')
   * );
   * // => { success: true, data: 20 }
   * 
   * @since 2025-07-03
   */
  flatMap:
    <T, U, E>(f: (data: T) => Result<U, E>) =>
    (result: Result<T, E>): Result<U, E> =>
      result.success ? f(result.data) : result as Result<U, E>,

  /**
   * Transforms the error inside a failed Result using the given function.
   * @description If the Result is successful, returns the success unchanged.
   * Useful for normalizing errors or adding context to error messages.
   * 
   * @template T - The success type
   * @template E - The input error type
   * @template F - The output error type
   * @param {function(E): F} f - Function to transform the error
   * @returns {function(Result<T, E>): Result<T, F>} A function that transforms error types
   * 
   * @category Transformations
   * @example
   * // Adding context to errors
   * const withContext = Result.mapError(
   *   (e: string) => `Database error: ${e}`
   * );
   * 
   * @example
   * // Converting error types
   * interface AppError {
   *   code: string;
   *   message: string;
   * }
   * 
   * const toAppError = Result.mapError(
   *   (e: Error): AppError => ({
   *     code: 'INTERNAL_ERROR',
   *     message: e.message
   *   })
   * );
   * 
   * @since 2025-07-03
   */
  mapError:
    <T, E, F>(f: (error: E) => F) =>
    (result: Result<T, E>): Result<T, F> =>
      result.success ? result as Result<T, F> : Result.err(f((result as { success: false; error: E }).error)),

  /**
   * Returns the data from a successful Result, or the provided default value if failed.
   * @description Extracts the value from a Result, providing a fallback for the error case.
   * Useful when you want to handle errors by substituting a default value.
   * 
   * @template T - The success type
   * @template E - The error type
   * @param {T} defaultValue - The value to return if the Result is an error
   * @returns {function(Result<T, E>): T} A function that extracts values with a default
   * 
   * @category Extraction
   * @example
   * // Providing defaults
   * const getWithDefault = Result.getOrElse(0);
   * getWithDefault(Result.ok(42)); // => 42
   * getWithDefault(Result.err('error')); // => 0
   * 
   * @example
   * // Configuration with fallback
   * const port = Result.getOrElse(3000)(
   *   parsePort(process.env.PORT)
   * );
   * 
   * @since 2025-07-03
   */
  getOrElse:
    <T,>(defaultValue: T) =>
    <E,>(result: Result<T, E>): T =>
      result.success ? result.data : defaultValue,

  /**
   * Returns the data from a successful Result, or calls the provided function with the error.
   * @description Pattern matches on the Result, applying one of two functions based on
   * success or failure. Both functions must return the same type. This is similar
   * to the fold operation in functional programming.
   * 
   * @template T - The success type
   * @template U - The return type
   * @template E - The error type
   * @param {function(T): U} onSuccess - Function to apply to success value
   * @param {function(E): U} onFailure - Function to apply to error value
   * @returns {function(Result<T, E>): U} A function that folds Results into a value
   * 
   * @category Extraction
   * @example
   * // Converting to a message
   * const toMessage = Result.fold(
   *   (user: User) => `Welcome, ${user.name}!`,
   *   (error: string) => `Error: ${error}`
   * );
   * 
   * @example
   * // Converting to React component
   * const renderResult = Result.fold(
   *   (data: Data) => <SuccessView data={data} />,
   *   (error: Error) => <ErrorView error={error} />
   * );
   * 
   * @since 2025-07-03
   */
  fold:
    <T, U, E>(onSuccess: (data: T) => U, onFailure: (error: E) => U) =>
    (result: Result<T, E>): U =>
      result.success ? onSuccess(result.data) : onFailure((result as { success: false; error: E }).error),

  /**
   * Combines two Results. If both are successful, applies the function to both data values.
   * @description If either is a failure, returns the first failure encountered.
   * This implements applicative-style composition for Result types.
   * 
   * @template T - The first success type
   * @template U - The second success type
   * @template V - The combined success type
   * @template E - The error type
   * @param {function(T, U): V} f - Function to combine the success values
   * @returns {function(Result<T, E>, Result<U, E>): Result<V, E>} A function that combines Results
   * 
   * @category Combinations
   * @example
   * // Combining two results
   * const add = Result.combine((a: number, b: number) => a + b);
   * add(Result.ok(2), Result.ok(3)); // => { success: true, data: 5 }
   * add(Result.ok(2), Result.err('error')); // => { success: false, error: 'error' }
   * 
   * @example
   * // Building objects from multiple Results
   * const createUser = Result.combine(
   *   (name: string, age: number): User => ({ name, age })
   * );
   * 
   * const user = createUser(
   *   validateName(input.name),
   *   validateAge(input.age)
   * );
   * 
   * @since 2025-07-03
   */
  combine:
    <T, U, V, E>(f: (a: T, b: U) => V) =>
    (resultA: Result<T, E>, resultB: Result<U, E>): Result<V, E> => {
      if (!resultA.success) {
        return Result.err((resultA as { success: false; error: E }).error);
      }
      if (!resultB.success) {
        return Result.err((resultB as { success: false; error: E }).error);
      }
      return Result.ok(f(resultA.data, resultB.data));
    },

  /**
   * Sequences an array of Results.
   * @description If all are successful, returns an array of all data values.
   * If any are failures, returns the first failure encountered. This is
   * useful for validating multiple values where all must succeed.
   * 
   * @template T - The success type of each Result
   * @template E - The error type
   * @param {Result<T, E>[]} results - Array of Results to sequence
   * @returns {Result<T[], E>} A Result containing an array of values or the first error
   * 
   * @category Combinations
   * @example
   * // Validating multiple inputs
   * const results = [
   *   validateEmail('user@example.com'),
   *   validateEmail('admin@example.com'),
   *   validateEmail('test@example.com')
   * ];
   * 
   * const allEmails = Result.sequence(results);
   * // If all valid: { success: true, data: ['user@...', 'admin@...', 'test@...'] }
   * // If any invalid: { success: false, error: 'Invalid email format' }
   * 
   * @see combineWithAllErrors - Collects all errors instead of short-circuiting
   * @since 2025-07-03
   */
  sequence: <T, E>(results: Result<T, E>[]): Result<T[], E> => {
    const data: T[] = [];
    for (const result of results) {
      if (!result.success) {
        return result as Result<T[], E>;
      }
      data.push(result.data);
    }
    return Result.ok(data);
  },

  /**
   * Filters a successful Result based on a predicate.
   * @description If the predicate fails, returns a failure with the provided error.
   * If the Result is already a failure, returns it unchanged. This allows
   * adding validation to existing Results.
   * 
   * @template T - The success type
   * @template E - The error type
   * @param {function(T): boolean} predicate - Function to test the success value
   * @param {E} error - Error to return if the predicate fails
   * @returns {function(Result<T, E>): Result<T, E>} A function that filters Results
   * 
   * @category Validations
   * @example
   * // Adding validation
   * const mustBePositive = Result.filter(
   *   (n: number) => n > 0,
   *   'Number must be positive'
   * );
   * 
   * mustBePositive(Result.ok(42)); // => { success: true, data: 42 }
   * mustBePositive(Result.ok(-1)); // => { success: false, error: 'Number must be positive' }
   * 
   * @example
   * // Chaining validations
   * const validateAge = (age: number) => Result.ok(age)
   *   |> Result.filter(n => n >= 0, 'Age cannot be negative')
   *   |> Result.filter(n => n <= 150, 'Age seems unrealistic');
   * 
   * @since 2025-07-03
   */
  filter:
    <T, E>(predicate: (data: T) => boolean, error: E) =>
    (result: Result<T, E>): Result<T, E> =>
      !result.success ? result : predicate(result.data) ? result : Result.err(error),

  /**
   * Provides a fallback Result if the original fails.
   * @description The fallback function receives the error and returns a new Result.
   * This allows error recovery and chaining of alternative operations.
   * 
   * @template T - The success type
   * @template E - The input error type
   * @template F - The output error type
   * @param {function(E): Result<T, F>} fallbackFn - Function to create a fallback Result
   * @returns {function(Result<T, E>): Result<T, F>} A function that adds fallback logic
   * 
   * @category Error Handling
   * @example
   * // Fallback to cache
   * const getUser = Result.orElse(
   *   (error: string) => getCachedUser()
   * )(fetchUserFromAPI());
   * 
   * @example
   * // Try multiple sources
   * const config = Result.orElse(
   *   () => loadFromFile('./config.json')
   * )(Result.orElse(
   *   () => loadFromEnv()
   * )(loadFromDatabase()));
   * 
   * @since 2025-07-03
   */
  orElse:
    <T, E, F>(fallbackFn: (error: E) => Result<T, F>) =>
    (result: Result<T, E>): Result<T, F> =>
      result.success ? result as Result<T, F> : fallbackFn((result as { success: false; error: E }).error),

  /**
   * Combines an array of Results, collecting ALL errors instead of short-circuiting.
   * @description If all succeed, returns an array of values. If any fail, returns 
   * an array of all errors. This is useful for validation scenarios where you
   * want to report all errors at once rather than stopping at the first one.
   * 
   * @template T - The success type of each Result
   * @template E - The error type of each Result
   * @param {Result<T, E>[]} results - Array of Results to combine
   * @returns {Result<T[], E[]>} Success with all values or failure with all errors
   * 
   * @category Combinations
   * @example
   * // Form validation with all errors
   * const validations = [
   *   validateName(form.name),
   *   validateEmail(form.email),
   *   validateAge(form.age)
   * ];
   * 
   * const result = Result.combineWithAllErrors(validations);
   * // If any fail: { success: false, error: ['Invalid name', 'Invalid email'] }
   * // If all succeed: { success: true, data: ['John', 'john@example.com', 25] }
   * 
   * @see sequence - Short-circuits on first error
   * @since 2025-07-03
   */
  combineWithAllErrors: <T, E>(results: Result<T, E>[]): Result<T[], E[]> => {
    const successes: T[] = [];
    const errors: E[] = [];

    for (const result of results) {
      if (result.success) {
        successes.push(result.data);
      } else {
        errors.push((result as { success: false; error: E }).error);
      }
    }

    return errors.length > 0 ? Result.err(errors) : Result.ok(successes);
  },

  /**
   * Checks if a Result is successful.
   * @description Type guard that narrows a Result to its success case.
   * Useful in conditional statements and array filtering.
   * 
   * @template T - The success type
   * @template E - The error type
   * @param {Result<T, E>} result - The Result to check
   * @returns {result is { success: true; data: T }} True if the Result is successful
   * 
   * @category Type Guards
   * @example
   * // Type narrowing
   * const result = divide(10, 2);
   * if (Result.isOk(result)) {
   *   console.log(result.data); // TypeScript knows data exists
   * }
   * 
   * @example
   * // Filtering arrays
   * const results = [Result.ok(1), Result.err('error'), Result.ok(2)];
   * const successes = results.filter(Result.isOk);
   * // => [{ success: true, data: 1 }, { success: true, data: 2 }]
   * 
   * @see isErr - Check if Result is a failure
   * @since 2025-07-03
   */
  isOk: <T, E>(result: Result<T, E>): result is { success: true; data: T } =>
    result.success,

  /**
   * Checks if a Result is a failure.
   * @description Type guard that narrows a Result to its failure case.
   * Useful in conditional statements and error handling.
   * 
   * @template T - The success type
   * @template E - The error type
   * @param {Result<T, E>} result - The Result to check
   * @returns {result is { success: false; error: E }} True if the Result is a failure
   * 
   * @category Type Guards
   * @example
   * // Error handling
   * const result = parseJSON(input);
   * if (Result.isErr(result)) {
   *   logger.error(result.error); // TypeScript knows error exists
   * }
   * 
   * @example
   * // Collecting errors
   * const results = processItems(items);
   * const errors = results.filter(Result.isErr).map(r => r.error);
   * 
   * @see isOk - Check if Result is successful
   * @since 2025-07-03
   */
  isErr: <T, E>(result: Result<T, E>): result is { success: false; error: E } =>
    !result.success,

  /**
   * Converts a promise that might throw into a Result.
   * @description Catches exceptions and converts them to error Results.
   * This bridges the gap between exception-based and Result-based error handling.
   * 
   * @template T - The type of the resolved value
   * @param {Promise<T>} promise - The promise that might reject
   * @returns {Promise<Result<T, Error>>} A promise of a Result
   * 
   * @category Interop
   * @example
   * // Converting async operations
   * const result = await Result.fromPromise(
   *   fetch('/api/user').then(r => r.json())
   * );
   * 
   * if (Result.isOk(result)) {
   *   console.log('User:', result.data);
   * } else {
   *   console.error('Failed:', result.error.message);
   * }
   * 
   * @example
   * // With async/await
   * async function safeReadFile(path: string): Promise<Result<string, Error>> {
   *   return Result.fromPromise(
   *     fs.promises.readFile(path, 'utf-8')
   *   );
   * }
   * 
   * @since 2025-07-03
   */
  fromPromise: async <T,>(promise: Promise<T>): Promise<Result<T, Error>> => {
    try {
      const data = await promise;
      return Result.ok(data);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  },

  /**
   * Converts a function that might throw into a Result-returning function.
   * @description Wraps a function to catch any thrown exceptions and convert
   * them to Result errors. This allows using exception-based APIs in a
   * Result-based codebase.
   * 
   * @template T - The tuple type of function arguments
   * @template U - The return type of the function
   * @param {function(...T): U} fn - Function that might throw
   * @returns {function(...T): Result<U, Error>} A safe version that returns Results
   * 
   * @category Interop
   * @example
   * // Wrapping JSON.parse
   * const safeParseJSON = Result.fromThrowable(JSON.parse);
   * 
   * const result = safeParseJSON('{"name": "John"}');
   * // => { success: true, data: { name: 'John' } }
   * 
   * const invalid = safeParseJSON('invalid json');
   * // => { success: false, error: Error(...) }
   * 
   * @example
   * // Wrapping custom functions
   * function riskyOperation(x: number): number {
   *   if (x < 0) throw new Error('Cannot process negative numbers');
   *   return Math.sqrt(x);
   * }
   * 
   * const safeSqrt = Result.fromThrowable(riskyOperation);
   * 
   * @since 2025-07-03
   */
  fromThrowable:
    <T extends unknown[], U>(fn: (...args: T) => U) =>
      (...args: T): Result<U, Error> => {
        try {
          const result = fn(...args);
          return Result.ok(result);
        } catch (error) {
          return Result.err(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
};

/**
 * Utility type guard for checking if a value is a Result.
 * @description Runtime type guard that checks if an unknown value conforms to
 * the Result type structure. Useful for validation and type narrowing at
 * runtime boundaries.
 * 
 * @template T - The expected success type
 * @template E - The expected error type
 * @param {any} value - The value to check
 * @returns {value is Result<T, E>} True if the value is a valid Result
 * 
 * @category Type Guards
 * @example
 * // API response validation
 * function handleResponse(data: unknown): void {
 *   if (isResult(data)) {
 *     if (data.success) {
 *       console.log('Success:', data.data);
 *     } else {
 *       console.error('Error:', data.error);
 *     }
 *   } else {
 *     console.error('Invalid response format');
 *   }
 * }
 * 
 * @example
 * // Type narrowing in mixed arrays
 * const mixed = [Result.ok(1), 'not a result', Result.err('error')];
 * const results = mixed.filter(isResult);
 * // TypeScript knows results contains only Result types
 * 
 * @since 2025-07-03
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isResult = <T, E>(value: any): value is Result<T, E> => {
  if (typeof value !== "object" || value === null || !("success" in value)) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (value.success === true) {
    return "data" in value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (value.success === false) {
    return "error" in value;
  }
  return false;
};

/**
 * Helper function to unwrap a Result, throwing if it's an error.
 * @description Use sparingly, only when you're certain the Result should be successful.
 * This function bridges Result-based code with exception-based code, but defeats
 * the purpose of using Results for explicit error handling.
 * 
 * @template T - The success type
 * @template E - The error type
 * @param {Result<T, E>} result - The Result to unwrap
 * @returns {T} The success value
 * @throws {Error} If the Result is a failure
 * 
 * @category Extraction
 * @example
 * // In tests where you expect success
 * test('calculation succeeds', () => {
 *   const result = calculate(10, 2);
 *   expect(unwrap(result)).toBe(5);
 * });
 * 
 * @example
 * // At system boundaries where errors are exceptional
 * const config = unwrap(loadConfig());
 * // If this fails, the app cannot start anyway
 * 
 * @warning Avoid using unwrap in normal application flow.
 * Prefer Result.fold, Result.getOrElse, or pattern matching.
 * 
 * @since 2025-07-03
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.success) {
    return result.data;
  }
  
  const errorMessage = (result as { success: false; error: E }).error instanceof Error
    ? ((result as { success: false; error: E }).error as Error).message
    : String((result as { success: false; error: E }).error);
  
  throw new Error(
    `Attempted to unwrap failed Result: ${errorMessage}`,
  );
};

/**
 * Helper function to safely access nested properties that might not exist.
 * @description Returns a Result instead of throwing or returning undefined.
 * This provides a safe way to access deeply nested properties without
 * optional chaining or null checks.
 * 
 * @template T - The type of the object
 * @template U - The type of the extracted value
 * @param {function(T): U} getter - Function that extracts a value from the object
 * @param {string} errorMessage - Error message if extraction fails
 * @returns {function(T): Result<U, string>} A function that safely extracts values
 * 
 * @category Utilities
 * @example
 * // Safe property access
 * interface User {
 *   profile?: {
 *     address?: {
 *       city?: string;
 *     };
 *   };
 * }
 * 
 * const getCity = safe((user: User) => user.profile!.address!.city!);
 * 
 * const result = getCity({ profile: { address: { city: 'NYC' } } });
 * // => { success: true, data: 'NYC' }
 * 
 * const missing = getCity({});
 * // => { success: false, error: 'Property access failed' }
 * 
 * @example
 * // Custom error messages
 * const getName = safe(
 *   (data: any) => data.user.name as string,
 *   'User name not found'
 * );
 * 
 * @since 2025-07-03
 */
export const safe =
  <T, U>(getter: (obj: T) => U, errorMessage = "Property access failed") =>
  (obj: T): Result<U, string> => {
    try {
      const value = getter(obj);
      if (value === undefined || value === null) {
        return Result.err(errorMessage);
      }
      return Result.ok(value);
    } catch {
      return Result.err(errorMessage);
    }
  };
