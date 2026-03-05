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
 * The job handler wrapper will catch this error, log it, and return
 * successfully to prevent the queue provider from retrying the job.
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
 * This is optional — any error that is NOT a PermanentJobError
 * will be treated as transient by default. Use this class when
 * you want to be explicit about retry behavior.
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
