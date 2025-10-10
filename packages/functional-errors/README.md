# @satoshibits/functional-errors

<!-- Badges: npm version, build status, license, etc. -->

> Type-safe error handling with the Result pattern + battle-tested resilience.

Tired of `try/catch` chaos and inconsistent error objects? This library provides a standard taxonomy of error types and powerful, `Result`-aware resilience patterns (retry, circuit breaker) so you can handle failures predictably and safely.

-   **Standard Error Taxonomy:** 7 battle-tested error types for clear, predictable failure modes.
-   **Type-Safe Handling:** Use TypeScript's discriminated unions to handle errors with confidence.
-   **Resilient Operations:** Built-in `retry` and `circuit breaker` that are `Result`-aware.
-   **No Exceptions:** Embrace functional error handling with the `Result` type.

## When to Use / When NOT to Use

### ✅ Use this library when...

-   You need a standardized way to classify errors across services.
-   You want to make error handling explicit and type-safe using `Result`.
-   You need `Result`-aware resilience patterns like retry or circuit breakers.

### ❌ Consider other libraries when...

-   You **only** need resilience patterns → use [cockatiel](https://github.com/connor4312/cockatiel) directly.
-   You want a comprehensive functional programming ecosystem → use [fp-ts](https://gcanti.github.io/fp-ts/) or [effect](https://effect.website/).

## Installation

```bash
npm install @satoshibits/functional-errors @satoshibits/functional
# or
pnpm add @satoshibits/functional-errors @satoshibits/functional
```

## A Guided Tour: The Core Ideas

### Part 1: From `throw` to `Result`

**The Problem:** Throwing exceptions breaks type safety and hides potential failures from your function's signature. Callers have to guess which errors to catch.

**The Solution:** Use `Result<T, E>` to make failure an explicit, type-safe return value. The `tryCatch` utility makes this easy.

Consider parsing a JSON string, which can easily throw an error:

**Before:** Unsafe, throws an exception.

```typescript
function parseConfig(json: string): Config {
  // This will throw if the JSON is invalid!
  return JSON.parse(json);
}
```

**After:** Type-safe, returns a `Result`.

```typescript
import { Result, tryCatchSync, createValidationError } from '@satoshibits/functional-errors';

function parseConfig(json: string): Result<Config, ValidationError> {
  return tryCatchSync(
    () => JSON.parse(json),
    (error) => createValidationError('Invalid JSON configuration', { cause: error })
  );
}

const result = parseConfig('{ "invalid json" }');

if (!result.success) {
  // result.error is strongly typed as ValidationError
  console.error(result.error.message);
}
```

### Part 2: What Kind of Error Is It? The Error Taxonomy

**The Problem:** A generic `Error` doesn't tell you *how* to handle it. Should you retry? Alert an admin? Show a message to the user?

**The Solution:** Use specific error types to communicate intent. This library provides 7 distinct types. Use this decision tree to choose the right one:

-   **Is the error due to invalid user input or malformed data?**
    -   ➡️ Use `ValidationError`. The operation can succeed if the input is corrected.
-   **Is it a runtime failure with an external service (e.g., API down, DB connection failed)?**
    -   ➡️ Use `OperationalError`. These are often temporary, so you might want to retry.
-   **Is it a critical system failure that requires immediate developer intervention (e.g., out of memory, disk full)?**
    -   ➡️ Use `CriticalError`. The system is in an unstable state and likely cannot recover on its own.
-   **Is it a startup/environment problem (e.g., missing env var, bad credentials)?**
    -   ➡️ Use `ConfigurationError`. The application cannot run correctly until the configuration is fixed.
-   **Did an operation take too long to complete?**
    -   ➡️ Use `TimeoutError`.
-   **Did all retry attempts fail?**
    -   ➡️ The `retry` utility returns a `RetryError` automatically.
-   **Is a circuit breaker preventing an operation?**
    -   ➡️ The `createCircuitBreaker` utility returns a `CircuitBreakerError` automatically.

### Part 3: Handling Transient Failures with `retry`

**The Problem:** Network requests and other I/O can fail temporarily due to transient issues. Retrying a few times can often resolve the problem.

**The Solution:** Wrap the fallible operation in `retry`. It automatically handles exponential backoff and jitter.

```typescript
import { retry, tryCatch, createOperationalError } from '@satoshibits/functional-errors';
import axios from 'axios';

// This function now returns a Result instead of throwing
async function getExternalData(id: string) {
  return tryCatch(
    () => axios.get(`https://api.example.com/data/${id}`),
    (error) => createOperationalError('API call failed', true, { cause: error }) // true = retryable
  );
}

// Retry the operation up to 3 times with backoff
const result = await retry(() => getExternalData('123'), { maxAttempts: 3 });

if (!result.success) {
  // This could be a RetryError if all attempts failed,
  // or a non-retryable OperationalError.
  console.error('Failed to get data after multiple attempts:', result.error);
}
```

### Part 4: Preventing Cascading Failures with `createCircuitBreaker`

**The Problem:** Repeatedly calling a failing downstream service can exhaust resources and cause system-wide outages.

**The Solution:** Use a circuit breaker to "trip a fuse" and stop making calls to an unhealthy service for a period of time, allowing it to recover.

```typescript
import { createCircuitBreaker, isCircuitBreakerError } from '@satoshibits/functional-errors';

// Assume getExternalData is the same function from the retry example
const protectedGetData = createCircuitBreaker(
  () => getExternalData('123'),
  {
    failureThreshold: 5,     // Open after 5 consecutive failures
    openDurationMs: 30000,   // Stay open for 30 seconds
  }
);

// Call the protected function
const result = await protectedGetData();

if (!result.success && isCircuitBreakerError(result.error)) {
  // The circuit is open; the request was not even attempted.
  console.log(`Circuit is ${result.error.state}. Not calling the API.`);
}
```

## Recipes: Common Scenarios

### How do I handle all error types cleanly?

Use `handleErrorType` for an elegant, exhaustive, and type-safe alternative to `if/else` or `switch` statements.

```typescript
import { handleErrorType } from '@satoshibits/functional-errors';

const result = await someOperation();

if (!result.success) {
  handleErrorType(result.error, {
    operational: (err) => {
      if (err.retryable) {
        console.log('Should retry this operation.');
      } else {
        console.log('Operational failure, but not retryable.');
      }
    },
    validation: (err) => {
      console.log('Validation failed:', err.fields);
      // Show error messages to the user
    },
    critical: (err) => {
      console.error('Critical failure! Alerting on-call.', err);
      // alertOnCall(err);
    },
    default: (err) => {
      // A fallback for any unhandled error types
      console.error('An unexpected error occurred:', err);
    },
  });
}
```

### How do I recover from certain errors?

Use `recoverWithDefault` to provide a fallback value when a specific type of error occurs.

```typescript
import { Result, recoverWithDefault, isOperationalError } from '@satoshibits/functional-errors';

interface Avatar { url: string; }
const defaultAvatar: Avatar = { url: '/default-avatar.png' };

async function getAvatar(userId: string): Promise<Result<Avatar, ErrorType>> {
  // ... might return an OperationalError if the service is down
}

const result = await getAvatar('user-123');

// If the result is an OperationalError, use the default. Otherwise, pass through.
const recoveredResult = recoverWithDefault(defaultAvatar, isOperationalError)(result);

if (recoveredResult.success) {
  console.log(recoveredResult.data.url); // -> '/default-avatar.png' if the call failed
}
```

### How do I format errors for logging?

Use `toLoggableFormat` to convert any `ErrorType` into a clean, structured JSON object suitable for logging services.

```typescript
import { toLoggableFormat } from '@satoshibits/functional-errors';

const result = await someOperation();

if (!result.success) {
  const loggableError = toLoggableFormat(result.error);
  // loggableError is a plain object with tag, message, context, cause, etc.
  console.log(JSON.stringify(loggableError, null, 2));
}
```

## API Reference

### Core Types

-   `Result<T, E>`: A container for a successful (`Ok`) or failed (`Err`) operation.
-   `ErrorType`: A union of all 7 error types defined in this library.

### Error Constructors

-   `createConfigurationError(message, context?)`
-   `createOperationalError(message, retryable, context?)`
-   `createCriticalError(message, cause?, context?)`
-   `createValidationError(message, fields?, context?)`
-   `createRetryError(attempts, lastError, context?)`
-   `createCircuitBreakerError(state, nextAttempt?, context?)`
-   `createTimeoutError(operationName, timeoutMs, context?)`

### Type Guards

-   `isConfigurationError(error)`
-   `isOperationalError(error)`
-   `isCriticalError(error)`
-   `isValidationError(error)`
-   `isRetryError(error)`
-   `isCircuitBreakerError(error)`
-   `isTimeoutError(error)`
-   `isRetryable(error)`: Checks if `error.retryable === true`.
-   `isRecoverable(error)`: Checks if `error.recoverable === true`.

### Resilience

-   `retry(fn, config?)`: Retries an async function that returns a `Result`.
-   `retrySync(fn, config?)`: Retries a sync function that returns a `Result`.
-   `createRetry(fn, config?)`: Creates a reusable retry-wrapped function.
-   `createCircuitBreaker(fn, config?)`: Wraps a function with a circuit breaker.
-   `CircuitBreakerManual`: A class for manual control over a circuit breaker's state.

### Result Utilities

-   `tryCatch(fn, errorMapper)`: Converts a `Promise`-based function that can throw into one that returns a `Result`.
-   `tryCatchSync(fn, errorMapper)`: Converts a synchronous function that can throw into one that returns a `Result`.

### Error Handlers

-   `handleErrorType(error, handlers)`: Executes a handler based on the error's `tag`.
-   `recoverWithDefault(defaultValue, predicate?)`: Replaces an error with a default value.
-   `recoverWith(strategies)`: Chains multiple recovery functions.
-   `toLoggableFormat(error)`: Converts an error into a plain JSON object for logging.
-   `mapError(transformer)`: Transforms the error inside a `Result`.
-   `withContext(context)`: Creates a function to add context to an error.

## Design Philosophy

This library is intentionally focused.

1.  **Error Taxonomy is the Core Value:** Providing a clear, standard set of error types is the primary goal.
2.  **Resilience via Cockatiel:** We don't reinvent the wheel. Resilience patterns are thin, `Result`-aware wrappers around the excellent [cockatiel](https://github.com/connor4312/cockatiel) library.
3.  **Composability:** All functions are pure and designed to be composed, working seamlessly with `@satoshibits/functional`.

## Migration from v1.x

<details>
<summary>Click to expand Migration Guide from v1.x</summary>

v2.0.0 is a clean break from v1.x. Key changes:

**Removed:**

-   `RateLimitError` and `AuthenticationError` (too specific, use `OperationalError` with context instead)
-   `categorizeError()` (naive pattern matching, users should be explicit)
-   `errorToJSON/errorFromJSON` (userland concern, replaced by `toLoggableFormat`)
-   `filterError`, `aggregateResults` (trivial utilities)
-   `ValidationAccumulator` and related functions (out of scope; use a simple array and `reduce` instead)
-   `LRUCache` (out of scope, use [lru-cache](https://www.npmjs.com/package/lru-cache))
-   Custom retry/circuit breaker implementations (replaced with cockatiel wrappers)

**Changed:**

-   Retry and circuit breaker are now powered by [cockatiel](https://github.com/connor4312/cockatiel). The API is similar but not identical.
-   Removed `Object.freeze()` overhead from error constructors for better performance.
-   Removed runtime validation from constructors (rely on TypeScript).

</details>

## License

ISC
