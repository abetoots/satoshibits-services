/**
 * @module io
 * @description IO represents a synchronous computation that may have side effects.
 * An IO is a thunk (a function with no arguments) that performs a computation when called.
 * This provides a way to make side effects referentially transparent by wrapping them
 * in a function, delaying their execution until explicitly requested.
 *
 * @example
 * ```typescript
 * import { IO } from './io.mts';
 *
 * // basic usage
 * const getCurrentTime: IO<number> = () => Date.now();
 * const randomNumber: IO<number> = () => Math.random();
 *
 * // composing IO operations
 * const program = IO.chain((time: number) =>
 *   IO.map((rand: number) => `Time: ${time}, Random: ${rand}`)(
 *     randomNumber
 *   )
 * )(getCurrentTime);
 *
 * // running IO
 * const result = IO.run(program);
 * ```
 *
 * @category Core
 * @since 2025-09-18
 */

/**
 * IO type representing a synchronous computation that may have side effects.
 * @description An IO is a function that takes no arguments and returns a value.
 * The computation is lazy - it doesn't execute until explicitly run.
 *
 * @template A - The type of the value the IO will produce
 *
 * @category Types
 * @example
 * ```typescript
 * // Simple IO
 * const log: IO<void> = () => console.log('Hello');
 *
 * // IO returning a value
 * const random: IO<number> = () => Math.random();
 *
 * // IO reading from environment
 * const getEnv: IO<string | undefined> = () => process.env.HOME;
 * ```
 *
 * @since 2025-09-18
 */
export type IO<A> = () => A;

/**
 * IO utility functions for working with IO types.
 * @description Provides a functional API for creating, transforming, and composing IOs.
 * All functions are curried to support functional composition and partial application.
 *
 * @category Utilities
 * @since 2025-09-18
 */
export const IO = {
  /**
   * Creates an IO that returns the given value.
   * @description Factory function for creating IOs from values. The resulting
   * IO will always return the provided value when run.
   *
   * @template A - The type of the value
   * @param {A} value - The value to wrap in an IO
   * @returns {IO<A>} An IO that returns the value
   *
   * @category Constructors
   * @example
   * ```typescript
   * const io = IO.of(42);
   * IO.run(io); // => 42
   *
   * // Useful for starting chains
   * const result = IO.run(
   *   IO.chain((n: number) => IO.of(n * 2))(
   *     IO.of(21)
   *   )
   * ); // => 42
   * ```
   *
   * @since 2025-09-18
   */
  of:
    <A,>(value: A): IO<A> =>
    () =>
      value,

  /**
   * Transforms the value inside an IO using the given function.
   * @description Applies a pure function to the value produced by an IO,
   * creating a new IO with the transformed value. This is the functor
   * map operation for IO types.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): B} f - Function to transform the value
   * @returns {function(IO<A>): IO<B>} A function that transforms IOs
   *
   * @category Transformations
   * @example
   * ```typescript
   * const double = IO.map((n: number) => n * 2);
   * const io = IO.of(21);
   * const doubled = double(io);
   * IO.run(doubled); // => 42
   *
   * // With side effects
   * const random = () => Math.random();
   * const percent = IO.map((n: number) => Math.round(n * 100))(random);
   * IO.run(percent); // => random number 0-100
   * ```
   *
   * @since 2025-09-18
   */
  map:
    <A, B>(f: (value: A) => B) =>
    (io: IO<A>): IO<B> =>
    () =>
      f(io()),

  /**
   * Chains IO-returning operations.
   * @description Sequences two IOs where the second depends on the result
   * of the first. This is the monadic bind operation for IO types.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): IO<B>} f - Function that returns a new IO
   * @returns {function(IO<A>): IO<B>} A function that chains IOs
   *
   * @category Combinators
   * @example
   * ```typescript
   * const readLine: IO<string> = () => prompt('Enter text:') || '';
   * const toUpper = (s: string): IO<string> => IO.of(s.toUpperCase());
   *
   * const program = IO.chain(toUpper)(readLine);
   * IO.run(program); // prompts user, returns uppercase input
   * ```
   *
   * @since 2025-09-18
   */
  chain:
    <A, B>(f: (value: A) => IO<B>) =>
    (io: IO<A>): IO<B> =>
    () =>
      f(io())(),

  /**
   * Alias for chain to match fp-ts naming.
   * @description See {@link chain} for details.
   *
   * @category Combinators
   * @since 2025-09-18
   */
  flatMap:
    <A, B>(f: (value: A) => IO<B>) =>
    (io: IO<A>): IO<B> =>
    () =>
      f(io())(),

  /**
   * Applies an IO of a function to an IO of a value.
   * @description Enables applying functions wrapped in IOs to values wrapped
   * in IOs. This is the applicative apply operation for IO types.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {IO<A>} ioValue - IO containing a value
   * @returns {function(IO<function(A): B>): IO<B>} A function that applies IO functions
   *
   * @category Combinators
   * @example
   * ```typescript
   * const add = (a: number) => (b: number) => a + b;
   * const ioAdd = IO.of(add);
   * const io5 = IO.of(5);
   * const io3 = IO.of(3);
   *
   * const result = IO.run(
   *   IO.ap(io3)(
   *     IO.ap(io5)(
   *       IO.map(add)(IO.of(10))
   *     )
   *   )
   * ); // => 18
   * ```
   *
   * @since 2025-09-18
   */
  ap:
    <A, B>(ioValue: IO<A>) =>
    (ioFn: IO<(a: A) => B>): IO<B> =>
    () =>
      ioFn()(ioValue()),

  /**
   * Runs an IO to completion and returns its value.
   * @description Executes an IO, triggering the computation and returning
   * the result. This is where side effects actually occur.
   *
   * @template A - The type of the value
   * @param {IO<A>} io - The IO to run
   * @returns {A} The result of running the IO
   *
   * @category Execution
   * @example
   * ```typescript
   * const io = IO.of(42);
   * const result = IO.run(io); // => 42
   *
   * const sideEffect = () => {
   *   console.log('Side effect!');
   *   return 'done';
   * };
   * IO.run(sideEffect); // logs "Side effect!", returns 'done'
   * ```
   *
   * @since 2025-09-18
   */
  run: <A,>(io: IO<A>): A => io(),

  /**
   * Converts an array of IOs into an IO of an array.
   * @description Sequences multiple IOs, running them in order and collecting
   * their results.
   *
   * @template A - The type of values in the IOs
   * @param {IO<A>[]} ios - Array of IOs to sequence
   * @returns {IO<A[]>} An IO containing an array of results
   *
   * @category Combinators
   * @example
   * ```typescript
   * const ios = [
   *   IO.of(1),
   *   IO.of(2),
   *   IO.of(3)
   * ];
   * const combined = IO.sequence(ios);
   * IO.run(combined); // => [1, 2, 3]
   * ```
   *
   * @since 2025-09-18
   */
  sequence:
    <A,>(ios: IO<A>[]): IO<A[]> =>
    () =>
      ios.map((io) => io()),

  /**
   * Maps a function returning an IO over an array and sequences the results.
   * @description Applies an IO-returning function to each element of an array
   * and runs all resulting IOs in sequence.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): IO<B>} f - Function that returns an IO
   * @returns {function(A[]): IO<B[]>} A function that traverses arrays with IOs
   *
   * @category Combinators
   * @example
   * ```typescript
   * const log = (msg: string): IO<string> => () => {
   *   console.log(msg);
   *   return msg;
   * };
   *
   * const logAll = IO.traverse(log);
   * const messages = IO.run(
   *   logAll(['Hello', 'World'])
   * ); // logs each message, returns ['Hello', 'World']
   * ```
   *
   * @since 2025-09-18
   */
  traverse:
    <A, B>(f: (a: A) => IO<B>) =>
    (as: A[]): IO<B[]> =>
      IO.sequence(as.map(f)),

  /**
   * Combines the results of a tuple of IOs into an IO of a tuple.
   * @description Takes multiple IOs and returns an IO containing a tuple
   * of their results.
   *
   * @template T - Tuple type of IOs
   * @param {...T} ios - IOs to combine
   * @returns {IO<{ [K in keyof T]: T[K] extends IO<infer U> ? U : never }>} IO of tuple
   *
   * @category Combinators
   * @example
   * ```typescript
   * const io1 = IO.of(1);
   * const io2 = IO.of('hello');
   * const io3 = IO.of(true);
   *
   * const combined = IO.sequenceT(io1, io2, io3);
   * IO.run(combined); // => [1, 'hello', true]
   * ```
   *
   * @since 2025-09-18
   */
  sequenceT:
    <T extends readonly IO<unknown>[]>(
      ...ios: T
    ): IO<{ [K in keyof T]: T[K] extends IO<infer U> ? U : never }> =>
    () =>
      ios.map((io) => io()) as {
        [K in keyof T]: T[K] extends IO<infer U> ? U : never;
      },

  /**
   * Combines the results of a record of IOs into an IO of a record.
   * @description Takes an object with IO values and returns an IO containing
   * an object with the results.
   *
   * @template R - Record type with IO values
   * @param {R} ios - Record of IOs to combine
   * @returns {IO<{ [K in keyof R]: R[K] extends IO<infer U> ? U : never }>} IO of record
   *
   * @category Combinators
   * @example
   * ```typescript
   * const ios = {
   *   user: IO.of({ name: 'Alice' }),
   *   count: IO.of(42),
   *   enabled: IO.of(true)
   * };
   *
   * const combined = IO.sequenceS(ios);
   * IO.run(combined);
   * // => { user: { name: 'Alice' }, count: 42, enabled: true }
   * ```
   *
   * @since 2025-09-18
   */
  sequenceS:
    <R extends Record<string, IO<unknown>>>(
      ios: R,
    ): IO<{ [K in keyof R]: R[K] extends IO<infer U> ? U : never }> =>
    () => {
      const entries = Object.entries(ios) as [keyof R, R[keyof R]][];
      const result = entries.reduce(
        (acc, [key, io]) => ({
          ...acc,
          [key]: io(),
        }),
        {} as { [K in keyof R]: R[K] extends IO<infer U> ? U : never },
      );
      return result;
    },

  /**
   * Executes an IO for its side effects, discarding the result.
   * @description Runs an IO but returns the original value, useful for IOs
   * that perform side effects where the result isn't needed.
   *
   * @template A - The type of the value
   * @param {function(A): IO<unknown>} f - Function that returns an IO (result discarded)
   * @returns {function(IO<A>): IO<A>} A function that executes side effects
   *
   * @category Combinators
   * @example
   * ```typescript
   * const log = (msg: string): IO<void> => () => console.log(msg);
   *
   * const io = IO.chainFirst((n: number) => log(`Got: ${n}`))(
   *   IO.of(42)
   * );
   * IO.run(io); // logs "Got: 42", returns 42
   * ```
   *
   * @since 2025-09-18
   */
  chainFirst:
    <A,>(f: (a: A) => IO<unknown>) =>
    (io: IO<A>): IO<A> =>
    () => {
      const a = io();
      f(a)();
      return a;
    },
};
