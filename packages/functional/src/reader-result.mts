/**
 * @module reader-result
 * @description Combines Reader (dependency injection) with Result (error handling)
 * for asynchronous computations. This provides a powerful abstraction for
 * building composable, testable applications with explicit error handling
 * and dependency injection. Similar to fp-ts's ReaderTaskEither but tailored
 * for our Result type and async/await patterns.
 * 
 * @example
 * ```typescript
 * import { ReaderResult, liftAsync } from './reader-result.mts';
 * 
 * // define dependencies
 * interface Deps {
 *   db: Database;
 *   logger: Logger;
 *   config: Config;
 * }
 * 
 * // create reusable operations
 * const getUser = (id: string): ReaderResult<Deps, string, User> =>
 *   ReaderResult.tryCatch(
 *     async (deps) => deps.db.users.findById(id),
 *     (error) => `Failed to fetch user: ${error}`
 *   );
 * 
 * // compose operations
 * const program = ReaderResult.Do()
 *   .pipe(ReaderResult.bind('user', () => getUser('123')))
 *   .pipe(ReaderResult.bind('posts', ({ user }) => getUserPosts(user.id)))
 *   .pipe(ReaderResult.map(({ user, posts }) => ({ ...user, posts })));
 * 
 * // run with dependencies
 * const result = await ReaderResult.run(dependencies)(program);
 * ```
 * 
 * @category Core
 * @since 2025-07-03
 */

import type { Result } from './result.mjs';
import { Result as ResultUtils } from './result.mjs';

/**
 * A computation that:
 * - Reads from dependencies (R)
 * - Is asynchronous (Promise)
 * - Can fail with error E or succeed with value A
 * 
 * @template R - The type of dependencies required by the computation
 * @template E - The type of error that can occur
 * @template A - The type of the success value
 * 
 * @category Core Types
 * @since 2025-07-03
 */
export type ReaderResult<R, E, A> = (deps: R) => Promise<Result<A, E>>;

/**
 * Constructors and combinators for ReaderResult
 */
export const ReaderResult = {
  /**
   * Lift a pure value into ReaderResult context.
   * @description Creates a ReaderResult that always succeeds with the given value,
   * ignoring the dependencies.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The type of the value
   * @param {A} value - The value to wrap
   * @returns {ReaderResult<R, E, A>} A ReaderResult that always succeeds with the value
   * 
   * @category Constructors
   * @example
   * const always42 = ReaderResult.of<Deps, string, number>(42);
   * const result = await ReaderResult.run(deps)(always42);
   * // => { success: true, data: 42 }
   * 
   * @since 2025-07-03
   */
  of: <R, E, A>(value: A): ReaderResult<R, E, A> => 
    () => Promise.resolve(ResultUtils.ok(value)),

  /**
   * Lift an error into ReaderResult context.
   * @description Creates a ReaderResult that always fails with the given error,
   * ignoring the dependencies.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The success type
   * @param {E} error - The error to wrap
   * @returns {ReaderResult<R, E, A>} A ReaderResult that always fails with the error
   * 
   * @category Constructors
   * @example
   * const alwaysFails = ReaderResult.fail<Deps, string, User>('User not found');
   * const result = await ReaderResult.run(deps)(alwaysFails);
   * // => { success: false, error: 'User not found' }
   * 
   * @since 2025-07-03
   */
  fail: <R, E, A>(error: E): ReaderResult<R, E, A> =>
    () => Promise.resolve(ResultUtils.err(error)),

  /**
   * Sequential composition - the heart of ReaderResult.
   * @description If first computation fails, short-circuit. Otherwise, feed result to next computation.
   * This is the monadic bind operation that enables chaining ReaderResult computations.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The input value type
   * @template B - The output value type
   * @param {(a: A) => ReaderResult<R, E, B>} f - Function that takes the success value and returns a new ReaderResult
   * @returns {(ma: ReaderResult<R, E, A>) => ReaderResult<R, E, B>} A function that chains ReaderResults
   * 
   * @category Combinators
   * @example
   * const getUser = (id: string): ReaderResult<Deps, string, User> => ...
   * const getUserPosts = (userId: string): ReaderResult<Deps, string, Post[]> => ...
   * 
   * const getUserWithPosts = ReaderResult.chain((user: User) => 
   *   ReaderResult.map((posts: Post[]) => ({ ...user, posts }))(getUserPosts(user.id))
   * )(getUser('123'));
   * 
   * @since 2025-07-03
   */
  chain: <R, E, A, B>(
    f: (a: A) => ReaderResult<R, E, B>
  ) => (
    ma: ReaderResult<R, E, A>
  ): ReaderResult<R, E, B> =>
    async (deps: R) => {
      const resultA = await ma(deps);
      if (!resultA.success) {
        return resultA as Result<B, E>; // Type assertion for proper inference
      }
      return f(resultA.data)(deps);
    },

  /**
   * Map a pure function over the success value.
   * @description Transforms the success value using a pure function. If the computation
   * fails, the error is propagated unchanged.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The input value type
   * @template B - The output value type
   * @param {(a: A) => B} f - Function to transform the success value
   * @returns {(ma: ReaderResult<R, E, A>) => ReaderResult<R, E, B>} A function that maps over ReaderResult
   * 
   * @category Transformations
   * @example
   * const double = ReaderResult.map((n: number) => n * 2);
   * const program = double(ReaderResult.of<Deps, string, number>(21));
   * const result = await ReaderResult.run(deps)(program);
   * // => { success: true, data: 42 }
   * 
   * @since 2025-07-03
   */
  map: <R, E, A, B>(
    f: (a: A) => B
  ) => (
    ma: ReaderResult<R, E, A>
  ): ReaderResult<R, E, B> =>
    ReaderResult.chain<R, E, A, B>((a: A) => ReaderResult.of<R, E, B>(f(a)))(ma),

  /**
   * Map a function over the error value.
   * @description Transforms the error value using a pure function. If the computation
   * succeeds, the success value is propagated unchanged.
   * 
   * @template R - The type of dependencies
   * @template E - The input error type
   * @template F - The output error type
   * @template A - The value type
   * @param {(e: E) => F} f - Function to transform the error
   * @returns {(ma: ReaderResult<R, E, A>) => ReaderResult<R, F, A>} A function that maps over errors
   * 
   * @category Transformations
   * @example
   * const enrichError = ReaderResult.mapError((e: string) => ({ 
   *   message: e, 
   *   timestamp: new Date() 
   * }));
   * 
   * @since 2025-07-03
   */
  mapError: <R, E, F, A>(
    f: (e: E) => F
  ) => (
    ma: ReaderResult<R, E, A>
  ): ReaderResult<R, F, A> =>
    async (deps: R) => {
      const result = await ma(deps);
      return result.success 
        ? result as Result<A, F>
        : ResultUtils.err(f((result as { success: false; error: E }).error));
    },

  /**
   * Access the dependencies.
   * @description Returns a ReaderResult that succeeds with the current dependencies.
   * Useful when you need to access the dependencies within a computation chain.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @returns {ReaderResult<R, E, R>} A ReaderResult that returns the dependencies
   * 
   * @category Dependencies
   * @example
   * const program = ReaderResult.Do()
   *   .pipe(ReaderResult.bind('deps', () => ReaderResult.ask<Deps, string>()))
   *   .pipe(ReaderResult.bind('config', ({ deps }) => 
   *     ReaderResult.of(deps.config)
   *   ));
   * 
   * @since 2025-07-03
   */
  ask: <R, E>(): ReaderResult<R, E, R> =>
    (deps: R) => Promise.resolve(ResultUtils.ok(deps)),

  /**
   * Access a part of the dependencies.
   * @description Returns a ReaderResult that succeeds with a projection of the dependencies.
   * Useful for extracting specific values from the dependency container.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The type of the extracted value
   * @param {(deps: R) => A} f - Function to extract a value from dependencies
   * @returns {ReaderResult<R, E, A>} A ReaderResult that returns the extracted value
   * 
   * @category Dependencies
   * @example
   * const getConfig = ReaderResult.asks<Deps, string, Config>(deps => deps.config);
   * const getLogger = ReaderResult.asks<Deps, string, Logger>(deps => deps.logger);
   * 
   * @since 2025-07-03
   */
  asks: <R, E, A>(
    f: (deps: R) => A
  ): ReaderResult<R, E, A> =>
    (deps: R) => Promise.resolve(ResultUtils.ok(f(deps))),

  /**
   * Lift a Result into ReaderResult
   */
  fromResult: <R, E, A>(
    result: Result<A, E>
  ): ReaderResult<R, E, A> =>
    () => Promise.resolve(result),

  /**
   * Lift an async operation that might throw into ReaderResult
   */
  tryCatch: <R, E, A>(
    f: (deps: R) => Promise<A>,
    onError: (error: unknown) => E
  ): ReaderResult<R, E, A> =>
    async (deps: R) => {
      try {
        const result = await f(deps);
        return ResultUtils.ok(result);
      } catch (error) {
        return ResultUtils.err(onError(error));
      }
    },

  /**
   * Execute ReaderResult with dependencies
   */
  run: <R, E, A>(
    deps: R
  ) => (
    ma: ReaderResult<R, E, A>
  ): Promise<Result<A, E>> =>
    ma(deps),

  /**
   * Combine two ReaderResults in parallel.
   * @description Runs two ReaderResult computations in parallel and combines their results
   * into a tuple. If either fails, returns the first failure.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The first value type
   * @template B - The second value type
   * @param {ReaderResult<R, E, A>} ma - First computation
   * @param {ReaderResult<R, E, B>} mb - Second computation
   * @returns {ReaderResult<R, E, [A, B]>} A ReaderResult containing a tuple of both results
   * 
   * @category Combinations
   * @example
   * const userAndPosts = ReaderResult.zip(
   *   getUser('123'),
   *   getUserPosts('123')
   * );
   * 
   * @since 2025-07-03
   */
  zip: <R, E, A, B>(
    ma: ReaderResult<R, E, A>,
    mb: ReaderResult<R, E, B>
  ): ReaderResult<R, E, [A, B]> =>
    async (deps: R) => {
      const [resultA, resultB] = await Promise.all([
        ma(deps),
        mb(deps)
      ]);
      
      if (!resultA.success) return resultA as Result<[A, B], E>;
      if (!resultB.success) return resultB as Result<[A, B], E>;
      
      return ResultUtils.ok([resultA.data, resultB.data] as [A, B]);
    },

  /**
   * Sequence an array of ReaderResults.
   * @description Transforms an array of ReaderResults into a ReaderResult of an array.
   * Executes each computation sequentially. If any fails, returns the first failure.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The value type
   * @param {readonly ReaderResult<R, E, A>[]} rrs - Array of ReaderResult computations
   * @returns {ReaderResult<R, E, readonly A[]>} A ReaderResult containing an array of all results
   * 
   * @category Combinations
   * @example
   * const userIds = ['123', '456', '789'];
   * const getUsers = ReaderResult.sequence(
   *   userIds.map(id => getUser(id))
   * );
   * 
   * @since 2025-07-03
   */
  sequence: <R, E, A>(
    rrs: readonly ReaderResult<R, E, A>[]
  ): ReaderResult<R, E, readonly A[]> =>
    async (deps: R) => {
      const results: A[] = [];
      
      for (const rr of rrs) {
        const result = await rr(deps);
        if (!result.success) {
          return result as Result<readonly A[], E>;
        }
        results.push(result.data);
      }
      
      return ResultUtils.ok(results as readonly A[]);
    },

  /**
   * Do notation for building up computations.
   * @description Starts a Do notation chain for building complex computations
   * in a more imperative style. Use with bind and let methods.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @returns {ReaderResult<R, E, Record<string, never>>} An empty ReaderResult to start the chain
   * 
   * @category Do Notation
   * @example
   * const program = ReaderResult.Do<Deps, string>()
   *   .pipe(ReaderResult.bind('user', () => getUser('123')))
   *   .pipe(ReaderResult.bind('posts', ({ user }) => getUserPosts(user.id)))
   *   .pipe(ReaderResult.let('postCount', ({ posts }) => posts.length))
   *   .pipe(ReaderResult.map(({ user, posts, postCount }) => ({
   *     ...user,
   *     posts,
   *     stats: { postCount }
   *   })));
   * 
   * @since 2025-07-03
   */
  Do: <R, E>(): ReaderResult<R, E, Record<string, never>> => 
    ReaderResult.of({}),

  /**
   * Bind a computation result to a name (for Do notation)
   */
  bind: <R, E, A extends object, K extends string, B>(
    name: K,
    f: (a: A) => ReaderResult<R, E, B>
  ) => (
    fa: ReaderResult<R, E, A>
  ): ReaderResult<R, E, A & Record<K, B>> =>
    ReaderResult.chain<R, E, A, A & Record<K, B>>((a: A) =>
      ReaderResult.map<R, E, B, A & Record<K, B>>((b: B) => ({ ...a, [name]: b } as A & Record<K, B>))(f(a))
    )(fa),

  /**
   * Bind a value to a name (for Do notation) 
   */
  let: <R, E, A extends object, K extends string, B>(
    name: K,
    f: (a: A) => B
  ) => (
    fa: ReaderResult<R, E, A>
  ): ReaderResult<R, E, A & Record<K, B>> =>
    ReaderResult.map<R, E, A, A & Record<K, B>>((a: A) => ({ ...a, [name]: f(a) } as A & Record<K, B>))(fa),

  /**
   * Provides a fallback ReaderResult if the original fails.
   * @description The fallback function receives the error and returns a new ReaderResult.
   * Useful for error recovery or providing default values.
   * 
   * @template R - The type of dependencies
   * @template E - The input error type
   * @template F - The output error type
   * @template A - The value type
   * @param {(error: E) => ReaderResult<R, F, A>} onError - Function to handle the error
   * @returns {(ma: ReaderResult<R, E, A>) => ReaderResult<R, F, A>} A function that adds fallback behavior
   * 
   * @category Error Handling
   * @example
   * const getUserWithFallback = ReaderResult.orElse(
   *   (error: string) => getDefaultUser()
   * )(getUser('123'));
   * 
   * @since 2025-07-03
   */
  orElse: <R, E, F, A>(
    onError: (error: E) => ReaderResult<R, F, A>
  ) => (
    ma: ReaderResult<R, E, A>
  ): ReaderResult<R, F, A> =>
    async (deps: R) => {
      const result = await ma(deps);
      if (result.success) {
        return result as Result<A, F>;
      }
      return onError((result as { success: false; error: E }).error)(deps);
    },

  /**
   * Timeout for ReaderResult computations.
   * If the computation doesn't complete within the specified time, it fails with the timeout error.
   */
  timeout: <R, E, A>(
    ms: number,
    timeoutError: E
  ) => (
    ma: ReaderResult<R, E, A>
  ): ReaderResult<R, E, A> =>
    async (deps: R) => {
      const timeoutPromise = new Promise<Result<A, E>>((resolve) => {
        setTimeout(() => resolve(ResultUtils.err(timeoutError)), ms);
      });

      return Promise.race([ma(deps), timeoutPromise]);
    },

  /**
   * Retry a ReaderResult computation with exponential backoff.
   * Only retries on failures, not on successful results.
   */
  retry: <R, E, A>(
    maxAttempts: number,
    baseDelay = 1000,
    shouldRetry: (error: E, attempt: number) => boolean = () => true
  ) => (
    ma: ReaderResult<R, E, A>
  ): ReaderResult<R, E, A> =>
    async (deps: R) => {
      // If maxAttempts is not at least 1, just run the operation once.
      if (maxAttempts < 1) {
        return ma(deps);
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await ma(deps);
        
        if (result.success) {
          return result;
        }

        // If it's the last attempt or shouldRetry returns false, return the error.
        if (attempt === maxAttempts || !shouldRetry((result as { success: false; error: E }).error, attempt)) {
          return result;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // This part is now unreachable due to the logic above, but satisfies TS.
      // A more robust way to signal this is to throw, as it should never happen.
      throw new Error('Retry logic reached an impossible state.');
    },

  /**
   * Execute multiple ReaderResults in parallel and collect all results.
   * @description Similar to sequence but runs in parallel rather than sequentially.
   * More efficient for independent computations but still fails fast on first error.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template A - The value type
   * @param {readonly ReaderResult<R, E, A>[]} rrs - Array of ReaderResult computations
   * @returns {ReaderResult<R, E, readonly A[]>} A ReaderResult containing an array of all results
   * 
   * @category Combinations
   * @example
   * // Fetch multiple users in parallel
   * const userIds = ['123', '456', '789'];
   * const getUsers = ReaderResult.sequencePar(
   *   userIds.map(id => getUser(id))
   * );
   * 
   * @since 2025-07-03
   */
  sequencePar: <R, E, A>(
    rrs: readonly ReaderResult<R, E, A>[]
  ): ReaderResult<R, E, readonly A[]> =>
    async (deps: R) => {
      const results = await Promise.all(rrs.map(rr => rr(deps)));
      const data: A[] = [];
      
      for (const result of results) {
        if (!result.success) {
          return result as Result<readonly A[], E>;
        }
        data.push(result.data);
      }
      
      return ResultUtils.ok(data as readonly A[]);
    },

  /**
   * Combine multiple ReaderResults in parallel into a tuple.
   * Extends zip to work with any number of ReaderResults.
   */
  zipAll: <R, E, T extends readonly ReaderResult<R, E, unknown>[]>(
    ...rrs: T
  ): ReaderResult<R, E, { [K in keyof T]: T[K] extends ReaderResult<R, E, infer A> ? A : never }> =>
    async (deps: R) => {
      const results = await Promise.all(rrs.map(rr => rr(deps)));
      const data: unknown[] = [];
      
      for (const result of results) {
        if (!result.success) {
          return result as Result<never, E>;
        }
        data.push(result.data);
      }
      
      return ResultUtils.ok(data as { [K in keyof T]: T[K] extends ReaderResult<R, E, infer A> ? A : never });
    },

  /**
   * Run multiple ReaderResults in parallel and collect all results or all errors.
   * @description Unlike sequencePar, this doesn't short-circuit on the first error.
   * Collects all errors if any computations fail, making it useful for validation scenarios.
   * 
   * @template R - The type of dependencies
   * @template E - The error type
   * @template T - The record type mapping keys to ReaderResults
   * 
   * @category Combinations
   * @example
   * const validation = ReaderResult.parallel({
   *   name: validateName(input.name),
   *   email: validateEmail(input.email),
   *   age: validateAge(input.age)
   * });
   * // If any fail, returns all failures
   * 
   * @since 2025-07-03
   */
  parallel: <R, E, T extends Record<string, ReaderResult<R, E, unknown>>>(
    rrs: T
  ): ReaderResult<R, { key: keyof T; error: E }[], { [K in keyof T]: T[K] extends ReaderResult<R, E, infer A> ? A : never }> =>
    async (deps: R) => {
      const entries = Object.entries(rrs);
      const results = await Promise.all(
        entries.map(async ([key, rr]) => [key, await rr(deps)] as const)
      );
      
      const errors: { key: keyof T; error: E }[] = [];
      const data: Record<string, unknown> = {};
      
      for (const [key, result] of results) {
        if (result.success) {
          data[key] = result.data;
        } else {
          errors.push({ key: key as keyof T, error: (result as { success: false; error: E }).error });
        }
      }
      
      return errors.length > 0 
        ? ResultUtils.err(errors)
        : ResultUtils.ok(data as { [K in keyof T]: T[K] extends ReaderResult<R, E, infer A> ? A : never });
    },
};

/**
 * Helper to create ReaderResult from a domain function that returns Result.
 * @description Lifts a pure function that returns a Result into the ReaderResult context.
 * Useful for integrating existing Result-based functions.
 * 
 * @template R - The type of dependencies
 * @template E - The error type
 * @template A - The value type
 * @template Args - The argument types
 * @param {(...args: Args) => Result<A, E>} f - Function that returns a Result
 * @returns {(...args: Args) => ReaderResult<R, E, A>} A function that returns a ReaderResult
 * 
 * @category Helpers
 * @example
 * const validateAge = (age: number): Result<number, string> =>
 *   age >= 18 ? Result.ok(age) : Result.err('Must be 18 or older');
 * 
 * const validateAgeRR = liftDomain<Deps, string, number, [number]>(validateAge);
 * 
 * @since 2025-07-03
 */
export const liftDomain = <R, E, A, Args extends unknown[]>(
  f: (...args: Args) => Result<A, E>
) => (
  ...args: Args
): ReaderResult<R, E, A> =>
  ReaderResult.fromResult(f(...args));

/**
 * Helper to create ReaderResult from an async function that might throw.
 * @description Lifts an async function that might throw into the ReaderResult context,
 * converting exceptions to typed errors.
 * 
 * @template R - The type of dependencies
 * @template E - The error type
 * @template A - The value type
 * @template Args - The argument types
 * @param {(deps: R, ...args: Args) => Promise<A>} f - Async function that might throw
 * @param {(error: unknown) => E} onError - Function to convert exceptions to errors
 * @returns {(...args: Args) => ReaderResult<R, E, A>} A function that returns a ReaderResult
 * 
 * @category Helpers
 * @example
 * const fetchUser = liftAsync<Deps, string, User, [string]>(
 *   async (deps, id) => deps.api.getUser(id),
 *   (error) => `Failed to fetch user: ${error}`
 * );
 * 
 * @since 2025-07-03
 */
export const liftAsync = <R, E, A, Args extends unknown[]>(
  f: (deps: R, ...args: Args) => Promise<A>,
  onError: (error: unknown) => E
) => (
  ...args: Args
): ReaderResult<R, E, A> =>
  ReaderResult.tryCatch(
    (deps: R) => f(deps, ...args),
    onError
  );