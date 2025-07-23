/**
 * @module option
 * @description Option/Maybe type for explicit null/undefined handling in a functional way.
 * Provides a safe alternative to nullable values by wrapping them in a container type.
 * Forces explicit handling of edge cases and eliminates null pointer exceptions.
 * Inspired by functional programming languages like Haskell and Rust.
 * 
 * @example
 * ```typescript
 * import { Option, some, none, fromNullable, map, getOrElse } from './option.mts';
 * 
 * // creating options
 * const user = some({ id: '123', name: 'Alice' });
 * const notFound = none();
 * const maybeUser = fromNullable(localStorage.getItem('user'));
 * 
 * // transforming values
 * const userName = map((u: User) => u.name)(user);
 * 
 * // extracting values safely
 * const name = getOrElse(() => 'Anonymous')(userName);
 * 
 * // chaining operations
 * const greeting = pipe(
 *   fromNullable(getUserById(id)),
 *   map(u => u.name),
 *   map(name => `Hello, ${name}!`),
 *   getOrElse(() => 'Hello, stranger!')
 * );
 * ```
 * 
 * @category Core
 * @since 2025-07-03
 */

/**
 * Option type representing a value that may or may not exist.
 * @description A discriminated union type that forces explicit handling of null/undefined cases.
 * An Option is either Some<T> (containing a value) or None (representing absence).
 * 
 * @template T - The type of the value when present
 * 
 * @category Core Types
 * @since 2025-07-03
 */
export type Option<T> = Some<T> | None;

/**
 * Represents a value that exists.
 * @description The Some variant of Option, containing a non-null value.
 * 
 * @template T - The type of the contained value
 * @property {"Some"} _tag - Discriminant for pattern matching
 * @property {T} value - The contained value
 * 
 * @category Core Types
 * @since 2025-07-03
 */
export interface Some<T> {
  readonly _tag: 'Some';
  readonly value: T;
}

/**
 * Represents the absence of a value.
 * @description The None variant of Option, representing no value.
 * 
 * @property {"None"} _tag - Discriminant for pattern matching
 * 
 * @category Core Types
 * @since 2025-07-03
 */
export interface None {
  readonly _tag: 'None';
}

/**
 * Creates a Some variant containing the provided value.
 * @description Wraps a value in the Some variant of Option.
 * Use this when you have a value that definitely exists.
 * 
 * @template T - The type of the value to wrap
 * @param {T} value - The value to wrap in Some
 * @returns {Option<T>} A Some variant containing the value
 * 
 * @category Constructors
 * @example
 * const user = some({ id: '123', name: 'Alice' });
 * // => { _tag: 'Some', value: { id: '123', name: 'Alice' } }
 * 
 * @example
 * // Wrapping a found value
 * const found = database.find(id);
 * const result = found ? some(found) : none();
 * 
 * @example
 * // Creating from non-null assertion
 * const config = getConfig();
 * if (config.apiKey) {
 *   return some(config.apiKey);
 * }
 * 
 * @see none - Create an empty Option
 * @see fromNullable - Create Option from nullable value
 * @since 2025-07-03
 */
export const some = <T,>(value: T): Option<T> => ({
  _tag: 'Some',
  value,
});

/**
 * Creates a None variant representing no value.
 * @description Creates the None variant of Option, representing absence of value.
 * Use this when you want to explicitly represent "no value" in a type-safe way.
 * 
 * @returns {Option<never>} A None variant
 * 
 * @category Constructors
 * @example
 * const notFound = none();
 * // => { _tag: 'None' }
 * 
 * @example
 * // Representing search miss
 * const user = users.find(u => u.id === targetId);
 * return user ? some(user) : none();
 * 
 * @example
 * // Empty configuration
 * const apiKey = process.env.API_KEY;
 * return apiKey ? some(apiKey) : none();
 * 
 * @see some - Create an Option with a value
 * @see fromNullable - Create Option from nullable value
 * @since 2025-07-03
 */
export const none = (): Option<never> => ({
  _tag: 'None',
});

/**
 * Creates an Option from a nullable value.
 * @description Converts a nullable value into an Option.
 * Returns Some if the value is not null/undefined, None otherwise.
 * This is the primary way to bridge nullable APIs with Option.
 * 
 * @template T - The type of the non-null value
 * @param {T | null | undefined} value - The nullable value to convert
 * @returns {Option<T>} Some if value exists, None otherwise
 * 
 * @category Constructors
 * @example
 * const maybeUser = fromNullable(localStorage.getItem('user'));
 * // => Some(userData) if exists, None if null
 * 
 * @example
 * // Safe property access
 * const email = fromNullable(user?.contact?.email);
 * 
 * @example
 * // Array element access
 * const firstItem = fromNullable(items[0]);
 * 
 * @see some - Wrap a non-null value
 * @see none - Create an empty Option
 * @since 2025-07-03
 */
export const fromNullable = <T,>(value: T | null | undefined): Option<T> =>
  value === null || value === undefined ? none() : some(value);

/**
 * Creates an Option from a predicate function.
 * Returns Some if the predicate is true, None otherwise.
 * 
 * @category Constructors
 * @example
 * const positive = Option.fromPredicate((n: number) => n > 0);
 * positive(5); // => Some(5)
 * positive(-1); // => None
 * 
 * @example
 * // Validation wrapper
 * const validEmail = Option.fromPredicate((s: string) => 
 *   /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
 * );
 * 
 * @example
 * // Range check
 * const inRange = Option.fromPredicate((n: number) => n >= 0 && n <= 100);
 */
export const fromPredicate =
  <T,>(predicate: (value: T) => boolean) =>
  (value: T): Option<T> =>
    predicate(value) ? some(value) : none();

/**
 * Type guard to check if an Option is Some.
 * 
 * @category Type Guards
 * @example
 * const opt = Option.fromNullable(getValue());
 * if (Option.isSome(opt)) {
 *   console.log(opt.value); // TypeScript knows opt.value exists
 * }
 * 
 * @example
 * // Filtering array of options
 * const values = options.filter(Option.isSome).map(opt => opt.value);
 * 
 * @example
 * // Early return pattern
 * if (!Option.isSome(result)) {
 *   return defaultValue;
 * }
 * return processValue(result.value);
 */
export const isSome = <T,>(option: Option<T>): option is Some<T> =>
  option._tag === 'Some';

/**
 * Type guard to check if an Option is None.
 * 
 * @category Type Guards
 * @example
 * const user = findUser(id);
 * if (Option.isNone(user)) {
 *   throw new Error('User not found');
 * }
 * 
 * @example
 * // Conditional rendering
 * if (Option.isNone(data)) {
 *   return <LoadingSpinner />;
 * }
 * 
 * @example
 * // Validation check
 * const validated = validate(input);
 * if (Option.isNone(validated)) {
 *   return { error: 'Invalid input' };
 * }
 */
export const isNone = <T,>(option: Option<T>): option is None =>
  option._tag === 'None';

/**
 * Maps a function over the value in Some, does nothing for None.
 * 
 * @category Transformations
 * @example
 * const doubled = Option.map((n: number) => n * 2);
 * doubled(Option.some(5)); // => Some(10)
 * doubled(Option.none()); // => None
 * 
 * @example
 * // Transform user data
 * const userName = pipe(
 *   findUser(id),
 *   Option.map(user => user.name),
 *   Option.map(name => name.toUpperCase())
 * );
 * 
 * @example
 * // Parse and transform
 * const parsed = pipe(
 *   Option.fromNullable(jsonString),
 *   Option.map(str => JSON.parse(str)),
 *   Option.map(data => data.value)
 * );
 */
export const map =
  <A, B>(fn: (value: A) => B) =>
  (option: Option<A>): Option<B> =>
    isSome(option) ? some(fn(option.value)) : none();

/**
 * FlatMaps a function over the value in Some, does nothing for None.
 * Also known as chain or bind in other libraries.
 * 
 * @category Transformations
 * @example
 * const safeDivide = (n: number) => 
 *   n === 0 ? Option.none() : Option.some(10 / n);
 * 
 * const result = pipe(
 *   Option.some(5),
 *   Option.flatMap(safeDivide)
 * ); // => Some(2)
 * 
 * @example
 * // Chaining optional operations
 * const getManager = (employee: Employee) =>
 *   Option.fromNullable(employee.managerId)
 *     .pipe(Option.flatMap(id => findEmployee(id)));
 * 
 * @example
 * // Validation chain
 * const processUser = pipe(
 *   parseUser(input),
 *   Option.flatMap(validateAge),
 *   Option.flatMap(validateEmail)
 * );
 */
export const flatMap =
  <A, B>(fn: (value: A) => Option<B>) =>
  (option: Option<A>): Option<B> =>
    isSome(option) ? fn(option.value) : none();

/**
 * Alias for flatMap - monadic bind operation.
 * 
 * @category Transformations
 * @see flatMap
 */
export const chain = flatMap;

/**
 * Returns the value if Some, otherwise returns the provided default.
 * 
 * @category Extractors
 * @example
 * const value = Option.getOrElse(() => 'default')(maybeValue);
 * 
 * @example
 * // Configuration with defaults
 * const port = pipe(
 *   Option.fromNullable(process.env.PORT),
 *   Option.map(parseInt),
 *   Option.getOrElse(() => 3000)
 * );
 * 
 * @example
 * // User preferences
 * const theme = pipe(
 *   getUserPreference('theme'),
 *   Option.getOrElse(() => 'light')
 * );
 */
export const getOrElse =
  <T,>(defaultValue: () => T) =>
  (option: Option<T>): T =>
    isSome(option) ? option.value : defaultValue();

/**
 * Returns the first Some option, or None if both are None.
 * Useful for fallback chains.
 * 
 * @category Combinations
 * @example
 * const config = Option.orElse(
 *   () => Option.fromNullable(process.env.API_KEY)
 * )(Option.fromNullable(config.apiKey));
 * 
 * @example
 * // Multiple fallbacks
 * const findUser = (id: string) => pipe(
 *   findInCache(id),
 *   Option.orElse(() => findInDatabase(id)),
 *   Option.orElse(() => findInArchive(id))
 * );
 * 
 * @example
 * // Try alternative parsing
 * const parsed = pipe(
 *   tryParseJSON(input),
 *   Option.orElse(() => tryParseYAML(input))
 * );
 */
export const orElse =
  <T,>(alternative: () => Option<T>) =>
  (option: Option<T>): Option<T> =>
    isSome(option) ? option : alternative();

/**
 * Filters the value in Some based on a predicate.
 * Returns None if the predicate is false or if already None.
 * Supports type guard predicates for type refinement.
 * 
 * @category Refinements
 * @example
 * const positive = Option.filter((n: number) => n > 0);
 * positive(Option.some(5)); // => Some(5)
 * positive(Option.some(-1)); // => None
 * 
 * @example
 * // Type narrowing with type guards
 * const maybeString: Option<string | number> = Option.some(123);
 * const isString = (v: unknown): v is string => typeof v === 'string';
 * const onlyString: Option<string> = pipe(maybeString, Option.filter(isString));
 * 
 * @example
 * // User authorization
 * const authorizedUser = pipe(
 *   findUser(id),
 *   Option.filter(user => user.role === 'admin')
 * );
 * 
 * @example
 * // Valid data filtering
 * const validData = pipe(
 *   parseData(input),
 *   Option.filter(data => data.length > 0),
 *   Option.filter(data => data.every(isValid))
 * );
 */
export function filter<T, S extends T>(
  predicate: (value: T) => value is S
): (option: Option<T>) => Option<S>;
export function filter<T>(
  predicate: (value: T) => boolean
): (option: Option<T>) => Option<T>;
export function filter<T>(predicate: (value: T) => boolean) {
  return (option: Option<T>): Option<T> =>
    isSome(option) && predicate(option.value) ? option : none();
}

/**
 * Pattern matching for Option types.
 * Provides exhaustive handling of both Some and None cases.
 * 
 * @category Pattern Matching
 * @example
 * const message = Option.match({
 *   some: (user) => `Hello, ${user.name}!`,
 *   none: () => 'Hello, guest!'
 * })(maybeUser);
 * 
 * @example
 * // React component rendering
 * const UserProfile = ({ userId }: Props) => {
 *   const user = useUser(userId);
 *   
 *   return Option.match({
 *     some: (u) => <Profile user={u} />,
 *     none: () => <NotFound />
 *   })(user);
 * };
 * 
 * @example
 * // API response handling
 * const response = await Option.match({
 *   some: async (data) => api.update(data),
 *   none: async () => api.create(defaults)
 * })(existingData);
 */
export const match =
  <T, A, B>(patterns: {
    some: (value: T) => A;
    none: () => B;
  }) =>
  (option: Option<T>): A | B =>
    isSome(option) ? patterns.some(option.value) : patterns.none();

/**
 * Converts an Option to a nullable value.
 * Some(value) becomes value, None becomes null.
 * 
 * @category Conversions
 * @example
 * const value = Option.toNullable(maybeValue);
 * localStorage.setItem('key', value ?? '');
 * 
 * @example
 * // Database update
 * const update = {
 *   name: Option.toNullable(maybeName),
 *   email: Option.toNullable(maybeEmail),
 *   phone: Option.toNullable(maybePhone)
 * };
 * 
 * @example
 * // JSON serialization
 * const data = {
 *   id: user.id,
 *   nickname: Option.toNullable(user.nickname)
 * };
 */
export const toNullable = <T,>(option: Option<T>): T | null =>
  isSome(option) ? option.value : null;

/**
 * Converts an Option to undefined if None.
 * Some(value) becomes value, None becomes undefined.
 * 
 * @category Conversions
 * @example
 * const params = {
 *   limit: 10,
 *   offset: Option.toUndefined(maybeOffset)
 * };
 * 
 * @example
 * // Optional chaining alternative
 * const city = Option.toUndefined(
 *   Option.map((addr: Address) => addr.city)(maybeAddress)
 * );
 */
export const toUndefined = <T,>(option: Option<T>): T | undefined =>
  isSome(option) ? option.value : undefined;

/**
 * Creates an Option from a function that might throw an error.
 * Returns Some with the result if the function succeeds, None if it throws.
 * 
 * @category Constructors
 * @example
 * const safeParse = (json: string) => Option.tryCatch(() => JSON.parse(json));
 * safeParse('{"a":1}'); // => Some({ a: 1 })
 * safeParse('invalid json'); // => None
 * 
 * @example
 * // Safe file parsing
 * const config = Option.tryCatch(() => 
 *   JSON.parse(fs.readFileSync('config.json', 'utf8'))
 * );
 * 
 * @example
 * // Safe URL parsing
 * const url = Option.tryCatch(() => new URL(input));
 */
export const tryCatch = <T,>(fn: () => T): Option<T> => {
  try {
    return some(fn());
  } catch {
    return none();
  }
};

/**
 * Executes a side-effecting function on the value in Some.
 * Returns the original Option unchanged.
 * 
 * @category Side Effects
 * @example
 * const logValue = pipe(
 *   Option.some(42),
 *   Option.tap(value => console.log('Found value:', value))
 * ); // logs "Found value: 42" and returns Some(42)
 * 
 * @example
 * // Debug logging in a chain
 * const result = pipe(
 *   getUserInput(),
 *   Option.tap(input => console.log('Raw input:', input)),
 *   Option.map(normalize),
 *   Option.tap(normalized => console.log('Normalized:', normalized)),
 *   Option.filter(isValid)
 * );
 * 
 * @example
 * // Side effects like analytics
 * const trackEvent = pipe(
 *   findUser(id),
 *   Option.tap(user => analytics.track('user.found', { id: user.id }))
 * );
 */
export const tap =
  <T,>(fn: (value: T) => void) =>
  (option: Option<T>): Option<T> => {
    if (isSome(option)) {
      fn(option.value);
    }
    return option;
  };

/**
 * Namespace containing all Option utilities.
 * 
 * @category Namespace
 */
export const Option = {
  some,
  none,
  fromNullable,
  fromPredicate,
  tryCatch,
  isSome,
  isNone,
  map,
  flatMap,
  chain,
  getOrElse,
  orElse,
  filter,
  tap,
  match,
  toNullable,
  toUndefined,
} as const;

/**
 * Combines two Options using a binary function.
 * Returns None if either Option is None.
 * 
 * @category Combinations
 * @example
 * const add = (a: number, b: number) => a + b;
 * const sum = lift2(add)(Option.some(5), Option.some(3));
 * // => Some(8)
 * 
 * @example
 * // Form validation
 * const createUser = (name: string, email: string) => ({ name, email });
 * const validUser = lift2(createUser)(
 *   validateName(input.name),
 *   validateEmail(input.email)
 * );
 * 
 * @example
 * // Coordinate operations
 * const distance = (x: number, y: number) => Math.sqrt(x * x + y * y);
 * const result = lift2(distance)(parseX(input), parseY(input));
 */
export const lift2 =
  <A, B, C>(fn: (a: A, b: B) => C) =>
  (optionA: Option<A>, optionB: Option<B>): Option<C> =>
    isSome(optionA) && isSome(optionB)
      ? some(fn(optionA.value, optionB.value))
      : none();

/**
 * Sequences an array of Options into an Option of array.
 * Returns Some with all values if all are Some, None if any is None.
 * 
 * @category Combinations
 * @example
 * const results = sequence([
 *   Option.some(1),
 *   Option.some(2),
 *   Option.some(3)
 * ]);
 * // => Some([1, 2, 3])
 * 
 * @example
 * // Parse multiple values
 * const numbers = sequence(
 *   inputs.map(input => parseNumber(input))
 * );
 * 
 * @example
 * // Validate all fields
 * const validatedFields = sequence([
 *   validateField('name', data.name),
 *   validateField('email', data.email),
 *   validateField('age', data.age)
 * ]);
 */
export const sequence = <T,>(options: Option<T>[]): Option<T[]> => {
  const results: T[] = [];
  for (const option of options) {
    if (isNone(option)) {
      return none();
    }
    results.push(option.value);
  }
  return some(results);
};

/**
 * Applies a function wrapped in an Option to a value wrapped in an Option.
 * 
 * @category Apply
 * @example
 * const addOne = (n: number) => n + 1;
 * const result = ap(Option.some(addOne))(Option.some(5));
 * // => Some(6)
 * 
 * @example
 * // Partial application with options
 * const add = (a: number) => (b: number) => a + b;
 * const maybeAdd5 = Option.map(add)(Option.some(5));
 * const result = ap(maybeAdd5)(Option.some(3));
 * // => Some(8)
 */
export const ap =
  <A, B>(optionFn: Option<(a: A) => B>) =>
  (optionA: Option<A>): Option<B> =>
    isSome(optionFn) && isSome(optionA)
      ? some(optionFn.value(optionA.value))
      : none();

/**
 * Sequences a struct of Options into an Option of a struct.
 * Returns Some with the struct of all values if all are Some, None if any is None.
 * 
 * @category Combinations
 * @example
 * const result = sequenceS({
 *   a: Option.some(1),
 *   b: Option.some('hello')
 * });
 * // => Some({ a: 1, b: 'hello' })
 * 
 * @example
 * // Form validation
 * const validForm = sequenceS({
 *   name: validateName(input.name),
 *   email: validateEmail(input.email),
 *   age: validateAge(input.age)
 * });
 * 
 * @example
 * // Configuration validation
 * const config = sequenceS({
 *   apiKey: Option.fromNullable(process.env.API_KEY),
 *   port: Option.tryCatch(() => parseInt(process.env.PORT!)),
 *   debug: Option.fromNullable(process.env.DEBUG).pipe(Option.map(v => v === 'true'))
 * });
 */
export const sequenceS = <T extends Record<string, Option<unknown>>,>(
  struct: T
): Option<{ [K in keyof T]: T[K] extends Option<infer U> ? U : never }> => {
  const result: Record<string, unknown> = {};
  for (const key in struct) {
    const option = struct[key];
    if (option && isSome(option)) {
      result[key] = option.value;
    } else {
      return none();
    }
  }
  return some(result as { [K in keyof T]: T[K] extends Option<infer U> ? U : never });
};