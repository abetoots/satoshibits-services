/**
 * @module composition
 * @description Core functional composition utilities using TypeScript 4.0+ variadic tuple types.
 * Provides type-safe function composition with automatic type inference
 * for pipelines of any length. All functions follow functional programming principles,
 * supporting both synchronous and asynchronous composition patterns.
 *
 * ### For Dummies
 * - Treat these helpers as Lego roads for wiring tiny functions together without writing loops.
 * - `pipe` runs a list of functions on a starting value, `flow` builds the list first and reuses it later.
 * - `compose` is just `flow` read from right to left; `tap` lets you peek without changing the value.
 * - Async variants like `pipeAsync` do the same thing but wait for promises at every hop.
 *
 * ### Decision Tree
 * - Already holding the starting value? Use `pipe(value, step1, step2, ...)`.
 * - Need a reusable function to call many times? Use `flow(step1, step2, ...)`.
 * - Prefer mathematical right-to-left order? Reach for `compose(last, ..., first)`.
 * - Want to debug without altering data? Insert `tap(logFn)` inside the pipeline.
 * - Need to await each step? Use `pipeAsync(step1, step2, ...)` and call the returned async function.
 *
 * @example
 * ```typescript
 * import { pipe, flow, compose, tap, pipeAsync } from './composition.mts';
 *
 * // pipe - execute functions with an initial value
 * const result = pipe(
 *   5,
 *   x => x * 2,
 *   x => x + 1,
 *   x => `Result: ${x}`
 * );
 * // => "Result: 11"
 *
 * // flow - create reusable pipelines
 * const processUser = flow(
 *   (user: User) => ({ ...user, name: user.name.trim() }),
 *   user => ({ ...user, name: user.name.toUpperCase() }),
 *   user => ({ ...user, isActive: true })
 * );
 *
 * // compose - right-to-left composition
 * const calculate = compose(
 *   Math.round,
 *   Math.sqrt,
 *   Math.abs
 * );
 *
 * // async composition
 * const fetchAndProcess = pipeAsync(
 *   async (id: string) => fetchUser(id),
 *   async (user: User) => enrichUser(user),
 *   async (enriched: EnrichedUser) => saveUser(enriched)
 * );
 * ```
 *
 * @category Core
 * @since 2025-07-03
 */

/**
 * Pipe - applies a series of functions from left to right.
 * @description Executes a sequence of functions in order, passing the result of each function
 * as the argument to the next. The first argument is the initial value, followed by functions
 * that transform the value step by step. Supports up to 6 transformations with full type inference.
 *
 * @template A - Type of the initial value
 * @template B,C,D,E,F,G - Types of intermediate and final values through the pipeline
 * @param {A} value - The initial value to transform
 * @param {...Function} fns - Functions to apply in sequence
 * @returns {*} The final transformed value
 *
 * @category Core
 * @example
 * // Basic transformation pipeline
 * const result = pipe(
 *   5,
 *   x => x * 2,
 *   x => x + 1,
 *   x => `Result: ${x}`
 * );
 * // => "Result: 11"
 *
 * @example
 * // Complex data transformation
 * const user = { name: 'john', age: 25 };
 * const formatted = pipe(
 *   user,
 *   u => ({ ...u, name: u.name.toUpperCase() }),
 *   u => ({ ...u, ageGroup: u.age >= 18 ? 'adult' : 'minor' }),
 *   u => `${u.name} (${u.ageGroup})`
 * );
 * // => "JOHN (adult)"
 *
 * @example
 * // Working with arrays
 * const doubled = pipe(
 *   [1, 2, 3, 4, 5],
 *   arr => arr.map(x => x * 2),
 *   arr => arr.filter(x => x > 5),
 *   arr => arr.reduce((sum, x) => sum + x, 0)
 * );
 * // => 18 (6 + 8 + 10)
 *
 * @see flow - Create a reusable pipeline function
 * @see compose - Right-to-left composition
 * @since 2025-07-03
 */
export function pipe<A>(value: A): A;

export function pipe<A, B>(value: A, fn1: (a: A) => B): B;

export function pipe<A, B, C>(value: A, fn1: (a: A) => B, fn2: (b: B) => C): C;

export function pipe<A, B, C, D>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
): D;

export function pipe<A, B, C, D, E>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
): E;

export function pipe<A, B, C, D, E, F>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
  fn5: (e: E) => F,
): F;

export function pipe<A, B, C, D, E, F, G>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
  fn5: (e: E) => F,
  fn6: (f: F) => G,
): G;
// General case for more functions (less type safety but still works)
export function pipe(
  value: unknown,
  ...fns: ((arg: unknown) => unknown)[]
): unknown {
  return fns.reduce((acc, fn) => fn(acc), value);
}

/**
 * Flow - compose functions without an initial value.
 * Creates a reusable pipeline function that can be called multiple times
 * with different inputs.
 *
 * @category Core
 * @example
 * // Create a reusable pipeline
 * const processUser = flow(
 *   (user: { name: string; age: number }) => ({ ...user, name: user.name.trim() }),
 *   user => ({ ...user, name: user.name.toUpperCase() }),
 *   user => ({ ...user, isAdult: user.age >= 18 })
 * );
 *
 * processUser({ name: '  john  ', age: 25 });
 * // => { name: 'JOHN', age: 25, isAdult: true }
 *
 * @example
 * // String processing pipeline
 * const slugify = flow(
 *   (str: string) => str.toLowerCase(),
 *   str => str.trim(),
 *   str => str.replace(/\s+/g, '-'),
 *   str => str.replace(/[^a-z0-9-]/g, '')
 * );
 *
 * slugify('Hello World!'); // => 'hello-world'
 * slugify('  TypeScript 4.0  '); // => 'typescript-40'
 *
 * @example
 * // Data validation pipeline
 * const validateAndTransform = flow(
 *   (data: unknown) => data as { name?: string; email?: string },
 *   data => {
 *     if (!data.name) throw new Error('Name is required');
 *     if (!data.email) throw new Error('Email is required');
 *     return data as { name: string; email: string };
 *   },
 *   data => ({
 *     ...data,
 *     name: data.name.trim(),
 *     email: data.email.toLowerCase()
 *   })
 * );
 *
 * @see pipe - Apply functions with an initial value
 * @see compose - Right-to-left composition
 */
export function flow<A, B>(fn1: (a: A) => B): (a: A) => B;
export function flow<A, B, C>(fn1: (a: A) => B, fn2: (b: B) => C): (a: A) => C;
export function flow<A, B, C, D>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
): (a: A) => D;
export function flow<A, B, C, D, E>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
): (a: A) => E;
export function flow<A, B, C, D, E, F>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
  fn5: (e: E) => F,
): (a: A) => F;
// Support multi-argument first function
export function flow<Args extends unknown[], B>(
  fn1: (...args: Args) => B,
): (...args: Args) => B;
export function flow<Args extends unknown[], B, C>(
  fn1: (...args: Args) => B,
  fn2: (b: B) => C,
): (...args: Args) => C;
export function flow<Args extends unknown[], B, C, D>(
  fn1: (...args: Args) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
): (...args: Args) => D;
export function flow(...fns: ((arg: unknown) => unknown)[]) {
  if (fns.length === 0) return identity;
  if (fns.length === 1) return fns[0];

  const [firstFn, ...restFns] = fns;
  return (...args: unknown[]) => {
    const firstResult = (firstFn as (...args: unknown[]) => unknown)(...args);
    return restFns.reduce((acc, fn) => fn(acc), firstResult);
  };
}

/**
 * Identity function - returns its input unchanged.
 * @description A function that returns its argument without any modification.
 * Useful as a default or placeholder in pipelines, for filtering truthy values,
 * or when conditional transformations are needed.
 *
 * @template T - The type of the input and output
 * @param {T} x - The value to return unchanged
 * @returns {T} The same value that was passed in
 *
 * @category Utilities
 * @example
 * // As a default transformation
 * const transform = shouldTransform ? (x: number) => x * 2 : identity;
 * [1, 2, 3].map(transform); // => [1, 2, 3] or [2, 4, 6]
 *
 * @example
 * // Filtering out falsy values while preserving types
 * const values = [1, null, 2, undefined, 3];
 * const nonNull = values.filter(identity); // => [1, 2, 3]
 *
 * @example
 * // As a placeholder in conditional pipelines
 * const pipeline = flow(
 *   validateInput,
 *   shouldNormalize ? normalizeData : identity,
 *   saveToDatabase
 * );
 *
 * @see constant - Create a function that always returns the same value
 * @since 2025-07-03
 */
export const identity = <T,>(x: T): T => x;

/**
 * Constant function - creates a function that always returns the same value.
 * @description Returns a function that ignores its arguments and always returns the specified value.
 * Useful for providing default values, mocking in tests, or replacing complex logic with fixed results.
 *
 * @template T - The type of the constant value
 * @param {T} x - The value to always return
 * @returns {() => T} A function that always returns the constant value
 *
 * @category Utilities
 * @example
 * // Default value provider
 * const getDefault = constant({ status: 'pending', count: 0 });
 * const status = userStatus || getDefault();
 *
 * @example
 * // Mock functions in tests
 * const mockUserService = {
 *   getCurrentUser: constant({ id: 1, name: 'Test User' }),
 *   isAuthenticated: constant(true)
 * };
 *
 * @example
 * // Replacing conditional logic
 * const getDiscount = isPremium
 *   ? calculatePremiumDiscount
 *   : constant(0);
 *
 * @see identity - Return the input unchanged
 * @since 2025-07-03
 */
export const constant =
  <T,>(x: T) =>
  (): T =>
    x;

/**
 * Compose - right-to-left function composition (opposite of flow).
 * For those who prefer mathematical composition order where (f ∘ g)(x) = f(g(x)).
 *
 * @category Core
 * @example
 * // Mathematical style composition
 * const addThenDouble = compose(
 *   (x: number) => x * 2,  // second
 *   (x: number) => x + 1   // first
 * );
 * addThenDouble(5); // => 12 ((5 + 1) * 2)
 *
 * @example
 * // Reading right-to-left
 * const processData = compose(
 *   JSON.stringify,        // 3. Convert to JSON
 *   addTimestamp,         // 2. Add metadata
 *   validateData          // 1. Validate first
 * );
 *
 * @example
 * // Equivalent to nested function calls
 * const traditional = (x: number) => Math.round(Math.sqrt(Math.abs(x)));
 * const composed = compose(Math.round, Math.sqrt, Math.abs);
 * // Both produce the same result
 *
 * @see flow - Left-to-right composition
 * @see pipe - Apply functions with an initial value
 */
export function compose<A, B>(fn1: (a: A) => B): (a: A) => B;
export function compose<A, B, C>(
  fn2: (b: B) => C,
  fn1: (a: A) => B,
): (a: A) => C;
export function compose<A, B, C, D>(
  fn3: (c: C) => D,
  fn2: (b: B) => C,
  fn1: (a: A) => B,
): (a: A) => D;
export function compose<A, B, C, D, E>(
  fn4: (d: D) => E,
  fn3: (c: C) => D,
  fn2: (b: B) => C,
  fn1: (a: A) => B,
): (a: A) => E;
// Support multi-argument last function (first to execute)
export function compose<Args extends unknown[], B>(
  fn1: (...args: Args) => B,
): (...args: Args) => B;
export function compose<Args extends unknown[], B, C>(
  fn2: (b: B) => C,
  fn1: (...args: Args) => B,
): (...args: Args) => C;
export function compose<Args extends unknown[], B, C, D>(
  fn3: (c: C) => D,
  fn2: (b: B) => C,
  fn1: (...args: Args) => B,
): (...args: Args) => D;
export function compose(...fns: ((arg: unknown) => unknown)[]) {
  // Create a reversed copy to avoid mutation
  const reversedFns = [...fns].reverse();
  return flow(...(reversedFns as Parameters<typeof flow>));
}

/**
 * Tap - execute a side effect without changing the value.
 * @description Executes a function for its side effects while passing the input value through unchanged.
 * Useful for debugging, logging, or triggering external actions in pipelines without breaking the flow.
 * The side effect function receives the value but its return value is ignored.
 *
 * @template T - The type of the value being passed through
 * @param {function(T): void} fn - Function to execute for side effects
 * @returns {function(T): T} A function that executes the side effect and returns the input
 *
 * @category Side Effects
 * @example
 * // Debugging pipeline steps
 * const result = pipe(
 *   { name: 'John', age: 30 },
 *   tap(console.log),                    // Log initial value
 *   user => ({ ...user, age: user.age + 1 }),
 *   tap(user => console.log('After increment:', user)),
 *   user => ({ ...user, status: 'active' })
 * );
 *
 * @example
 * // Triggering side effects
 * const saveUser = pipe(
 *   validateUser,
 *   tap(user => analytics.track('user_validated', { id: user.id })),
 *   normalizeUser,
 *   tap(user => cache.set(user.id, user)),
 *   saveToDatabase
 * );
 *
 * @example
 * // Conditional debugging
 * const debug = process.env.DEBUG === 'true';
 * const pipeline = flow(
 *   parseData,
 *   debug ? tap(data => console.log('Parsed:', data)) : identity,
 *   transformData
 * );
 *
 * @see identity - Pass through without side effects
 * @since 2025-07-03
 */
export const tap =
  <T,>(fn: (x: T) => void) =>
  (x: T): T => {
    fn(x);
    return x;
  };

/**
 * Currying utility - converts a function of multiple arguments into a sequence of functions.
 * Each function takes a single argument and returns another function until all arguments are provided.
 *
 * @category Function Transformation
 * @example
 * // Basic currying
 * const add = (a: number, b: number) => a + b;
 * const curriedAdd = curry(add);
 * const add5 = curriedAdd(5);
 * add5(3); // => 8
 *
 * @example
 * // Building reusable functions
 * const multiply = curry((factor: number, value: number) => value * factor);
 * const double = multiply(2);
 * const triple = multiply(3);
 *
 * [1, 2, 3].map(double); // => [2, 4, 6]
 * [1, 2, 3].map(triple); // => [3, 6, 9]
 *
 * @example
 * // Configuration functions
 * const createLogger = curry((level: string, category: string, message: string) =>
 *   console.log(`[${level}] ${category}: ${message}`)
 * );
 *
 * const errorLogger = createLogger('ERROR');
 * const authErrorLogger = errorLogger('AUTH');
 * authErrorLogger('Invalid credentials'); // => "[ERROR] AUTH: Invalid credentials"
 *
 * @see partial - Fix some arguments of a function
 * @see flip - Reverse argument order
 */
export const curry =
  <A, B, C>(fn: (a: A, b: B) => C) =>
  (a: A) =>
  (b: B): C =>
    fn(a, b);

/**
 * Partial application - fixes some arguments of a function.
 * Returns a new function that takes the remaining arguments.
 *
 * @category Function Transformation
 * @example
 * // Partially apply configuration
 * const greet = (greeting: string, name: string) => `${greeting}, ${name}!`;
 * const sayHello = partial(greet, 'Hello');
 * sayHello('World'); // => "Hello, World!"
 *
 * @example
 * // Creating specialized functions
 * const fetchAPI = (method: string, endpoint: string, body?: unknown) =>
 *   fetch(endpoint, { method, body: JSON.stringify(body) });
 *
 * const postAPI = partial(fetchAPI, 'POST');
 * const getAPI = partial(fetchAPI, 'GET');
 *
 * postAPI('/users', { name: 'John' });
 * getAPI('/users');
 *
 * @example
 * // Event handler specialization
 * const logEvent = (category: string, action: string, label: string) =>
 *   analytics.track({ category, action, label });
 *
 * const logUserAction = partial(logEvent, 'USER');
 * const logButtonClick = partial(logUserAction, 'CLICK');
 *
 * logButtonClick('submit-form'); // Logs: { category: 'USER', action: 'CLICK', label: 'submit-form' }
 *
 * @see curry - Convert to single-argument functions
 * @see flip - Reverse argument order
 */
export const partial =
  <A extends unknown[], B, C>(fn: (...args: [...A, B]) => C, ...args: A) =>
  (lastArg: B): C =>
    fn(...args, lastArg);

/**
 * Flip - reverses the order of arguments for a binary function.
 * Useful when you need to adapt a function to work with different argument orders.
 *
 * @category Function Transformation
 * @example
 * // Basic flip
 * const divide = (a: number, b: number) => a / b;
 * const divideBy = flip(divide);
 * divideBy(2, 10); // => 5 (10 / 2)
 *
 * @example
 * // Adapting functions for composition
 * const concat = (a: string, b: string) => a + b;
 * const prepend = flip(concat);
 *
 * const addPrefix = prepend('PREFIX_');
 * addPrefix('value'); // => "valuePREFIX_"
 *
 * @example
 * // Working with collections
 * const has = (obj: Record<string, unknown>, key: string) => key in obj;
 * const hasKey = flip(has);
 *
 * const users = [{ name: 'John' }, { name: 'Jane', admin: true }];
 * users.filter(hasKey('admin')); // => [{ name: 'Jane', admin: true }]
 *
 * @see curry - Convert to single-argument functions
 * @see partial - Fix some arguments
 */
export const flip =
  <A, B, C>(fn: (a: A, b: B) => C) =>
  (b: B, a: A): C =>
    fn(a, b);

/**
 * Memoization - caches function results based on arguments.
 * Improves performance for expensive pure functions by storing previously computed results.
 *
 * @description
 * Creates a memoized version of a function that caches results based on arguments.
 * - Uses WeakMap for object/function arguments, enabling proper garbage collection
 * - Handles circular references safely by using object identity, not structure
 * - Creates a trie-like cache structure for multiple arguments
 *
 * @template Args - The argument types of the function
 * @template Return - The return type of the function
 * @param {Function} fn - The function to memoize
 * @param {Function} [getKey] - Optional function to generate a cache key from arguments
 *
 * @warning **Cache Growth Considerations:**
 * - Without `getKey`: Primitive arguments create unbounded cache growth.
 *   Each unique combination of primitives creates a permanent cache entry.
 * - With `getKey`: If the key function returns objects, they're held with
 *   strong references and won't be garbage collected while cached.
 *
 * For applications requiring cache bounds or eviction policies, consider:
 * - Using `getKey` to control cache keys
 * - Implementing a wrapper with cache management
 * - Using specialized memoization libraries with LRU or TTL support
 *
 * @category Performance
 * @example
 * // Memoize expensive calculations
 * const fibonacci = memoize((n: number): number => {
 *   if (n <= 1) return n;
 *   return fibonacci(n - 1) + fibonacci(n - 2);
 * });
 *
 * fibonacci(40); // First call: slow
 * fibonacci(40); // Second call: instant (cached)
 *
 * @example
 * // Custom cache key generation
 * const processUser = memoize(
 *   async (userId: string, options: { includeDetails: boolean }) => {
 *     const user = await fetchUser(userId);
 *     return options.includeDetails
 *       ? { ...user, details: await fetchUserDetails(userId) }
 *       : user;
 *   },
 *   (userId, options) => `${userId}-${options.includeDetails}` // Returns primitive key
 * );
 *
 * @example
 * // Safe with circular references
 * const obj: any = { value: 1 };
 * obj.self = obj; // Circular reference
 *
 * const process = memoize((item: any) => {
 *   return item.value * 2;
 * });
 *
 * process(obj); // Works correctly, uses object identity for caching
 *
 * @example
 * // Memoizing API calls
 * const fetchProductData = memoize(async (productId: string) => {
 *   const response = await fetch(`/api/products/${productId}`);
 *   return response.json();
 * });
 *
 * // Multiple components can call this without duplicate requests
 * await fetchProductData('123'); // Makes API call
 * await fetchProductData('123'); // Returns cached result
 *
 * @see identity - For functions that don't need memoization
 * @since 2025-07-03
 */
export const memoize = <Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
  getKey?: (...args: Args) => unknown,
): ((...args: Args) => Return) => {
  if (getKey) {
    const keyedCache = new Map<unknown, Return>();
    return (...args: Args): Return => {
      const key = getKey(...args);
      if (keyedCache.has(key)) {
        return keyedCache.get(key)!;
      }
      const result = fn(...args);
      keyedCache.set(key, result);
      return result;
    };
  }

  interface CacheNode {
    primitiveChildren: Map<unknown, CacheNode>;
    objectChildren: WeakMap<object, CacheNode>;
    hasValue: boolean;
    value?: Return;
  }

  const createNode = (): CacheNode => ({
    primitiveChildren: new Map(),
    objectChildren: new WeakMap(),
    hasValue: false,
  });

  const root = createNode();

  return (...args: Args): Return => {
    let node = root;

    for (const arg of args) {
      // Use WeakMap for objects and functions (garbage-collectible)
      if ((typeof arg === "object" && arg !== null) || typeof arg === "function") {
        let nextNode = node.objectChildren.get(arg);
        if (!nextNode) {
          nextNode = createNode();
          node.objectChildren.set(arg, nextNode);
        }
        node = nextNode;
      } else {
        // Use Map for primitives (permanent cache)
        let nextNode = node.primitiveChildren.get(arg);
        if (!nextNode) {
          nextNode = createNode();
          node.primitiveChildren.set(arg, nextNode);
        }
        node = nextNode;
      }
    }

    if (node.hasValue) {
      return node.value as Return;
    }

    const result = fn(...args);
    node.hasValue = true;
    node.value = result;
    return result;
  };
};

/**
 * Compose async functions from right to left.
 * Allows composition of Promise-returning functions in mathematical order.
 * Now supports any number of async functions.
 *
 * @category Async
 * @example
 * // Async data processing pipeline
 * const processData = composeAsync(
 *   async (data: ProcessedData) => saveToDatabase(data),     // 3. Save
 *   async (data: ValidatedData) => transformData(data),      // 2. Transform
 *   async (data: RawData) => validateData(data)              // 1. Validate
 * );
 *
 * const result = await processData(rawData);
 *
 * @example
 * // API call composition with multiple steps
 * const fetchUserWithPosts = composeAsync(
 *   async (enriched: EnrichedUser) => logActivity(enriched),           // 5. Log
 *   async (userData: UserWithMetadata) => enrichWithMetadata(userData),// 4. Enrich
 *   async (userWithPerms: UserWithPerms) => addPreferences(userWithPerms), // 3. Add prefs
 *   async (userWithPosts: UserWithPosts) => addPermissions(userWithPosts), // 2. Add perms
 *   async (user: User) => ({ ...user, posts: await fetchUserPosts(user.id) }), // 1. Add posts
 *   async (userId: string) => fetchUser(userId)                        // 0. Fetch user
 * );
 *
 * const enrichedUser = await fetchUserWithPosts('123');
 *
 * @example
 * // Error handling in async composition
 * const safeProcessData = composeAsync(
 *   async (result: ProcessResult) => logSuccess(result),
 *   async (data: ValidData) => processData(data).catch(err => {
 *     console.error('Processing failed:', err);
 *     throw err;
 *   }),
 *   async (raw: unknown) => validateData(raw)
 * );
 *
 * @see pipeAsync - Left-to-right async composition
 * @see compose - Synchronous right-to-left composition
 * @since 2025-07-03
 */
export function composeAsync<A, B>(
  f1: (a: A) => Promise<B>,
): (a: A) => Promise<B>;
export function composeAsync<A, B, C>(
  f2: (b: B) => Promise<C>,
  f1: (a: A) => Promise<B>,
): (a: A) => Promise<C>;
export function composeAsync<A, B, C, D>(
  f3: (c: C) => Promise<D>,
  f2: (b: B) => Promise<C>,
  f1: (a: A) => Promise<B>,
): (a: A) => Promise<D>;
export function composeAsync<A, B, C, D, E>(
  f4: (d: D) => Promise<E>,
  f3: (c: C) => Promise<D>,
  f2: (b: B) => Promise<C>,
  f1: (a: A) => Promise<B>,
): (a: A) => Promise<E>;
export function composeAsync<A, B, C, D, E, F>(
  f5: (e: E) => Promise<F>,
  f4: (d: D) => Promise<E>,
  f3: (c: C) => Promise<D>,
  f2: (b: B) => Promise<C>,
  f1: (a: A) => Promise<B>,
): (a: A) => Promise<F>;
export function composeAsync(...fns: ((arg: unknown) => Promise<unknown>)[]) {
  if (fns.length === 0) {
    return (x: unknown) => Promise.resolve(x);
  }
  if (fns.length === 1) {
    return fns[0];
  }

  return (initial: unknown) => {
    // Process functions from right to left
    return fns.reduceRight<Promise<unknown>>(
      (acc, fn) => acc.then((result) => fn(result)),
      Promise.resolve(initial),
    );
  };
}

/**
 * Pipe async functions from left to right.
 * Natural reading order for async function composition.
 * Now supports any number of async functions.
 *
 * @category Async
 * @example
 * // Sequential async operations
 * const uploadAndProcess = pipeAsync(
 *   async (file: File) => uploadFile(file),           // 1. Upload
 *   async (url: string) => processImage(url),         // 2. Process
 *   async (processed: ProcessedImage) => notify(processed) // 3. Notify
 * );
 *
 * const result = await uploadAndProcess(imageFile);
 *
 * @example
 * // API data enrichment with multiple steps
 * const enrichUser = pipeAsync(
 *   async (userId: string) => fetchUser(userId),
 *   async (user: User) => ({
 *     ...user,
 *     permissions: await fetchPermissions(user.roleId)
 *   }),
 *   async (user: UserWithPerms) => ({
 *     ...user,
 *     preferences: await fetchPreferences(user.id)
 *   }),
 *   async (user: UserWithPrefs) => ({
 *     ...user,
 *     analytics: await fetchAnalytics(user.id)
 *   }),
 *   async (user: FullUser) => cacheUser(user)
 * );
 *
 * const fullUser = await enrichUser('123');
 *
 * @example
 * // Error handling in async pipelines
 * const processOrder = pipeAsync(
 *   async (orderId: string) => fetchOrder(orderId),
 *   async (order: Order) => validateOrder(order),
 *   async (validOrder: ValidOrder) => processPayment(validOrder),
 *   async (paidOrder: PaidOrder) => shipOrder(paidOrder),
 *   async (shippedOrder: ShippedOrder) => sendConfirmation(shippedOrder)
 * );
 *
 * try {
 *   await processOrder('ORDER-123');
 * } catch (error) {
 *   console.error('Order processing failed:', error);
 * }
 *
 * @see composeAsync - Right-to-left async composition
 * @see pipe - Synchronous left-to-right composition
 * @since 2025-07-03
 */
export function pipeAsync<A, B>(f1: (a: A) => Promise<B>): (a: A) => Promise<B>;
export function pipeAsync<A, B, C>(
  f1: (a: A) => Promise<B>,
  f2: (b: B) => Promise<C>,
): (a: A) => Promise<C>;
export function pipeAsync<A, B, C, D>(
  f1: (a: A) => Promise<B>,
  f2: (b: B) => Promise<C>,
  f3: (c: C) => Promise<D>,
): (a: A) => Promise<D>;
export function pipeAsync<A, B, C, D, E>(
  f1: (a: A) => Promise<B>,
  f2: (b: B) => Promise<C>,
  f3: (c: C) => Promise<D>,
  f4: (d: D) => Promise<E>,
): (a: A) => Promise<E>;
export function pipeAsync<A, B, C, D, E, F>(
  f1: (a: A) => Promise<B>,
  f2: (b: B) => Promise<C>,
  f3: (c: C) => Promise<D>,
  f4: (d: D) => Promise<E>,
  f5: (e: E) => Promise<F>,
): (a: A) => Promise<F>;
export function pipeAsync(...fns: ((arg: unknown) => Promise<unknown>)[]) {
  if (fns.length === 0) {
    return (x: unknown) => Promise.resolve(x);
  }
  if (fns.length === 1) {
    return fns[0];
  }

  return (initial: unknown) => {
    // Process functions from left to right
    return fns.reduce<Promise<unknown>>(
      (acc, fn) => acc.then((result) => fn(result)),
      Promise.resolve(initial),
    );
  };
}

/**
 * Sequential execution of async functions.
 * @description Executes an array of async functions in order, waiting for each to complete before starting the next.
 * Collects and returns all results in an array. Unlike Promise.all, this ensures sequential execution
 * which is useful when operations depend on each other or when you need to limit concurrency.
 *
 * @template T - The type of values returned by the async functions
 * @param {Array<() => Promise<T>>} fns - Array of async functions to execute
 * @returns {Promise<T[]>} Promise resolving to array of all results in order
 *
 * @category Async
 * @example
 * // Execute initialization steps in order
 * const initSteps = [
 *   async () => connectDatabase(),
 *   async () => loadConfiguration(),
 *   async () => startServer()
 * ];
 *
 * const results = await sequenceAsync(initSteps);
 * // All steps completed in order
 *
 * @example
 * // Data fetching sequence
 * const fetchOperations = userIds.map(id =>
 *   async () => fetchUserData(id)
 * );
 *
 * const allUserData = await sequenceAsync(fetchOperations);
 * // Fetches users one by one, not in parallel
 *
 * @example
 * // Cleanup operations
 * const cleanup = sequenceAsync([
 *   async () => closeConnections(),
 *   async () => flushCache(),
 *   async () => logShutdown()
 * ]);
 *
 * process.on('SIGTERM', () => cleanup());
 *
 * @see Promise.all - For parallel execution
 * @see pipeAsync - For composing async functions
 * @since 2025-07-03
 */
export const sequenceAsync = <T,>(fns: (() => Promise<T>)[]): Promise<T[]> =>
  fns.reduce(
    async (promiseChain, currentFn) => {
      const chainResults = await promiseChain;
      const currentResult = await currentFn();
      return [...chainResults, currentResult];
    },
    Promise.resolve([] as T[]),
  );
