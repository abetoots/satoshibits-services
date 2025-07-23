/**
 * @module pipeline
 * @description A fluent, chainable API for function composition that maintains state.
 * Unlike pure functional composition, Pipeline provides an object-oriented
 * interface for building complex data transformations with method chaining.
 * Combines the benefits of functional programming with familiar OOP patterns.
 * 
 * @example
 * ```typescript
 * import { Pipeline } from './pipeline.mts';
 * 
 * // basic transformations
 * const result = Pipeline.of(5)
 *   .map(x => x * 2)
 *   .map(x => x + 1)
 *   .value();
 * // => 11
 * 
 * // async transformations
 * const userData = await Pipeline.of('user123')
 *   .mapAsync(id => fetchUser(id))
 *   .then(p => p.map(user => user.email))
 *   .then(p => p.value());
 * 
 * // error handling
 * const validated = Pipeline.of(input)
 *   .filter(x => x > 0, 'Must be positive')
 *   .map(result => result.success ? result.data * 2 : result)
 *   .value();
 * ```
 * 
 * @category Core
 * @since 2025-07-03
 */

/**
 * Pipeline builder for fluent function composition.
 * Provides a stateful, chainable interface for applying transformations
 * to a value. Unlike pure functional composition, Pipeline maintains
 * internal state and offers a familiar object-oriented API.
 * 
 * @category Core
 * @example
 * // Basic transformation pipeline
 * const result = Pipeline.of(5)
 *   .map(x => x * 2)
 *   .map(x => x + 1)
 *   .map(x => `Result: ${x}`)
 *   .value();
 * // => "Result: 11"
 * 
 * @example
 * // Complex data transformation
 * const userPipeline = Pipeline.of({ name: 'john doe', age: 30 })
 *   .map(user => ({ ...user, name: user.name.toUpperCase() }))
 *   .tap(user => console.log('Processing:', user.name))
 *   .map(user => ({ ...user, ageGroup: user.age >= 18 ? 'adult' : 'minor' }))
 *   .value();
 * // => { name: 'JOHN DOE', age: 30, ageGroup: 'adult' }
 * 
 * @example
 * // Error handling with filter
 * const processNumber = (n: number) => Pipeline.of(n)
 *   .filter(x => x > 0, 'Number must be positive')
 *   .map(result => {
 *     if (!result.success) return result;
 *     return { success: true as const, data: Math.sqrt(result.data) };
 *   })
 *   .value();
 * 
 * processNumber(16);  // => { success: true, data: 4 }
 * processNumber(-4);  // => { success: false, error: 'Number must be positive' }
 */
export class Pipeline<T> {
  /**
   * Creates a new Pipeline instance with the given value.
   * Use Pipeline.of() for a more functional approach.
   * 
   * @private
   */
  constructor(private readonly _value: T) {}

  /**
   * Apply a synchronous transformation.
   * @description Transforms the current value using the provided function.
   * Returns a new Pipeline containing the transformed value.
   * 
   * @template U - The type of the transformed value
   * @param {function(T): U} fn - Function to transform the value
   * @returns {Pipeline<U>} A new Pipeline with the transformed value
   * 
   * @category Transformation
   * @example
   * const doubled = Pipeline.of(5)
   *   .map(x => x * 2)
   *   .value();
   * // => 10
   * 
   * @example
   * // Chaining transformations
   * const result = Pipeline.of('hello')
   *   .map(s => s.toUpperCase())
   *   .map(s => s.split(''))
   *   .map(arr => arr.reverse())
   *   .map(arr => arr.join(''))
   *   .value();
   * // => 'OLLEH'
   * 
   * @see mapAsync - Transform with async function
   * @see flatMap - Transform and flatten
   * @since 2025-07-03
   */
  map<U>(fn: (value: T) => U): Pipeline<U> {
    return new Pipeline(fn(this._value));
  }

  /**
   * Apply an asynchronous transformation.
   * @description Transforms the current value using an async function.
   * Returns a Promise that resolves to a new Pipeline with the transformed value.
   * 
   * @template U - The type of the transformed value
   * @param {function(T): Promise<U>} fn - Async function to transform the value
   * @returns {Promise<Pipeline<U>>} Promise resolving to a new Pipeline
   * 
   * @category Async
   * @example
   * const userData = await Pipeline.of(123)
   *   .mapAsync(async (id) => {
   *     const response = await fetch(`/api/users/${id}`);
   *     return response.json();
   *   })
   *   .then(p => p.value());
   * 
   * @example
   * // Chaining async operations
   * const result = await Pipeline.of('user@example.com')
   *   .mapAsync(email => fetchUserByEmail(email))
   *   .then(p => p.mapAsync(user => fetchUserPosts(user.id)))
   *   .then(p => p.map(posts => posts.length))
   *   .then(p => p.value());
   * // => number of posts
   */
  async mapAsync<U>(fn: (value: T) => Promise<U>): Promise<Pipeline<U>> {
    const result = await fn(this._value);
    return new Pipeline(result);
  }

  /**
   * Apply a transformation that might fail.
   * Handles functions that return Result types.
   * 
   * @category Error Handling
   * @example
   * const safeDivide = (n: number, divisor: number) => 
   *   divisor === 0 
   *     ? { success: false as const, error: 'Division by zero' }
   *     : { success: true as const, data: n / divisor };
   * 
   * const result = Pipeline.of(10)
   *   .flatMap(n => safeDivide(n, 2))
   *   .value();
   * // => { success: true, data: 5 }
   * 
   * @example
   * // Chaining fallible operations
   * const process = Pipeline.of('{"name": "John"}')
   *   .flatMap(str => {
   *     try {
   *       return { success: true as const, data: JSON.parse(str) };
   *     } catch {
   *       return { success: false as const, error: 'Invalid JSON' };
   *     }
   *   })
   *   .map(result => {
   *     if (!result.success) return result;
   *     return { success: true as const, data: result.data.name };
   *   })
   *   .value();
   * // => { success: true, data: 'John' }
   */
  flatMap<U, E>(
    fn: (value: T) => { success: true; data: U } | { success: false; error: E }
  ): Pipeline<{ success: true; data: U } | { success: false; error: E }> {
    return new Pipeline(fn(this._value));
  }

  /**
   * Filter the pipeline based on a predicate.
   * Converts the value to a Result type based on the predicate.
   * 
   * @category Filtering
   * @example
   * const result = Pipeline.of(5)
   *   .filter(x => x > 0, 'Must be positive')
   *   .value();
   * // => { success: true, data: 5 }
   * 
   * @example
   * // Validation pipeline
   * const validateUser = (user: any) => Pipeline.of(user)
   *   .filter(u => u.name, 'Name is required')
   *   .map(result => {
   *     if (!result.success) return result;
   *     return Pipeline.of(result.data)
   *       .filter(u => u.age >= 18, 'Must be 18 or older')
   *       .value();
   *   })
   *   .value();
   * 
   * validateUser({ name: 'John', age: 20 }); // => { success: true, data: {...} }
   * validateUser({ name: '', age: 20 });     // => { success: false, error: 'Name is required' }
   */
  filter<E>(
    predicate: (value: T) => boolean,
    error: E
  ): Pipeline<{ success: true; data: T } | { success: false; error: E }> {
    if (predicate(this._value)) {
      return new Pipeline({ success: true, data: this._value });
    }
    return new Pipeline({ success: false, error });
  }

  /**
   * Execute a side effect without changing the value.
   * Useful for logging, debugging, or triggering external actions.
   * 
   * @category Side Effects
   * @example
   * const result = Pipeline.of([1, 2, 3, 4, 5])
   *   .tap(arr => console.log('Original:', arr))
   *   .map(arr => arr.filter(x => x % 2 === 0))
   *   .tap(arr => console.log('Filtered:', arr))
   *   .map(arr => arr.reduce((a, b) => a + b, 0))
   *   .tap(sum => console.log('Sum:', sum))
   *   .value();
   * // Logs: Original: [1,2,3,4,5], Filtered: [2,4], Sum: 6
   * // Returns: 6
   * 
   * @example
   * // Analytics tracking
   * const processOrder = Pipeline.of(order)
   *   .tap(o => analytics.track('order_started', { orderId: o.id }))
   *   .map(o => applyDiscount(o))
   *   .tap(o => analytics.track('discount_applied', { amount: o.discount }))
   *   .map(o => calculateTax(o))
   *   .tap(o => analytics.track('order_completed', { total: o.total }))
   *   .value();
   */
  tap(fn: (value: T) => void): Pipeline<T> {
    fn(this._value);
    return this;
  }

  /**
   * Execute an async side effect without changing the value.
   * Useful for async logging, API calls, or other async side effects.
   * 
   * @category Async
   * @example
   * const saveUser = await Pipeline.of(userData)
   *   .tapAsync(async (user) => {
   *     await logToAnalytics('user_created', user);
   *   })
   *   .then(p => p.tapAsync(async (user) => {
   *     await sendWelcomeEmail(user.email);
   *   }))
   *   .then(p => p.value());
   * 
   * @example
   * // Progress tracking
   * const processLargeFile = await Pipeline.of(file)
   *   .tapAsync(f => updateProgress(0))
   *   .then(p => p.mapAsync(f => readFile(f)))
   *   .then(p => p.tapAsync(_ => updateProgress(33)))
   *   .then(p => p.mapAsync(content => parseContent(content)))
   *   .then(p => p.tapAsync(_ => updateProgress(66)))
   *   .then(p => p.mapAsync(data => saveToDatabase(data)))
   *   .then(p => p.tapAsync(_ => updateProgress(100)))
   *   .then(p => p.value());
   */
  async tapAsync(fn: (value: T) => Promise<void>): Promise<Pipeline<T>> {
    await fn(this._value);
    return this;
  }

  /**
   * Get the final value from the pipeline.
   * Extracts the transformed value, ending the pipeline chain.
   * 
   * @category Extraction
   * @example
   * const result = Pipeline.of(10)
   *   .map(x => x * 2)
   *   .map(x => x + 5)
   *   .value();
   * // => 25
   */
  value(): T {
    return this._value;
  }

  /**
   * Create a new pipeline with the given value.
   * Factory method for creating Pipeline instances.
   * 
   * @category Creation
   * @example
   * const pipeline = Pipeline.of(42);
   * 
   * @example
   * // With complex initial values
   * const userPipeline = Pipeline.of({
   *   id: 123,
   *   name: 'John Doe',
   *   email: 'john@example.com'
   * });
   */
  static of<T>(value: T): Pipeline<T> {
    return new Pipeline(value);
  }

  /**
   * Apply a function to the pipeline value and return the result.
   * Useful for conditional transformations or extracting values.
   * 
   * @category Advanced
   * @example
   * const discount = Pipeline.of(100)
   *   .apply(price => 
   *     price > 50 
   *       ? Pipeline.of(price * 0.9)  // 10% discount
   *       : Pipeline.of(price)
   *   )
   *   .value();
   * // => 90
   * 
   * @example
   * // Conditional branching
   * const processUser = (user: User) => Pipeline.of(user)
   *   .apply(u => {
   *     if (u.type === 'premium') {
   *       return Pipeline.of(u)
   *         .map(u => ({ ...u, benefits: ['ad-free', 'priority-support'] }))
   *         .map(u => ({ ...u, discount: 0.2 }));
   *     } else {
   *       return Pipeline.of(u)
   *         .map(u => ({ ...u, benefits: [] }))
   *         .map(u => ({ ...u, discount: 0 }));
   *     }
   *   })
   *   .value();
   */
  apply<U>(fn: (value: T) => Pipeline<U>): Pipeline<U> {
    return fn(this._value);
  }

  /**
   * Combine two pipelines using a binary function.
   * Useful for merging results from multiple pipelines.
   * 
   * @category Advanced
   * @example
   * const pipeline1 = Pipeline.of(5);
   * const pipeline2 = Pipeline.of(3);
   * 
   * const sum = pipeline1
   *   .combine(pipeline2, (a, b) => a + b)
   *   .value();
   * // => 8
   * 
   * @example
   * // Combining user data
   * const userPipeline = Pipeline.of({ id: 1, name: 'John' });
   * const preferencesPipeline = Pipeline.of({ theme: 'dark', lang: 'en' });
   * 
   * const completeUser = userPipeline
   *   .combine(preferencesPipeline, (user, prefs) => ({
   *     ...user,
   *     preferences: prefs
   *   }))
   *   .value();
   * // => { id: 1, name: 'John', preferences: { theme: 'dark', lang: 'en' } }
   */
  combine<U, R>(other: Pipeline<U>, fn: (a: T, b: U) => R): Pipeline<R> {
    return new Pipeline(fn(this._value, other._value));
  }

  /**
   * Execute a pipeline of async operations and return the final value directly.
   * Eliminates the need for chaining .then() calls for async transformations.
   * This is a more ergonomic alternative to chaining mapAsync calls.
   * 
   * @category Async
   * @example
   * // Instead of this verbose approach:
   * const result = await Pipeline.of('user@example.com')
   *   .mapAsync(fetchUserByEmail)
   *   .then(p => p.mapAsync(fetchUserPosts))
   *   .then(p => p.map(posts => posts.length))
   *   .then(p => p.value());
   * 
   * // Use pipeAsync for cleaner async pipelines:
   * const result = await Pipeline.of('user@example.com')
   *   .pipeAsync(
   *     fetchUserByEmail,
   *     fetchUserPosts,
   *     async (posts) => posts.length
   *   );
   * // => number of posts
   * 
   * @example
   * // Complex async data enrichment
   * const enrichedUser = await Pipeline.of('123')
   *   .pipeAsync(
   *     async (id) => fetchUser(id),
   *     async (user) => ({
   *       ...user,
   *       permissions: await fetchPermissions(user.roleId)
   *     }),
   *     async (user) => ({
   *       ...user,
   *       preferences: await fetchPreferences(user.id)
   *     }),
   *     async (user) => ({
   *       ...user,
   *       analytics: await fetchAnalytics(user.id)
   *     })
   *   );
   * 
   * @example
   * // Error handling in async pipelines
   * try {
   *   const order = await Pipeline.of('ORDER-123')
   *     .pipeAsync(
   *       fetchOrder,
   *       validateOrder,
   *       processPayment,
   *       shipOrder,
   *       sendConfirmation
   *     );
   *   console.log('Order processed:', order);
   * } catch (error) {
   *   console.error('Order processing failed:', error);
   * }
   * 
   * @since 2025-07-03
   */
  pipeAsync<B>(
    f1: (a: T) => Promise<B>
  ): Promise<B>;
  pipeAsync<B, C>(
    f1: (a: T) => Promise<B>,
    f2: (b: B) => Promise<C>
  ): Promise<C>;
  pipeAsync<B, C, D>(
    f1: (a: T) => Promise<B>,
    f2: (b: B) => Promise<C>,
    f3: (c: C) => Promise<D>
  ): Promise<D>;
  pipeAsync<B, C, D, E>(
    f1: (a: T) => Promise<B>,
    f2: (b: B) => Promise<C>,
    f3: (c: C) => Promise<D>,
    f4: (d: D) => Promise<E>
  ): Promise<E>;
  pipeAsync<B, C, D, E, F>(
    f1: (a: T) => Promise<B>,
    f2: (b: B) => Promise<C>,
    f3: (c: C) => Promise<D>,
    f4: (d: D) => Promise<E>,
    f5: (e: E) => Promise<F>
  ): Promise<F>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async pipeAsync(...fns: ((value: any) => Promise<any>)[]): Promise<any> {
    let result: unknown = this._value;
    for (const fn of fns) {
      result = await fn(result);
    }
    return result;
  }
}