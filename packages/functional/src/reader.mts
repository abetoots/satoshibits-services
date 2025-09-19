/**
 * @module reader
 * @description Reader represents a computation with access to a shared environment/context.
 * The Reader monad provides a way to compose functions that all depend on some shared
 * configuration or dependency injection context, without having to pass it explicitly
 * through every function call.
 *
 * @example
 * ```typescript
 * import { Reader } from './reader.mts';
 *
 * // basic usage
 * type Config = { apiUrl: string; timeout: number };
 *
 * const getApiUrl: Reader<Config, string> = config => config.apiUrl;
 * const getTimeout: Reader<Config, number> = config => config.timeout;
 *
 * // composing readers
 * const buildRequest = Reader.chain((url: string) =>
 *   Reader.map((timeout: number) => ({ url, timeout }))(getTimeout)
 * )(getApiUrl);
 *
 * // running readers
 * const config: Config = { apiUrl: 'https://api.example.com', timeout: 5000 };
 * const request = Reader.run(config)(buildRequest);
 * // => { url: 'https://api.example.com', timeout: 5000 }
 * ```
 *
 * @category Core
 * @since 2025-09-18
 */

/**
 * Reader type representing a function from environment to a value.
 * @description A Reader is a function that takes an environment/dependency
 * and returns a value. This allows for dependency injection and configuration
 * passing through a computation pipeline.
 *
 * @template R - The type of the environment/dependencies
 * @template A - The type of the value the reader produces
 *
 * @category Types
 * @example
 * ```typescript
 * // Simple reader
 * type Config = { apiKey: string };
 * const getApiKey: Reader<Config, string> = config => config.apiKey;
 *
 * // Reader with computation
 * type Env = { multiplier: number };
 * const double: Reader<Env, number> = env => 10 * env.multiplier;
 * ```
 *
 * @since 2025-09-18
 */
export type Reader<R, A> = (deps: R) => A;

/**
 * Reader utility functions for working with Reader types.
 * @description Provides a functional API for creating, transforming, and composing Readers.
 * All functions are curried to support functional composition and partial application.
 *
 * @category Utilities
 * @since 2025-09-18
 */
export const Reader = {
  /**
   * Creates a Reader that returns the given value, ignoring the environment.
   * @description Factory function for creating Readers from values. The resulting
   * Reader will always return the provided value regardless of the environment.
   *
   * @template R - The type of the environment
   * @template A - The type of the value
   * @param {A} value - The value to wrap in a Reader
   * @returns {Reader<R, A>} A Reader that returns the value
   *
   * @category Constructors
   * @example
   * ```typescript
   * const reader = Reader.of<Config, number>(42);
   * Reader.run(config)(reader); // => 42
   *
   * // Useful for starting chains
   * const result = Reader.run(config)(
   *   Reader.chain((n: number) => Reader.of<Config, number>(n * 2))(
   *     Reader.of<Config, number>(21)
   *   )
   * ); // => 42
   * ```
   *
   * @since 2025-09-18
   */
  of: <R, A,>(value: A): Reader<R, A> => () => value,

  /**
   * Gets the current environment.
   * @description Returns a Reader that provides access to the entire environment.
   * This is the identity Reader for the environment type.
   *
   * @template R - The type of the environment
   * @returns {Reader<R, R>} A Reader that returns the environment
   *
   * @category Environment
   * @example
   * ```typescript
   * type Config = { port: number; host: string };
   * const config: Config = { port: 3000, host: 'localhost' };
   *
   * const getConfig = Reader.ask<Config>();
   * Reader.run(config)(getConfig); // => { port: 3000, host: 'localhost' }
   * ```
   *
   * @since 2025-09-18
   */
  ask: <R,>(): Reader<R, R> => deps => deps,

  /**
   * Gets a value derived from the environment.
   * @description Projects a value from the environment using a selector function.
   * Useful for extracting specific parts of the environment.
   *
   * @template R - The type of the environment
   * @template A - The type of the extracted value
   * @param {function(R): A} f - Function to extract value from environment
   * @returns {Reader<R, A>} A Reader that returns the extracted value
   *
   * @category Environment
   * @example
   * ```typescript
   * type Config = { db: { host: string; port: number } };
   *
   * const getDbHost = Reader.asks<Config, string>(config => config.db.host);
   * const config: Config = { db: { host: 'localhost', port: 5432 } };
   * Reader.run(config)(getDbHost); // => 'localhost'
   * ```
   *
   * @since 2025-09-18
   */
  asks: <R, A,>(f: (deps: R) => A): Reader<R, A> => f,

  /**
   * Transforms the value inside a Reader using the given function.
   * @description Applies a pure function to the value produced by a Reader,
   * creating a new Reader with the transformed value. This is the functor
   * map operation for Reader types.
   *
   * @template R - The environment type
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): B} f - Function to transform the value
   * @returns {function(Reader<R, A>): Reader<R, B>} A function that transforms Readers
   *
   * @category Transformations
   * @example
   * ```typescript
   * type Config = { multiplier: number };
   * const getValue: Reader<Config, number> = config => 10 * config.multiplier;
   *
   * const double = Reader.map((n: number) => n * 2);
   * const doubled = double(getValue);
   *
   * const config: Config = { multiplier: 3 };
   * Reader.run(config)(doubled); // => 60
   * ```
   *
   * @since 2025-09-18
   */
  map: <R, A, B,>(f: (value: A) => B) => (reader: Reader<R, A>): Reader<R, B> =>
    deps => f(reader(deps)),

  /**
   * Chains Reader-returning operations.
   * @description Sequences two Readers where the second depends on the result
   * of the first. This is the monadic bind operation for Reader types.
   *
   * @template R - The environment type
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): Reader<R, B>} f - Function that returns a new Reader
   * @returns {function(Reader<R, A>): Reader<R, B>} A function that chains Readers
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { baseUrl: string; apiKey: string };
   *
   * const getBaseUrl: Reader<Config, string> = config => config.baseUrl;
   * const buildEndpoint = (base: string): Reader<Config, string> =>
   *   config => `${base}/api?key=${config.apiKey}`;
   *
   * const getEndpoint = Reader.chain(buildEndpoint)(getBaseUrl);
   *
   * const config: Config = { baseUrl: 'https://api.com', apiKey: 'secret' };
   * Reader.run(config)(getEndpoint); // => 'https://api.com/api?key=secret'
   * ```
   *
   * @since 2025-09-18
   */
  chain: <R, A, B,>(f: (value: A) => Reader<R, B>) => (reader: Reader<R, A>): Reader<R, B> =>
    deps => f(reader(deps))(deps),

  /**
   * Alias for chain to match fp-ts naming.
   * @description See {@link chain} for details.
   *
   * @category Combinators
   * @since 2025-09-18
   */
  flatMap: <R, A, B,>(f: (value: A) => Reader<R, B>) => (reader: Reader<R, A>): Reader<R, B> =>
    deps => f(reader(deps))(deps),

  /**
   * Applies a Reader of a function to a Reader of a value.
   * @description Enables applying functions wrapped in Readers to values wrapped
   * in Readers. This is the applicative apply operation for Reader types.
   *
   * @template R - The environment type
   * @template A - The input type
   * @template B - The output type
   * @param {Reader<R, A>} readerValue - Reader containing a value
   * @returns {function(Reader<R, function(A): B>): Reader<R, B>} A function that applies Reader functions
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { x: number; y: number };
   *
   * const add = (a: number) => (b: number) => a + b;
   * const getX: Reader<Config, number> = config => config.x;
   * const getY: Reader<Config, number> = config => config.y;
   *
   * const sum = Reader.ap(getY)(
   *   Reader.map(add)(getX)
   * );
   *
   * const config: Config = { x: 5, y: 3 };
   * Reader.run(config)(sum); // => 8
   * ```
   *
   * @since 2025-09-18
   */
  ap: <R, A, B,>(readerValue: Reader<R, A>) => (readerFn: Reader<R, (a: A) => B>): Reader<R, B> =>
    deps => readerFn(deps)(readerValue(deps)),

  /**
   * Runs a Reader with the given environment.
   * @description Executes a Reader by providing it with the required environment,
   * returning the computed value.
   *
   * @template R - The type of the environment
   * @template A - The type of the value
   * @param {R} deps - The environment to provide
   * @returns {function(Reader<R, A>): A} A function that runs Readers
   *
   * @category Execution
   * @example
   * ```typescript
   * type Config = { name: string };
   * const getName: Reader<Config, string> = config => config.name;
   *
   * const config: Config = { name: 'Alice' };
   * const name = Reader.run(config)(getName); // => 'Alice'
   * ```
   *
   * @since 2025-09-18
   */
  run: <R,>(deps: R) => <A,>(reader: Reader<R, A>): A => reader(deps),

  /**
   * Modifies the environment before running a Reader.
   * @description Transforms the environment using a function before passing it
   * to the Reader. This is contravariant mapping on the environment.
   *
   * @template R - The new environment type
   * @template S - The original environment type
   * @param {function(R): S} f - Function to transform the environment
   * @returns {function(Reader<S, A>): Reader<R, A>} A function that adapts Readers
   *
   * @category Transformations
   * @example
   * ```typescript
   * type AppConfig = { db: DbConfig; api: ApiConfig };
   * type DbConfig = { host: string; port: number };
   *
   * const getDbHost: Reader<DbConfig, string> = config => config.host;
   * const getAppDbHost = Reader.local<AppConfig, DbConfig>(
   *   app => app.db
   * )(getDbHost);
   *
   * const appConfig: AppConfig = {
   *   db: { host: 'localhost', port: 5432 },
   *   api: { url: 'https://api.com' }
   * };
   * Reader.run(appConfig)(getAppDbHost); // => 'localhost'
   * ```
   *
   * @since 2025-09-18
   */
  local: <R, S,>(f: (deps: R) => S) => <A,>(reader: Reader<S, A>): Reader<R, A> =>
    deps => reader(f(deps)),

  /**
   * Converts an array of Readers into a Reader of an array.
   * @description Sequences multiple Readers, collecting their results into an array.
   *
   * @template R - The environment type
   * @template A - The type of values in the Readers
   * @param {Reader<R, A>[]} readers - Array of Readers to sequence
   * @returns {Reader<R, A[]>} A Reader containing an array of results
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { x: number; y: number; z: number };
   *
   * const readers = [
   *   (c: Config) => c.x,
   *   (c: Config) => c.y,
   *   (c: Config) => c.z
   * ];
   * const combined = Reader.sequence(readers);
   *
   * const config: Config = { x: 1, y: 2, z: 3 };
   * Reader.run(config)(combined); // => [1, 2, 3]
   * ```
   *
   * @since 2025-09-18
   */
  sequence: <R, A,>(readers: Reader<R, A>[]): Reader<R, A[]> =>
    deps => readers.map(reader => reader(deps)),

  /**
   * Maps a function returning a Reader over an array and sequences the results.
   * @description Applies a Reader-returning function to each element of an array
   * and collects all results.
   *
   * @template R - The environment type
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): Reader<R, B>} f - Function that returns a Reader
   * @returns {function(A[]): Reader<R, B[]>} A function that traverses arrays with Readers
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { multiplier: number };
   *
   * const multiplyBy = (n: number): Reader<Config, number> =>
   *   config => n * config.multiplier;
   *
   * const multiplyAll = Reader.traverse(multiplyBy);
   * const results = multiplyAll([1, 2, 3]);
   *
   * const config: Config = { multiplier: 10 };
   * Reader.run(config)(results); // => [10, 20, 30]
   * ```
   *
   * @since 2025-09-18
   */
  traverse: <R, A, B,>(f: (a: A) => Reader<R, B>) => (as: A[]): Reader<R, B[]> =>
    Reader.sequence(as.map(f)),

  /**
   * Combines the results of a tuple of Readers into a Reader of a tuple.
   * @description Takes multiple Readers and returns a Reader containing a tuple
   * of their results.
   *
   * @template R - The environment type
   * @template T - Tuple type of Readers
   * @param {...T} readers - Readers to combine
   * @returns {Reader<R, { [K in keyof T]: T[K] extends Reader<R, infer U> ? U : never }>} Reader of tuple
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { name: string; age: number; active: boolean };
   *
   * const getName: Reader<Config, string> = c => c.name;
   * const getAge: Reader<Config, number> = c => c.age;
   * const getActive: Reader<Config, boolean> = c => c.active;
   *
   * const combined = Reader.sequenceT(getName, getAge, getActive);
   *
   * const config: Config = { name: 'Alice', age: 30, active: true };
   * Reader.run(config)(combined); // => ['Alice', 30, true]
   * ```
   *
   * @since 2025-09-18
   */
  sequenceT: <R, T extends readonly unknown[]>(
    ...readers: { [K in keyof T]: Reader<R, T[K]> }
  ): Reader<R, T> =>
    (deps) => readers.map((r) => r(deps)) as unknown as T,

  /**
   * Combines the results of a record of Readers into a Reader of a record.
   * @description Takes an object with Reader values and returns a Reader containing
   * an object with the results.
   *
   * @template R - The environment type
   * @template S - Record type with Reader values
   * @param {S} readers - Record of Readers to combine
   * @returns {Reader<R, { [K in keyof S]: S[K] extends Reader<R, infer U> ? U : never }>} Reader of record
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { user: string; host: string; port: number };
   *
   * const readers = {
   *   username: (c: Config) => c.user,
   *   server: (c: Config) => c.host,
   *   portNumber: (c: Config) => c.port
   * };
   *
   * const combined = Reader.sequenceS(readers);
   *
   * const config: Config = { user: 'admin', host: 'localhost', port: 3000 };
   * Reader.run(config)(combined);
   * // => { username: 'admin', server: 'localhost', portNumber: 3000 }
   * ```
   *
   * @since 2025-09-18
   */
  sequenceS: <R, S>(
    readers: { [K in keyof S]: Reader<R, S[K]> }
  ): Reader<R, S> =>
    (deps) => {
      const result = {} as S;
      for (const key in readers) {
        if (Object.prototype.hasOwnProperty.call(readers, key)) {
          result[key] = readers[key](deps);
        }
      }
      return result;
    },

  /**
   * Executes a Reader for its side effects, discarding the result.
   * @description Runs a Reader-returning function but preserves the original value.
   * Useful for logging or other side effects where the result isn't needed.
   *
   * @template R - The environment type
   * @template A - The type of the value
   * @param {function(A): Reader<R, any>} f - Function that returns a Reader (result discarded)
   * @returns {function(Reader<R, A>): Reader<R, A>} A function that executes side effects
   *
   * @category Combinators
   * @example
   * ```typescript
   * type Config = { logger: (msg: string) => void };
   *
   * const log = (msg: string): Reader<Config, void> =>
   *   config => config.logger(msg);
   *
   * const getValue: Reader<Config, number> = () => 42;
   * const logged = Reader.chainFirst((n: number) => log(`Got: ${n}`))(getValue);
   *
   * const config: Config = { logger: console.log };
   * Reader.run(config)(logged); // logs "Got: 42", returns 42
   * ```
   *
   * @since 2025-09-18
   */
  chainFirst: <R, A,>(f: (a: A) => Reader<R, unknown>) => (reader: Reader<R, A>): Reader<R, A> =>
    deps => {
      const a = reader(deps);
      f(a)(deps);
      return a;
    },
};