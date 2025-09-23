/**
 * @module predicates
 * @description Functional utilities for composing and manipulating predicate functions.
 * Predicates are functions that return boolean values and are fundamental
 * for filtering, validation, and conditional logic. This module provides
 * combinators for building complex predicates from simple ones, along with
 * common predicate patterns for everyday use.
 * 
 * ### For Dummies
 * - A predicate is just a yes/no function; this module helps you wire them together.
 * - Build tiny checks (`isNotNil`, `inRange`) and compose them like Lego to express rules.
 * - Everything stays pure, so you can reuse predicates across filters, guards, and validators.
 *
 * ### Decision Tree
 * - Need every rule to pass? Combine them with `and(predicateA, predicateB, ...)`.
 * - Any rule may pass? Use `or(...)`.
 * - Want the opposite? Wrap with `not(predicate)`.
 * - Exactly one condition allowed? Reach for `xor(a, b)`.
 * - Checking structure? Helpers like `hasProperty('field')`, `isNotNil`, and `inRange(min, max)` get you started.
 *
 * @example
 * ```typescript
 * import { and, or, not, isNotNil, inRange, hasProperty } from './predicates.mts';
 * 
 * // compose predicates with logical operators
 * const isPositiveEven = and(
 *   (n: number) => n > 0,
 *   (n: number) => n % 2 === 0
 * );
 * 
 * // create reusable validation functions
 * const isValidUser = and(
 *   hasProperty('email'),
 *   hasProperty('name'),
 *   user => isNotNil(user.email) && user.email.includes('@')
 * );
 * 
 * // filter collections
 * const validUsers = users.filter(isValidUser);
 * const adults = people.filter(person => inRange(18, 120)(person.age));
 * ```
 * 
 * @category Core
 * @since 2025-07-03
 */

/**
 * Logical AND combinator for predicates.
 * @description Returns true only if all predicates return true. Short-circuits
 * on the first false result for efficiency. Accepts any number of predicates
 * and combines them into a single predicate function.
 * 
 * @template T - The type of value being tested
 * @param {Array<(value: T) => boolean>} predicates - Functions to combine with AND logic
 * @returns {(value: T) => boolean} A predicate that returns true if all predicates pass
 * 
 * @category Combinators
 * @example
 * // Basic number validation
 * const isPositive = (n: number) => n > 0;
 * const isEven = (n: number) => n % 2 === 0;
 * const isPositiveEven = and(isPositive, isEven);
 * 
 * isPositiveEven(4);  // => true
 * isPositiveEven(-2); // => false (not positive)
 * isPositiveEven(3);  // => false (not even)
 * 
 * @example
 * // Validating user data
 * const hasName = (user: { name?: string }) => !!user.name;
 * const hasEmail = (user: { email?: string }) => !!user.email;
 * const isAdult = (user: { age?: number }) => (user.age ?? 0) >= 18;
 * 
 * const isValidAdultUser = and(hasName, hasEmail, isAdult);
 * isValidAdultUser({ name: 'John', email: 'john@example.com', age: 25 }); // => true
 * 
 * @example
 * // Form validation with multiple rules
 * const isValidPassword = and(
 *   (pwd: string) => pwd.length >= 8,
 *   (pwd: string) => /[A-Z]/.test(pwd),
 *   (pwd: string) => /[0-9]/.test(pwd),
 *   (pwd: string) => /[!@#$%^&*]/.test(pwd)
 * );
 * 
 * isValidPassword('Pass123!'); // => true
 * isValidPassword('weak');     // => false
 * 
 * @see or - Logical OR combinator
 * @see not - Logical NOT combinator
 * @since 2025-07-03
 */
export const and =
  <T,>(...predicates: ((value: T) => boolean)[]) =>
  (value: T): boolean =>
    predicates.every((predicate) => predicate(value));

/**
 * Logical OR combinator for predicates.
 * @description Returns true if at least one predicate returns true. Short-circuits
 * on the first true result for efficiency. Accepts any number of predicates
 * and combines them into a single predicate function.
 * 
 * @template T - The type of value being tested
 * @param {Array<(value: T) => boolean>} predicates - Functions to combine with OR logic
 * @returns {(value: T) => boolean} A predicate that returns true if any predicate passes
 * 
 * @category Combinators
 * @example
 * // Role-based access control
 * const isAdmin = (user: { role: string }) => user.role === 'admin';
 * const isModerator = (user: { role: string }) => user.role === 'moderator';
 * const hasPrivileges = or(isAdmin, isModerator);
 * 
 * hasPrivileges({ role: 'admin' });     // => true
 * hasPrivileges({ role: 'moderator' }); // => true
 * hasPrivileges({ role: 'user' });      // => false
 * 
 * @example
 * // Multiple payment methods
 * const hasCreditCard = (payment: { type: string }) => payment.type === 'credit';
 * const hasPayPal = (payment: { type: string }) => payment.type === 'paypal';
 * const hasCrypto = (payment: { type: string }) => payment.type === 'crypto';
 * 
 * const acceptsPayment = or(hasCreditCard, hasPayPal, hasCrypto);
 * acceptsPayment({ type: 'paypal' }); // => true
 * 
 * @example
 * // Flexible search criteria
 * const searchTerm = 'john';
 * const matchesSearch = or(
 *   (user: User) => user.name.toLowerCase().includes(searchTerm),
 *   (user: User) => user.email.toLowerCase().includes(searchTerm),
 *   (user: User) => user.username.toLowerCase().includes(searchTerm)
 * );
 * 
 * const searchResults = users.filter(matchesSearch);
 * 
 * @see and - Logical AND combinator
 * @see not - Logical NOT combinator
 * @since 2025-07-03
 */
export const or =
  <T,>(...predicates: ((value: T) => boolean)[]) =>
  (value: T): boolean =>
    predicates.some((predicate) => predicate(value));

/**
 * Logical NOT combinator for predicates.
 * @description Inverts the result of a predicate, turning true to false and
 * false to true. Useful for creating the opposite of existing predicates
 * without duplicating logic.
 * 
 * @template T - The type of value being tested
 * @param {(value: T) => boolean} predicate - The predicate to invert
 * @returns {(value: T) => boolean} A predicate that returns the opposite result
 * 
 * @category Combinators
 * @example
 * // Basic negation
 * const isPositive = (n: number) => n > 0;
 * const isNegativeOrZero = not(isPositive);
 * 
 * isNegativeOrZero(-5); // => true
 * isNegativeOrZero(0);  // => true
 * isNegativeOrZero(5);  // => false
 * 
 * @example
 * // Filtering out specific items
 * const isError = (log: { level: string }) => log.level === 'error';
 * const nonErrorLogs = logs.filter(not(isError));
 * 
 * @example
 * // Excluding items from selection
 * const isBlacklisted = oneOf(blacklistedIds);
 * const allowedItems = items.filter(not(item => isBlacklisted(item.id)));
 * 
 * @see and - Logical AND combinator
 * @see or - Logical OR combinator
 * @since 2025-07-03
 */
export const not =
  <T,>(predicate: (value: T) => boolean) =>
  (value: T): boolean =>
    !predicate(value);

/**
 * Exclusive OR (XOR) combinator for predicates.
 * @description Returns true if exactly one predicate returns true, but not both.
 * Useful for ensuring mutually exclusive conditions or validating that
 * exactly one option is selected from a pair.
 * 
 * @template T - The type of value being tested
 * @param {(value: T) => boolean} predicate1 - First predicate to test
 * @param {(value: T) => boolean} predicate2 - Second predicate to test
 * @returns {(value: T) => boolean} A predicate that returns true if exactly one input predicate passes
 * 
 * @category Combinators
 * @example
 * // Authentication method validation
 * const hasUsername = (auth: { username?: string }) => !!auth.username;
 * const hasEmail = (auth: { email?: string }) => !!auth.email;
 * const hasExactlyOneIdentifier = xor(hasUsername, hasEmail);
 * 
 * hasExactlyOneIdentifier({ username: 'john' });                    // => true
 * hasExactlyOneIdentifier({ email: 'john@example.com' });          // => true
 * hasExactlyOneIdentifier({ username: 'john', email: 'j@e.com' }); // => false
 * hasExactlyOneIdentifier({});                                     // => false
 * 
 * @example
 * // Toggle state validation
 * const isManualMode = (config: Config) => config.mode === 'manual';
 * const hasAutoSettings = (config: Config) => !!config.autoSettings;
 * const isValidConfig = xor(isManualMode, hasAutoSettings);
 * // Ensures either manual mode OR auto settings, but not both
 * 
 * @see and - Logical AND combinator
 * @see or - Logical OR combinator
 * @since 2025-07-03
 */
export const xor =
  <T,>(predicate1: (value: T) => boolean, predicate2: (value: T) => boolean) =>
  (value: T): boolean => {
    const p1 = predicate1(value);
    const p2 = predicate2(value);
    return (p1 && !p2) || (!p1 && p2);
  };

/**
 * Creates a predicate that checks if a value is not null or undefined.
 * @description Type guard function that narrows types by excluding null and undefined.
 * Particularly useful for filtering arrays and conditional type narrowing.
 * Unlike truthiness checks, this explicitly checks for null/undefined only.
 * 
 * @template T - The type of the non-null value
 * @param {T | null | undefined} value - The value to check
 * @returns {value is T} True if the value is not null or undefined
 * 
 * @category Type Guards
 * @example
 * // Array filtering with type narrowing
 * const values: (string | null | undefined)[] = ['a', null, 'b', undefined, 'c'];
 * const nonNullValues = values.filter(isNotNil);
 * // => ['a', 'b', 'c'] with type string[]
 * 
 * @example
 * // Type guard in conditional
 * function processValue(value: string | null) {
 *   if (isNotNil(value)) {
 *     // TypeScript knows value is string here
 *     return value.toUpperCase();
 *   }
 *   return 'DEFAULT';
 * }
 * 
 * @example
 * // Optional chaining alternative
 * const users: (User | null)[] = await fetchUsers();
 * const activeUsers = users
 *   .filter(isNotNil)
 *   .filter(user => user.status === 'active');
 * 
 * @see isNil - Check if value is null or undefined
 * @see isEmpty - Check if value is empty
 * @since 2025-07-03
 */
export const isNotNil = <T,>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/**
 * Creates a predicate that checks if a value is null or undefined.
 * @description Type guard function that identifies null and undefined values.
 * Useful for validation, error handling, and conditional logic where
 * null/undefined values need special treatment.
 * 
 * @template T - The type of the value when not null/undefined
 * @param {T | null | undefined} value - The value to check
 * @returns {value is null | undefined} True if the value is null or undefined
 * 
 * @category Type Guards
 * @example
 * // Filtering null/undefined values
 * const values = [1, null, 2, undefined, 3];
 * const nilValues = values.filter(isNil);
 * // => [null, undefined]
 * 
 * @example
 * // Early return pattern
 * function processUser(user: User | null) {
 *   if (isNil(user)) {
 *     return { error: 'User not found' };
 *   }
 *   // Process user...
 * }
 * 
 * @example
 * // Default value handling
 * function getConfig(key: string): string {
 *   const value = configMap.get(key);
 *   if (isNil(value)) {
 *     return getDefaultConfig(key);
 *   }
 *   return value;
 * }
 * 
 * @see isNotNil - Check if value is not null or undefined
 * @see isEmpty - Check if value is empty
 * @since 2025-07-03
 */
export const isNil = <T,>(value: T | null | undefined): value is null | undefined =>
  value === null || value === undefined;

/**
 * Checks if a value is empty (null, undefined, empty string, empty array, or empty object).
 * @description Comprehensive emptiness check that handles multiple data types.
 * Returns true for null, undefined, empty strings, arrays with no elements,
 * and objects with no own properties. Does not consider whitespace-only strings as empty.
 * 
 * @param {unknown} value - The value to check for emptiness
 * @returns {boolean} True if the value is considered empty
 * 
 * @category Value Checks
 * @example
 * // Basic emptiness checks
 * isEmpty(null);           // => true
 * isEmpty(undefined);      // => true
 * isEmpty('');            // => true
 * isEmpty([]);            // => true
 * isEmpty({});            // => true
 * isEmpty('hello');       // => false
 * isEmpty([1, 2, 3]);     // => false
 * isEmpty({ a: 1 });      // => false
 * 
 * @example
 * // Form validation
 * const formData = { name: '', email: 'test@example.com', bio: null };
 * const emptyFields = Object.entries(formData)
 *   .filter(([_, value]) => isEmpty(value))
 *   .map(([key]) => key);
 * // => ['name', 'bio']
 * 
 * @example
 * // API response validation
 * function handleResponse(data: unknown) {
 *   if (isEmpty(data)) {
 *     throw new Error('Empty response received');
 *   }
 *   return processData(data);
 * }
 * 
 * @see isNotEmpty - Check if value has content
 * @see isNil - Check if value is null or undefined
 * @since 2025-07-03
 */
export const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/**
 * Opposite of isEmpty - checks if a value has content.
 * @description Returns true if a value is not empty. A value is considered
 * to have content if it's not null, undefined, an empty string, an empty array,
 * or an empty object.
 * 
 * @param {unknown} value - The value to check for content
 * @returns {boolean} True if the value has content
 * 
 * @category Value Checks
 * @example
 * // Form field validation
 * const requiredFields = ['name', 'email'];
 * const formData = { name: 'John', email: '', phone: '123' };
 * 
 * const filledRequired = requiredFields.every(field => 
 *   isNotEmpty(formData[field as keyof typeof formData])
 * );
 * // => false (email is empty)
 * 
 * @example
 * // Filter out empty values
 * const config = {
 *   apiKey: 'abc123',
 *   endpoint: '',
 *   timeout: 5000,
 *   headers: {}
 * };
 * 
 * const validConfig = Object.fromEntries(
 *   Object.entries(config).filter(([_, value]) => isNotEmpty(value))
 * );
 * // => { apiKey: 'abc123', timeout: 5000 }
 * 
 * @see isEmpty - Check if value is empty
 * @see isNotNil - Check if value is not null or undefined
 * @since 2025-07-03
 */
export const isNotEmpty = (value: unknown): boolean => !isEmpty(value);

/**
 * Creates a predicate that checks if a value equals a specific value.
 * @description Uses strict equality (===) to compare values. Creates a reusable
 * predicate function that can be used for filtering, finding, or validation.
 * 
 * @template T - The type of values being compared
 * @param {T} target - The value to compare against
 * @returns {(value: T) => boolean} A predicate that returns true if the value equals the target
 * 
 * @category Comparison
 * @example
 * // Basic filtering
 * const isJohn = equals('John');
 * ['John', 'Jane', 'John', 'Jack'].filter(isJohn);
 * // => ['John', 'John']
 * 
 * @example
 * // Status checking
 * const isActive = equals('active');
 * const activeUsers = users.filter(user => isActive(user.status));
 * 
 * @example
 * // Finding specific items
 * const isTargetId = equals(targetUserId);
 * const targetUser = users.find(user => isTargetId(user.id));
 * 
 * @see oneOf - Check if value is one of multiple values
 * @since 2025-07-03
 */
export const equals =
  <T,>(target: T) =>
  (value: T): boolean =>
    value === target;

/**
 * Creates a predicate that checks if a value is one of the specified values.
 * @description Uses Array.includes internally to check membership. Useful for
 * creating allowlists, checking against enums, or validating against a set
 * of acceptable values.
 * 
 * @template T - The type of values in the options array
 * @param {T[]} options - Array of acceptable values
 * @returns {(value: T) => boolean} A predicate that returns true if the value is in the options
 * 
 * @category Comparison
 * @example
 * // Day type checking
 * const isWeekend = oneOf(['Saturday', 'Sunday']);
 * isWeekend('Saturday'); // => true
 * isWeekend('Monday');   // => false
 * 
 * @example
 * // Permission checking
 * const canEdit = oneOf(['admin', 'editor', 'author']);
 * const editableContent = content.filter(item => canEdit(item.userRole));
 * 
 * @example
 * // Enum validation
 * enum Status { Active = 'active', Inactive = 'inactive', Pending = 'pending' }
 * const isValidStatus = oneOf(Object.values(Status));
 * 
 * @see equals - Check if value equals a specific value
 * @see includes - Check if array includes a value
 * @since 2025-07-03
 */
export const oneOf =
  <T,>(options: T[]) =>
  (value: T): boolean =>
    options.includes(value);

/**
 * Creates a predicate that checks if a number is within a range (inclusive).
 * @description Both minimum and maximum values are included in the range.
 * Useful for validating numeric values against acceptable bounds.
 * 
 * @param {number} min - The minimum value (inclusive)
 * @param {number} max - The maximum value (inclusive)
 * @returns {(value: number) => boolean} A predicate that returns true if the value is within range
 * 
 * @category Numeric
 * @example
 * // Age validation
 * const isValidAge = inRange(18, 65);
 * isValidAge(17); // => false
 * isValidAge(18); // => true
 * isValidAge(30); // => true
 * isValidAge(65); // => true
 * isValidAge(66); // => false
 * 
 * @example
 * // Score validation
 * const isPassingGrade = inRange(60, 100);
 * const passingStudents = students.filter(s => isPassingGrade(s.score));
 * 
 * @example
 * // Temperature monitoring
 * const isNormalTemp = inRange(36.0, 37.5);
 * const alerts = readings
 *   .filter(not(r => isNormalTemp(r.temperature)))
 *   .map(r => ({ time: r.time, temp: r.temperature }));
 * 
 * @since 2025-07-03
 */
export const inRange =
  (min: number, max: number) =>
  (value: number): boolean =>
    value >= min && value <= max;

/**
 * Creates a predicate that checks if a string matches a regular expression.
 * @description Uses RegExp.test() to check if the pattern matches the string.
 * The regular expression can include flags for case-insensitive matching,
 * multiline mode, etc.
 * 
 * @param {RegExp} pattern - The regular expression to test against
 * @returns {(value: string) => boolean} A predicate that returns true if the string matches
 * 
 * @category String
 * @example
 * // Email validation
 * const isEmail = matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
 * isEmail('test@example.com'); // => true
 * isEmail('invalid-email');    // => false
 * 
 * @example
 * // Phone number validation
 * const isPhoneNumber = matches(/^\+?[\d\s-()]+$/);
 * const validPhones = contacts
 *   .map(c => c.phone)
 *   .filter(isPhoneNumber);
 * 
 * @example
 * // URL validation with flags
 * const isHttpUrl = matches(/^https?:\/\//i);
 * const secureUrls = urls.filter(matches(/^https:\/\//));
 * 
 * @since 2025-07-03
 */
export const matches =
  (pattern: RegExp) =>
  (value: string): boolean =>
    pattern.test(value);

/**
 * Creates a predicate that checks if an object has a specific property.
 * @description Type guard that checks for property existence using the 'in' operator.
 * The returned predicate narrows the type to include the checked property.
 * Works with string, number, and symbol keys.
 * 
 * @template K - The type of the property key
 * @param {K} key - The property key to check for
 * @returns {<T extends object>(obj: T) => obj is T & Record<K, unknown>} A type guard predicate
 * 
 * @category Object
 * @example
 * // Type-safe property filtering
 * const hasEmail = hasProperty('email');
 * const users = [
 *   { name: 'John', email: 'john@example.com' },
 *   { name: 'Jane' }
 * ];
 * const usersWithEmail = users.filter(hasEmail);
 * // => [{ name: 'John', email: 'john@example.com' }]
 * // TypeScript knows these have email property
 * 
 * @example
 * // Feature detection
 * const supportsWebGL = hasProperty('WebGLRenderingContext');
 * if (supportsWebGL(window)) {
 *   // Initialize WebGL...
 * }
 * 
 * @example
 * // Optional property handling
 * interface User {
 *   id: string;
 *   name: string;
 *   avatar?: string;
 * }
 * 
 * const hasAvatar = hasProperty('avatar');
 * const usersWithAvatars = users.filter(hasAvatar);
 * // Now TypeScript knows avatar exists on these users
 * 
 * @since 2025-07-03
 */
export const hasProperty =
  <K extends PropertyKey>(key: K) =>
  <T extends object>(obj: T): obj is T & Record<K, unknown> =>
    key in obj;

/**
 * Creates a predicate that checks if an array includes a specific value.
 * @description Creates a predicate function that tests array membership.
 * Uses Array.includes internally, so it uses SameValueZero equality.
 * 
 * @template T - The type of elements in the array
 * @param {T} target - The value to search for in arrays
 * @returns {(array: T[]) => boolean} A predicate that returns true if the array includes the target
 * 
 * @category Array
 * @example
 * // Language filtering
 * const hasFavorite = includes('JavaScript');
 * const jsDevs = developers.filter(dev => hasFavorite(dev.languages));
 * 
 * @example
 * // Tag filtering
 * const hasUrgentTag = includes('urgent');
 * const urgentTasks = tasks.filter(task => hasUrgentTag(task.tags));
 * 
 * @example
 * // Permission checking
 * const hasAdminPermission = includes('admin');
 * const adminActions = actions.filter(action => 
 *   hasAdminPermission(action.requiredPermissions)
 * );
 * 
 * @see oneOf - Check if value is one of multiple values
 * @since 2025-07-03
 */
export const includes =
  <T,>(target: T) =>
  (array: T[]): boolean =>
    array.includes(target);

/**
 * Creates a predicate that always returns true.
 * @description Useful as a default predicate, for conditional filtering,
 * or as a placeholder during development. The parameter is ignored.
 * 
 * @template T - The type of the ignored parameter
 * @param {T} _ - Value is ignored
 * @returns {boolean} Always returns true
 * 
 * @category Constants
 * @example
 * // Admin bypass for filters
 * const filters = {
 *   status: user.role === 'admin' ? alwaysTrue : equals('published')
 * };
 * 
 * @example
 * // Conditional filtering
 * const nameFilter = searchTerm 
 *   ? (user: User) => user.name.includes(searchTerm)
 *   : alwaysTrue;
 * 
 * @example
 * // Feature toggle
 * const canAccessFeature = FEATURE_ENABLED ? hasPermission('feature') : alwaysTrue;
 * 
 * @see alwaysFalse - Predicate that always returns false
 * @since 2025-07-03
 */
 
export const alwaysTrue = <T,>(_: T): boolean => true;

/**
 * Creates a predicate that always returns false.
 * @description Useful for disabling features, creating empty filter results,
 * or as a placeholder during development. The parameter is ignored.
 * 
 * @template T - The type of the ignored parameter
 * @param {T} _ - Value is ignored
 * @returns {boolean} Always returns false
 * 
 * @category Constants
 * @example
 * // Conditional record display
 * const filters = {
 *   deleted: showDeleted ? alwaysTrue : alwaysFalse
 * };
 * 
 * @example
 * // Feature flags
 * const canAccessBeta = BETA_ENABLED ? hasRole('beta') : alwaysFalse;
 * 
 * @example
 * // Maintenance mode
 * const canPerformAction = MAINTENANCE_MODE ? alwaysFalse : hasPermission('action');
 * 
 * @see alwaysTrue - Predicate that always returns true
 * @since 2025-07-03
 */
 
export const alwaysFalse = <T,>(_: T): boolean => false;

/**
 * Higher-order predicate utilities for complex compositions.
 * @description Advanced utilities for creating and transforming predicates.
 * These functions provide powerful patterns for building complex predicates
 * from simpler ones.
 * 
 * @category Advanced
 * @since 2025-07-03
 */
export const predicateUtils = {
  /**
   * Creates a predicate based on a property value.
   * @description Checks if an object's property equals a specific value.
   * Uses strict equality (===) for comparison.
   * 
   * @template T - The type of the object
   * @template K - The type of the property key
   * @param {K} key - The property key to check
   * @param {T[K]} value - The value to compare against
   * @returns {(obj: T) => boolean} A predicate that checks the property value
   * 
   * @example
   * // Role-based filtering
   * const isAdminRole = predicateUtils.propEquals('role', 'admin');
   * const admins = users.filter(isAdminRole);
   * 
   * @example
   * // Status checking
   * const isPublished = predicateUtils.propEquals('status', 'published');
   * const publishedPosts = posts.filter(isPublished);
   * 
   * @since 2025-07-03
   */
  propEquals: <T, K extends keyof T>(key: K, value: T[K]) =>
    (obj: T): boolean =>
      obj[key] === value,

  /**
   * Creates a predicate that checks multiple properties.
   * @description Checks if an object matches all properties in a partial object.
   * Only checks properties that exist in the partial object.
   * 
   * @template T - The type of the object being checked
   * @param {Partial<T>} partial - Object with properties to match
   * @returns {(obj: T) => boolean} A predicate that checks all properties match
   * 
   * @example
   * // Finding specific users
   * const isJohnDoe = predicateUtils.propsMatch({
   *   firstName: 'John',
   *   lastName: 'Doe'
   * });
   * 
   * const johnDoe = users.find(isJohnDoe);
   * 
   * @example
   * // Filtering by multiple criteria
   * const isTargetProduct = predicateUtils.propsMatch({
   *   category: 'electronics',
   *   inStock: true,
   *   featured: true
   * });
   * 
   * const featuredElectronics = products.filter(isTargetProduct);
   * 
   * @since 2025-07-03
   */
  propsMatch: <T extends object>(partial: Partial<T>) =>
    (obj: T): boolean =>
      Object.entries(partial).every(([key, value]) => obj[key as keyof T] === value),

  /**
   * Creates a predicate that applies a transformation before testing.
   * @description Contramap allows you to adapt a predicate for one type to work
   * with another type by providing a transformation function. This is the
   * contravariant functor operation for predicates.
   * 
   * @template A - The input type
   * @template B - The type the predicate expects
   * @param {(a: A) => B} transform - Function to transform A to B
   * @param {(b: B) => boolean} predicate - Predicate that operates on type B
   * @returns {(value: A) => boolean} A predicate that operates on type A
   * 
   * @example
   * // Extract property before testing
   * const hasLongName = predicateUtils.contramap(
   *   (user: { name: string }) => user.name,
   *   (name: string) => name.length > 10
   * );
   * 
   * @example
   * // Case-insensitive comparison
   * const isCaseInsensitiveMatch = (target: string) =>
   *   predicateUtils.contramap(
   *     (s: string) => s.toLowerCase(),
   *     equals(target.toLowerCase())
   *   );
   * 
   * @example
   * // Date comparison
   * const isAfter2020 = predicateUtils.contramap(
   *   (date: Date) => date.getFullYear(),
   *   (year: number) => year > 2020
   * );
   * 
   * @since 2025-07-03
   */
  contramap: <A, B>(transform: (a: A) => B, predicate: (b: B) => boolean) =>
    (value: A): boolean =>
      predicate(transform(value)),
};
