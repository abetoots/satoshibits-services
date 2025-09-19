/**
 * @module task
 * @description Task represents a lazy asynchronous computation.
 * A Task is simply a thunk that returns a Promise. This provides a lazy, composable
 * wrapper around async operations, ensuring referential transparency and making
 * async code more predictable and testable. Note that Tasks can reject - for
 * explicit error handling, consider using Task<Result<T, E>> pattern.
 *
 * @example
 * ```typescript
 * import { Task } from './task.mts';
 *
 * // basic usage
 * const readFile = (path: string): Task<string> =>
 *   () => fs.promises.readFile(path, 'utf-8');
 *
 * // composing tasks
 * const processFile = Task.chain((content: string) =>
 *   Task.of(content.toUpperCase())
 * )(readFile('data.txt'));
 *
 * // running tasks
 * const result = await Task.run(processFile);
 * ```
 *
 * @category Core
 * @since 2025-09-18
 */

/**
 * Task type representing a lazy async computation that always succeeds.
 * @description A Task is a function that returns a Promise. This lazy evaluation
 * allows for composition and transformation before execution, making async code
 * more predictable and easier to test.
 *
 * @template A - The type of the value the task will produce
 *
 * @category Types
 * @example
 * ```typescript
 * // Simple task
 * const delay: Task<void> = () => new Promise(resolve =>
 *   setTimeout(resolve, 1000)
 * );
 *
 * // Task returning a value
 * const fetchUser: Task<User> = () =>
 *   fetch('/api/user').then(r => r.json());
 * ```
 *
 * @since 2025-09-18
 */
export type Task<A> = () => Promise<A>;

/**
 * Task utility functions for working with Task types.
 * @description Provides a functional API for creating, transforming, and composing Tasks.
 * All functions are curried to support functional composition and partial application.
 *
 * @category Utilities
 * @since 2025-09-18
 */
export const Task = {
  /**
   * Creates a Task that immediately resolves with the given value.
   * @description Factory function for creating tasks from values. The resulting
   * task will always succeed with the provided value.
   *
   * @template A - The type of the value
   * @param {A} value - The value to wrap in a Task
   * @returns {Task<A>} A Task that resolves to the value
   *
   * @category Constructors
   * @example
   * ```typescript
   * const task = Task.of(42);
   * await Task.run(task); // => 42
   *
   * // Useful for starting chains
   * const result = await Task.run(
   *   Task.chain((n: number) => Task.of(n * 2))(
   *     Task.of(21)
   *   )
   * ); // => 42
   * ```
   *
   * @since 2025-09-18
   */
  of: <A,>(value: A): Task<A> => () => Promise.resolve(value),

  /**
   * Creates a Task from a Promise.
   * @description Wraps a Promise in a Task, making it lazy. The Promise
   * won't execute until the Task is run.
   *
   * @template A - The type of the value the Promise resolves to
   * @param {() => Promise<A>} f - A function that returns a Promise
   * @returns {Task<A>} A Task wrapping the Promise
   *
   * @category Constructors
   * @example
   * ```typescript
   * const fetchData = Task.fromPromise(() =>
   *   fetch('/api/data').then(r => r.json())
   * );
   *
   * // Promise doesn't execute until run
   * const result = await Task.run(fetchData);
   * ```
   *
   * @since 2025-09-18
   */
  fromPromise: <A,>(f: () => Promise<A>): Task<A> => f,

  /**
   * Transforms the value inside a Task using the given function.
   * @description Applies a pure function to the eventual value of a Task,
   * creating a new Task with the transformed value. This is the functor
   * map operation for Task types.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): B} f - Function to transform the value
   * @returns {function(Task<A>): Task<B>} A function that transforms Tasks
   *
   * @category Transformations
   * @example
   * ```typescript
   * const double = Task.map((n: number) => n * 2);
   * const task = Task.of(21);
   * const doubled = double(task);
   * await Task.run(doubled); // => 42
   * ```
   *
   * @since 2025-09-18
   */
  map: <A, B>(f: (value: A) => B) => (task: Task<A>): Task<B> =>
    () => task().then(f),

  /**
   * Chains Task-returning operations.
   * @description Sequences two Tasks where the second depends on the result
   * of the first. This is the monadic bind operation for Task types.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): Task<B>} f - Function that returns a new Task
   * @returns {function(Task<A>): Task<B>} A function that chains Tasks
   *
   * @category Combinators
   * @example
   * ```typescript
   * const readFile = (path: string): Task<string> =>
   *   () => fs.promises.readFile(path, 'utf-8');
   *
   * const parseJson = <T>(content: string): Task<T> =>
   *   Task.of(JSON.parse(content));
   *
   * const loadConfig = Task.chain(parseJson<Config>)(
   *   readFile('config.json')
   * );
   * ```
   *
   * @since 2025-09-18
   */
  chain: <A, B>(f: (value: A) => Task<B>) => (task: Task<A>): Task<B> =>
    () => task().then(a => f(a)()),

  /**
   * Alias for chain to match fp-ts naming.
   * @description See {@link chain} for details.
   *
   * @category Combinators
   * @since 2025-09-18
   */
  flatMap: <A, B>(f: (value: A) => Task<B>) => (task: Task<A>): Task<B> =>
    () => task().then(a => f(a)()),

  /**
   * Applies a Task of a function to a Task of a value.
   * @description Enables applying functions wrapped in Tasks to values wrapped
   * in Tasks. This is the applicative apply operation for Task types.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {Task<A>} taskValue - Task containing a value
   * @returns {function(Task<function(A): B>): Task<B>} A function that applies Task functions
   *
   * @category Combinators
   * @example
   * ```typescript
   * const add = (a: number) => (b: number) => a + b;
   * const taskAdd = Task.of(add);
   * const task5 = Task.of(5);
   * const task3 = Task.of(3);
   *
   * const result = await Task.run(
   *   Task.ap(task3)(
   *     Task.ap(task5)(
   *       Task.map(add)(Task.of(10))
   *     )
   *   )
   * ); // => 18
   * ```
   *
   * @since 2025-09-18
   */
  ap: <A, B>(taskValue: Task<A>) => (taskFn: Task<(a: A) => B>): Task<B> =>
    () => Promise.all([taskFn(), taskValue()]).then(([f, a]) => f(a)),

  /**
   * Runs a Task to completion and returns its Promise.
   * @description Executes a Task, triggering the async computation and
   * returning the resulting Promise.
   *
   * @template A - The type of the value
   * @param {Task<A>} task - The Task to run
   * @returns {Promise<A>} The result of running the Task
   *
   * @category Execution
   * @example
   * ```typescript
   * const task = Task.of(42);
   * const result = await Task.run(task); // => 42
   * ```
   *
   * @since 2025-09-18
   */
  run: <A,>(task: Task<A>): Promise<A> => task(),

  /**
   * Converts an array of Tasks into a Task of an array.
   * @description Runs all Tasks in parallel and collects their results.
   * All Tasks must succeed for the resulting Task to succeed.
   *
   * @template A - The type of values in the Tasks
   * @param {Task<A>[]} tasks - Array of Tasks to sequence
   * @returns {Task<A[]>} A Task containing an array of results
   *
   * @category Combinators
   * @example
   * ```typescript
   * const tasks = [
   *   Task.of(1),
   *   Task.of(2),
   *   Task.of(3)
   * ];
   * const combined = Task.sequence(tasks);
   * await Task.run(combined); // => [1, 2, 3]
   * ```
   *
   * @since 2025-09-18
   */
  sequence: <A,>(tasks: Task<A>[]): Task<A[]> =>
    () => Promise.all(tasks.map(t => t())),

  /**
   * Maps a function returning a Task over an array and sequences the results.
   * @description Applies a Task-returning function to each element of an array
   * and runs all resulting Tasks in parallel.
   *
   * @template A - The input type
   * @template B - The output type
   * @param {function(A): Task<B>} f - Function that returns a Task
   * @returns {function(A[]): Task<B[]>} A function that traverses arrays with Tasks
   *
   * @category Combinators
   * @example
   * ```typescript
   * const fetchUser = (id: string): Task<User> =>
   *   () => fetch(`/api/users/${id}`).then(r => r.json());
   *
   * const fetchAllUsers = Task.traverse(fetchUser);
   * const users = await Task.run(
   *   fetchAllUsers(['1', '2', '3'])
   * );
   * ```
   *
   * @since 2025-09-18
   */
  traverse: <A, B>(f: (a: A) => Task<B>) => (as: A[]): Task<B[]> =>
    Task.sequence(as.map(f)),

  /**
   * Creates a Task that delays for the specified milliseconds.
   * @description Returns a Task that waits for the given duration before
   * resolving with void.
   *
   * @param {number} ms - Number of milliseconds to delay
   * @returns {Task<void>} A Task that delays
   *
   * @category Utilities
   * @example
   * ```typescript
   * const delayed = Task.chain(() => Task.of('done'))(
   *   Task.delay(1000)
   * );
   * await Task.run(delayed); // => 'done' (after 1 second)
   * ```
   *
   * @since 2025-09-18
   */
  delay: (ms: number): Task<void> =>
    () => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Combines the results of a tuple of Tasks into a Task of a tuple.
   * @description Takes multiple Tasks and returns a Task containing a tuple
   * of their results. All Tasks run in parallel.
   *
   * @template T - Tuple type of Tasks
   * @param {...T} tasks - Tasks to combine
   * @returns {Task<{ [K in keyof T]: T[K] extends Task<infer U> ? U : never }>} Task of tuple
   *
   * @category Combinators
   * @example
   * ```typescript
   * const task1 = Task.of(1);
   * const task2 = Task.of('hello');
   * const task3 = Task.of(true);
   *
   * const combined = Task.sequenceT(task1, task2, task3);
   * await Task.run(combined); // => [1, 'hello', true]
   * ```
   *
   * @since 2025-09-18
   */
  sequenceT: <T extends readonly Task<unknown>[]>(
    ...tasks: T
  ): Task<{ [K in keyof T]: T[K] extends Task<infer U> ? U : never }> =>
    () => Promise.all(tasks.map(t => t())) as Promise<{ [K in keyof T]: T[K] extends Task<infer U> ? U : never }>,

  /**
   * Combines the results of a record of Tasks into a Task of a record.
   * @description Takes an object with Task values and returns a Task containing
   * an object with the results. All Tasks run in parallel.
   *
   * @template R - Record type with Task values
   * @param {R} tasks - Record of Tasks to combine
   * @returns {Task<{ [K in keyof R]: R[K] extends Task<infer U> ? U : never }>} Task of record
   *
   * @category Combinators
   * @example
   * ```typescript
   * const tasks = {
   *   user: Task.of({ name: 'Alice' }),
   *   count: Task.of(42),
   *   enabled: Task.of(true)
   * };
   *
   * const combined = Task.sequenceS(tasks);
   * await Task.run(combined);
   * // => { user: { name: 'Alice' }, count: 42, enabled: true }
   * ```
   *
   * @since 2025-09-18
   */
  sequenceS: <R extends Record<string, Task<unknown>>>(
    tasks: R
  ): Task<{ [K in keyof R]: R[K] extends Task<infer U> ? U : never }> =>
    () => {
      const keys = Object.keys(tasks) as (keyof R)[];
      return Promise.all(keys.map(k => tasks[k]!())).then(values =>
        keys.reduce((acc, k, i) => {
          acc[k] = values[i] as R[keyof R] extends Task<infer U> ? U : never;
          return acc;
        }, {} as { [K in keyof R]: R[K] extends Task<infer U> ? U : never })
      );
    },

  /**
   * Executes a Task for its side effects, discarding the result.
   * @description Runs a Task but returns void, useful for Tasks that
   * perform side effects where the result isn't needed.
   *
   * @template A - The type of the value (discarded)
   * @param {function(A): Task<unknown>} f - Function that returns a Task (result discarded)
   * @returns {function(Task<A>): Task<A>} A function that executes side effects
   *
   * @category Combinators
   * @example
   * ```typescript
   * const log = (msg: string): Task<void> =>
   *   () => Promise.resolve(console.log(msg));
   *
   * const task = Task.chainFirst((n: number) => log(`Got: ${n}`))(
   *   Task.of(42)
   * );
   * await Task.run(task); // logs "Got: 42", returns 42
   * ```
   *
   * @since 2025-09-18
   */
  chainFirst: <A,>(f: (a: A) => Task<unknown>) => (task: Task<A>): Task<A> =>
    () => task().then(a => f(a)().then(() => a)),
};