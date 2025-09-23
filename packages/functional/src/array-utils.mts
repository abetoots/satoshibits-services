/**
 * @module array-utils
 * @description Functional utilities for working with arrays in a type-safe, immutable manner.
 * These functions are designed to be composed and follow functional programming principles.
 * All operations return new arrays, preserving immutability.
 * 
 * ### For Dummies
 * - These helpers are fancy versions of `map`/`filter` that never mutate the original array.
 * - You plug them into pipelines to keep array logic readable and testable.
 * - Every function returns a **new** array, so you can trust the input stays untouched.
 *
 * ### Decision Tree
 * - Need element plus index? Reach for `mapWithIndex`.
 * - Want to transform and drop `undefined` results in one go? Use `filterMap`.
 * - Splitting into fixed-size slices? Call `chunk(size)`.
 * - Grouping by a computed key? Use `groupBy(keyFn)`.
 * - Need safe lookups? `findSafe(predicate)` returns an Option instead of `undefined`.
 * - Splitting by predicate? `partition(predicate)` gives you matching and non-matching buckets.
 *
 * @example
 * ```typescript
 * import { filterMap, chunk, groupBy } from './array-utils.mts';
 * 
 * // filter and transform in one pass
 * const numbers = filterMap((s: string) => {
 *   const n = parseInt(s);
 *   return isNaN(n) ? undefined : n;
 * })(['1', 'a', '2', 'b', '3']);
 * // => [1, 2, 3]
 * 
 * // chunk into batches
 * const batches = chunk(3)([1, 2, 3, 4, 5, 6, 7]);
 * // => [[1, 2, 3], [4, 5, 6], [7]]
 * 
 * // group by property
 * const users = [
 *   { name: 'Alice', role: 'admin' },
 *   { name: 'Bob', role: 'user' },
 *   { name: 'Charlie', role: 'admin' }
 * ];
 * const byRole = groupBy((u: typeof users[0]) => u.role)(users);
 * // => { admin: [Alice, Charlie], user: [Bob] }
 * ```
 * 
 * @category Utilities
 * @since 2025-07-03
 */

/**
 * Map over an array with index.
 * @description Transforms each element of an array using a function that receives both the element and its index.
 * Useful when you need both the element and its position during transformation.
 * Preserves the original array and returns a new array with transformed values.
 * 
 * @template T - The type of elements in the input array
 * @template U - The type of elements in the output array
 * @param {function(T, number): U} fn - Transformation function that receives item and index
 * @returns {function(T[]): U[]} A function that takes an array and returns the transformed array
 * 
 * @category Transformation
 * @example
 * const indexed = mapWithIndex((item, i) => `${i}: ${item}`)(['a', 'b', 'c']);
 * // => ['0: a', '1: b', '2: c']
 * 
 * @example
 * // Creating a numbered list
 * const items = ['First', 'Second', 'Third'];
 * const numbered = mapWithIndex((item, i) => `${i + 1}. ${item}`)(items);
 * // => ['1. First', '2. Second', '3. Third']
 * 
 * @example
 * // Add index metadata to objects
 * const data = [{ name: 'Alice' }, { name: 'Bob' }];
 * const withIndex = mapWithIndex((item, i) => ({ ...item, index: i }))(data);
 * // => [{ name: 'Alice', index: 0 }, { name: 'Bob', index: 1 }]
 * 
 * @see map - Standard array map without index
 * @see filterMap - Transform and filter in one pass
 * @since 2025-07-03
 */
export const mapWithIndex =
  <T, U>(fn: (item: T, index: number) => U) =>
  (arr: T[]): U[] =>
    arr.map(fn);

/**
 * Filter and map in a single pass, removing undefined values.
 * More efficient than chaining filter and map when transformation might return undefined.
 * Optimized to avoid creating intermediate arrays for better memory efficiency.
 * 
 * @category Transformation
 * @example
 * const nums = filterMap((s: string) => {
 *   const n = parseInt(s);
 *   return isNaN(n) ? undefined : n;
 * })(['1', 'a', '2', 'b', '3']);
 * // => [1, 2, 3]
 * 
 * @example
 * // Parse and validate in one pass
 * const parseEmails = filterMap((str: string) => {
 *   const trimmed = str.trim();
 *   return trimmed.includes('@') ? trimmed : undefined;
 * });
 * parseEmails(['  john@example.com', 'invalid', 'jane@test.com  ']);
 * // => ['john@example.com', 'jane@test.com']
 * 
 * @example
 * // Extract and transform nested data
 * const users = [
 *   { name: 'Alice', profile: { age: 25 } },
 *   { name: 'Bob', profile: null },
 *   { name: 'Charlie', profile: { age: 30 } }
 * ];
 * const ages = filterMap((u: typeof users[0]) => 
 *   u.profile ? { name: u.name, age: u.profile.age } : undefined
 * )(users);
 * // => [{ name: 'Alice', age: 25 }, { name: 'Charlie', age: 30 }]
 * 
 * @see map - Transform without filtering
 * @see filter - Filter without transformation
 * @since 2025-07-03
 */
export const filterMap =
  <T, U>(fn: (item: T, index: number) => U | undefined) =>
  (arr: T[]): U[] =>
    arr.reduce((acc: U[], item, index) => {
      const result = fn(item, index);
      if (result !== undefined) {
        acc.push(result);
      }
      return acc;
    }, []);

/**
 * Chunk an array into smaller arrays of specified size.
 * @description Splits an array into multiple sub-arrays of a specified maximum size.
 * The last chunk may contain fewer elements if the array length is not evenly divisible by the chunk size.
 * Useful for pagination, batch processing, or creating grid layouts.
 * 
 * @template T - The type of elements in the array
 * @param {number} size - The maximum size of each chunk (must be positive)
 * @returns {function(T[]): T[][]} A function that takes an array and returns an array of chunks
 * 
 * @category Grouping
 * @example
 * const chunks = chunk(2)([1, 2, 3, 4, 5]);
 * // => [[1, 2], [3, 4], [5]]
 * 
 * @example
 * // Batch API requests
 * const userIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const batches = chunk(3)(userIds);
 * // => [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]
 * 
 * @example
 * // Create rows for a grid
 * const items = ['A', 'B', 'C', 'D', 'E', 'F'];
 * const rows = chunk(3)(items);
 * // => [['A', 'B', 'C'], ['D', 'E', 'F']]
 * 
 * @example
 * // Process large dataset in batches
 * const processInBatches = async <T>(items: T[], batchSize: number, processor: (batch: T[]) => Promise<void>) => {
 *   const batches = chunk(batchSize)(items);
 *   for (const batch of batches) {
 *     await processor(batch);
 *   }
 * };
 * 
 * @see groupBy - Group by a key function
 * @see partition - Split into two arrays
 * @since 2025-07-03
 */
export const chunk =
  <T,>(size: number) =>
  (arr: T[]): T[][] => {
    if (size <= 0) {
      throw new RangeError("chunk size must be greater than 0");
    }
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  };

/**
 * Group array elements by a key function.
 * @description Creates an object where keys are the grouping values and values are arrays of elements.
 * Each element is placed into exactly one group based on the key function result.
 * The order of elements within each group is preserved from the original array.
 * 
 * @template T - The type of elements in the array
 * @template K - The type of the grouping key (must be string or number)
 * @param {function(T): K} keyFn - Function that extracts the grouping key from each element
 * @returns {function(T[]): Record<K, T[]>} A function that takes an array and returns grouped elements
 * 
 * @category Grouping
 * @example
 * const users = [
 *   { name: 'Alice', age: 25 },
 *   { name: 'Bob', age: 30 },
 *   { name: 'Charlie', age: 25 }
 * ];
 * const byAge = groupBy((u: typeof users[0]) => u.age)(users);
 * // => { 25: [{ name: 'Alice', age: 25 }, { name: 'Charlie', age: 25 }], 30: [{ name: 'Bob', age: 30 }] }
 * 
 * @example
 * // Group by first letter
 * const words = ['apple', 'banana', 'apricot', 'cherry', 'avocado'];
 * const byFirstLetter = groupBy((word: string) => word[0])(words);
 * // => { a: ['apple', 'apricot', 'avocado'], b: ['banana'], c: ['cherry'] }
 * 
 * @example
 * // Group transactions by status
 * const transactions = [
 *   { id: 1, status: 'pending', amount: 100 },
 *   { id: 2, status: 'completed', amount: 200 },
 *   { id: 3, status: 'pending', amount: 150 }
 * ];
 * const byStatus = groupBy((t: typeof transactions[0]) => t.status)(transactions);
 * // => { pending: [{id: 1, ...}, {id: 3, ...}], completed: [{id: 2, ...}] }
 * 
 * @example
 * // Group by computed property
 * const scores = [65, 72, 88, 95, 42, 58, 90];
 * const byGrade = groupBy((score: number) => {
 *   if (score >= 90) return 'A';
 *   if (score >= 80) return 'B';
 *   if (score >= 70) return 'C';
 *   if (score >= 60) return 'D';
 *   return 'F';
 * })(scores);
 * // => { A: [95, 90], B: [88], C: [72], D: [65], F: [42, 58] }
 * 
 * @see chunk - Group into fixed-size arrays
 * @see partition - Split into two groups
 * @since 2025-07-03
 */
export const groupBy =
  <T, K extends string | number>(keyFn: (item: T) => K) =>
  (arr: T[]): Record<K, T[]> => {
    const groups = {} as Record<K, T[]>;
    for (const item of arr) {
      const key = keyFn(item);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    }
    return groups;
  };

/**
 * Find the first item that matches a predicate, returning a Result.
 * @description Safe alternative to Array.find that explicitly handles the not-found case.
 * Returns a discriminated union result that forces explicit handling of both success and failure cases.
 * This prevents runtime errors from undefined values and makes the control flow explicit.
 * 
 * @template T - The type of elements in the array
 * @param {function(T): boolean} predicate - Function to test each element
 * @returns {function(T[]): { success: true; data: T } | { success: false; error: string }} A function that searches the array and returns a Result
 * 
 * @category Search
 * @example
 * const result = findSafe((n: number) => n > 3)([1, 2, 3, 4, 5]);
 * // => { success: true, data: 4 }
 * 
 * const notFound = findSafe((n: number) => n > 10)([1, 2, 3]);
 * // => { success: false, error: 'Item not found' }
 * 
 * @example
 * // Find user by email
 * const users = [
 *   { id: 1, email: 'alice@example.com' },
 *   { id: 2, email: 'bob@example.com' }
 * ];
 * const findByEmail = (email: string) => 
 *   findSafe((u: typeof users[0]) => u.email === email)(users);
 * 
 * const result = findByEmail('alice@example.com');
 * if (result.success) {
 *   console.log('Found user:', result.data.id);
 * } else {
 *   console.log('User not found');
 * }
 * 
 * @example
 * // Chain with other operations safely
 * const processUser = (email: string) => {
 *   const result = findSafe((u: User) => u.email === email)(users);
 *   if (!result.success) {
 *     return { success: false, error: `No user with email ${email}` };
 *   }
 *   // process result.data safely
 *   return { success: true, data: processUserData(result.data) };
 * };
 * 
 * @see find - Native array find (returns undefined)
 * @see filter - Get all matching items
 * @since 2025-07-03
 */
export const findSafe =
  <T,>(predicate: (item: T) => boolean) =>
  (
    arr: T[],
  ): { success: true; data: T } | { success: false; error: string } => {
    const index = arr.findIndex(predicate);
    if (index >= 0) {
      return { success: true, data: arr[index] as T };
    }
    return { success: false, error: "Item not found" };
  };

/**
 * Partition an array into two arrays based on a predicate.
 * @description Splits an array into two parts: elements that satisfy the predicate go into the first array,
 * and elements that don't satisfy the predicate go into the second array.
 * More efficient than running filter twice with opposite predicates.
 * Preserves the relative order of elements in both resulting arrays.
 * 
 * @template T - The type of elements in the array
 * @param {function(T): boolean} predicate - Function to test each element
 * @returns {function(T[]): [T[], T[]]} A function that takes an array and returns a tuple of [matching, non-matching] arrays
 * 
 * @category Grouping
 * @example
 * const [evens, odds] = partition((n: number) => n % 2 === 0)([1, 2, 3, 4, 5]);
 * // => evens: [2, 4], odds: [1, 3, 5]
 * 
 * @example
 * // Separate valid and invalid data
 * const data = [
 *   { id: 1, valid: true },
 *   { id: 2, valid: false },
 *   { id: 3, valid: true }
 * ];
 * const [valid, invalid] = partition((item: typeof data[0]) => item.valid)(data);
 * // => valid: [{id: 1, valid: true}, {id: 3, valid: true}]
 * // => invalid: [{id: 2, valid: false}]
 * 
 * @example
 * // Separate active and inactive users
 * const users = [
 *   { name: 'Alice', lastLogin: new Date('2024-01-10') },
 *   { name: 'Bob', lastLogin: new Date('2023-12-01') },
 *   { name: 'Charlie', lastLogin: new Date('2024-01-14') }
 * ];
 * const thirtyDaysAgo = new Date();
 * thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
 * 
 * const [active, inactive] = partition(
 *   (u: typeof users[0]) => u.lastLogin > thirtyDaysAgo
 * )(users);
 * 
 * @example
 * // Partition by multiple criteria
 * const products = [
 *   { name: 'Laptop', price: 1200, inStock: true },
 *   { name: 'Mouse', price: 25, inStock: false },
 *   { name: 'Keyboard', price: 80, inStock: true }
 * ];
 * const [available, unavailable] = partition(
 *   (p: typeof products[0]) => p.inStock && p.price < 1000
 * )(products);
 * // => available: [{ name: 'Keyboard', ... }]
 * // => unavailable: [{ name: 'Laptop', ... }, { name: 'Mouse', ... }]
 * 
 * @see filter - Get only matching items
 * @see groupBy - Group into multiple categories
 * @since 2025-07-03
 */
export const partition =
  <T,>(predicate: (item: T) => boolean) =>
  (arr: T[]): [T[], T[]] => {
    const left: T[] = [];
    const right: T[] = [];
    for (const item of arr) {
      if (predicate(item)) {
        left.push(item);
      } else {
        right.push(item);
      }
    }
    return [left, right];
  };
