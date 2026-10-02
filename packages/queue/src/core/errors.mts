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
 * The permanence rule: whether a failed job must not be retried.
 *
 * An error is permanent when it is a `PermanentJobError`, or when it carries
 * `retryable === false`: an `Error` instance with that property, or a plain
 * structured object such as a `QueueError`. Only the boolean `false` counts.
 *
 * This is the one definition of the rule. The worker uses it for the `failed`
 * event (`permanent`, `willRetry`) and the memory and BullMQ providers use it
 * to decide the retry, so the event and the provider cannot disagree. SQS
 * does not apply it: it retries by its redrive policy.
 *
 * Accepts any value, since a handler can throw anything.
 */
export function isPermanentError(error: unknown): boolean {
  if (error instanceof PermanentJobError) {
    return true;
  }

  return (
    typeof error === "object" &&
    error !== null &&
    (error as { retryable?: unknown }).retryable === false
  );
}

/**
 * A readable message for whatever a handler failed with.
 *
 * The `message` of an `Error` or of a plain structured object when it is a
 * string, otherwise the value converted to a string.
 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return String(error);
}
