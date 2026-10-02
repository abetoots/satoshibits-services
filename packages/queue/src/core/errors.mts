/**
 * Custom Error Classes for Queue Jobs
 *
 * These error classes provide explicit, type-safe error classification
 * for job handlers. They enable the error classification system to
 * determine which errors should trigger retries and which should not.
 *
 * @example
 * ```typescript
 * import { PermanentJobError } from "@satoshibits/queue";
 *
 * if (!campaign) {
 *   throw new PermanentJobError("Campaign not found");
 * }
 * ```
 */

/**
 * An error that indicates a job should not be retried.
 *
 * Throw this when an error occurs that cannot be resolved by retrying:
 * - Resource not found (404)
 * - Invalid input data (validation errors)
 * - Missing required configuration
 * - Business rule violations (e.g. email already sent)
 *
 * The worker reports it on the `failed` event with `permanent: true` and
 * `willRetry: false`, and the provider fails the job without retrying it.
 *
 * An error carrying `retryable: false` is permanent too: see
 * {@link isPermanentError}.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * An error that indicates a job should be retried.
 *
 * This is optional — any error that is not permanent (see
 * {@link isPermanentError}) is treated as transient by default. Use this
 * class when you want to be explicit about retry behavior.
 */
export class TransientJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientJobError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * What a handler failed with can be any value: an object with throwing
 * getters, no prototype, or a Proxy. Everything below reads such a value
 * without ever throwing, so that inspecting a failure can never replace it,
 * suppress the `failed` event, or leave a job without a recorded failure.
 */

// the message for a failure that has none that can be read
const UNREADABLE_ERROR_MESSAGE = "Unknown error (no readable message)";

// the longest JSON description of a failure used as its message
const MAX_DESCRIBED_LENGTH = 500;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Read one property; `undefined` when the read throws (getter, Proxy trap).
 */
function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * `instanceof Error`, answering `false` when the check itself throws (a Proxy
 * with a `getPrototypeOf` trap, a revoked Proxy).
 */
export function isErrorInstance(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function isPermanentJobError(value: unknown): boolean {
  try {
    return value instanceof PermanentJobError;
  } catch {
    return false;
  }
}

/**
 * The permanence rule: whether a failed job must not be retried.
 *
 * An error is permanent when it is a `PermanentJobError`, or when it carries
 * `retryable === false`: an `Error` instance with that property, or a plain
 * structured object such as a `QueueError`. Only the boolean `false` counts.
 *
 * This is the one definition of the rule. The worker uses it for the `failed`
 * event (`permanent`, `willRetry`) and the memory and BullMQ providers use it
 * to decide the retry, each reading the flag from the value it is given. SQS
 * does not apply it: it retries by its redrive policy.
 *
 * Accepts any value and never throws: a flag that cannot be read is not
 * `false`, so such an error is not permanent.
 */
export function isPermanentError(error: unknown): boolean {
  if (isPermanentJobError(error)) {
    return true;
  }

  return isObject(error) && readProperty(error, "retryable") === false;
}

/**
 * A readable description of an object that has no string `message`: its JSON
 * (capped), or a fixed message when it has none worth showing.
 */
function describeObject(value: object): string {
  try {
    const json: unknown = JSON.stringify(value);
    if (typeof json === "string" && json !== "{}") {
      return json.length > MAX_DESCRIBED_LENGTH
        ? `${json.slice(0, MAX_DESCRIBED_LENGTH)}…`
        : json;
    }
  } catch {
    // circular, a throwing getter or toJSON, a Proxy trap
  }

  return UNREADABLE_ERROR_MESSAGE;
}

/**
 * A readable message for whatever a handler failed with. Never throws.
 *
 * - the `message` of an `Error` or of a plain structured object, when it is a
 *   string
 * - for any other object, its JSON, or a fixed message when it has none
 * - for a primitive, the value converted to a string
 */
export function getErrorMessage(error: unknown): string {
  if (isObject(error)) {
    const message = readProperty(error, "message");
    return typeof message === "string" ? message : describeObject(error);
  }

  try {
    return String(error);
  } catch {
    return UNREADABLE_ERROR_MESSAGE;
  }
}

/**
 * The `name` of an `Error` instance, for the `failed` event's `errorType`.
 * `"Error"` for anything else, or when the name cannot be read. Never throws.
 */
export function getErrorName(error: unknown): string {
  if (!isErrorInstance(error)) {
    return "Error";
  }

  const name = readProperty(error, "name");
  return typeof name === "string" && name !== "" ? name : "Error";
}

/**
 * Whether BullMQ, or any code that reads `message` and `stack` off an error,
 * can use this value as is: a real `Error` whose `message` and `stack` can be
 * read. Never throws.
 */
export function isReadableError(value: unknown): value is Error {
  if (!isErrorInstance(value)) {
    return false;
  }

  try {
    void value.stack;
    return typeof value.message === "string";
  } catch {
    return false;
  }
}
