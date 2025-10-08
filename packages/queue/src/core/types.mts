/**
 * Core types for the lean queue abstraction layer.
 * Backend-agnostic types following "thin adapter" principles.
 */

import type { Result } from "@satoshibits/functional";

/**
 * Structured error types using discriminated unions
 * All errors have required `code` for consistent error handling and observability
 */
export type QueueError =
  | {
      type: "ConfigurationError";
      code: "INVALID_CONFIG" | "UNSUPPORTED_FEATURE" | "PROVIDER_ERROR";
      message: string;
      retryable: false;
      details?: unknown;
    }
  | {
      type: "RuntimeError";
      code:
        | "CONNECTION"
        | "TIMEOUT"
        | "ENQUEUE"
        | "PROCESSING"
        | "SHUTDOWN"
        | "RATE_LIMIT"
        | "NOT_IMPLEMENTED"
        | "THROTTLING"
        | "PROVIDER_ERROR";
      message: string;
      retryable: boolean;
      queueName?: string;
      jobId?: string;
      cause?: unknown;
    }
  | {
      type: "DataError";
      code: "SERIALIZATION" | "VALIDATION" | "DUPLICATE";
      message: string;
      retryable: false;
      queueName?: string;
      jobId?: string;
      data?: unknown;
    }
  | {
      type: "NotFoundError";
      code: "JOB_NOT_FOUND" | "QUEUE_NOT_FOUND";
      message: string;
      retryable: false;
      resourceId: string;
      resourceType: "job" | "queue";
      queueName?: string;
    };

/**
 * Job status representing lifecycle
 */
export type JobStatus =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed";

/**
 * Job - Persistent state only
 *
 * Represents the core job data that gets stored and persisted.
 * This is the data that survives across job lifecycle phases.
 *
 * For jobs during processing (with runtime metadata), see ActiveJob<T>.
 * For job creation options, see JobOptions.
 */
export interface Job<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly queueName: string;
  readonly data: T;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly processedAt?: Date;
  readonly completedAt?: Date;
  readonly failedAt?: Date;
  readonly scheduledFor?: Date;
  readonly error?: string;
  readonly priority?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * ActiveJob - Job with runtime metadata
 *
 * Extends Job with provider-specific runtime metadata needed during processing.
 * This is the type that job handlers receive.
 *
 * Runtime metadata includes:
 * - receiptHandle (SQS): Needed to acknowledge message
 * - lockToken (other providers): Needed to release locks
 * - Other provider-specific data required for ack/nack operations
 *
 * This data is NOT persisted - it only exists during active job processing.
 */
export interface ActiveJob<T = unknown> extends Job<T> {
  readonly providerMetadata?: {
    readonly receiptHandle?: string;
    readonly lockToken?: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Options for job creation
 */
export interface JobOptions {
  readonly priority?: number;
  readonly delay?: number;
  readonly attempts?: number;
  readonly removeOnComplete?: boolean;
  readonly removeOnFail?: boolean;
  readonly jobId?: string;
  readonly metadata?: Record<string, unknown>;
  /**
   * Provider-specific options (escape hatch)
   * Allows access to full provider feature set beyond normalized options
   *
   * Example:
   * ```typescript
   * providerOptions: {
   *   bullmq: { stackTraceLimit: 0, lifo: true },
   *   sqs: { MessageGroupId: 'group1' }
   * }
   * ```
   */
  readonly providerOptions?: {
    readonly bullmq?: Record<string, unknown>;
    readonly sqs?: Record<string, unknown>;
    readonly rabbitmq?: Record<string, unknown>;
    readonly [provider: string]: Record<string, unknown> | undefined;
  };
}

/**
 * Default job options for Queue configuration
 *
 * Defines the policy for job creation. Users must explicitly choose:
 * - Retry policy (attempts)
 * - ID generation strategy (jobId factory)
 *
 * @example
 * ```typescript
 * import { uuidId } from './job-id-generators.mjs';
 *
 * const defaultJobOptions = {
 *   attempts: 3, // retry up to 3 times
 *   jobId: uuidId, // use crypto.randomUUID() for distributed systems
 * };
 * ```
 */
export interface DefaultJobOptions {
  /**
   * Default number of retry attempts
   *
   * Different job types have different criticality:
   * - Critical jobs (payments): 5+ attempts
   * - Standard jobs (emails): 3 attempts
   * - Idempotent operations: 0 attempts (no retry)
   */
  readonly attempts: number;

  /**
   * Job ID generation strategy
   *
   * Factory function that generates unique job IDs.
   * Defaults to uuidId (crypto.randomUUID()) for zero-config setup.
   *
   * Provide your own if you need specific ID patterns:
   * @example
   * ```typescript
   * import { nanoid } from 'nanoid';
   * const queue = new Queue('emails', {
   *   defaultJobOptions: { jobId: () => nanoid() }
   * });
   * ```
   */
  readonly jobId: () => string;
}

/**
 * Options for Queue configuration
 */
export interface QueueOptions {
  readonly defaultJobOptions: DefaultJobOptions;
  readonly onUnsupportedFeature: (message: string) => void;
}

/**
 * Options for worker configuration
 *
 * Polling and backoff intervals are operational policies that vary by deployment context:
 * - Development: Longer intervals (500ms+) for easier debugging
 * - Production: Shorter intervals (100ms) for responsiveness
 * - Rate-limited APIs: Custom intervals matching quota limits
 *
 * @example
 * ```typescript
 * const worker = new Worker('emails', handler, {
 *   concurrency: 10,
 *   batchSize: 5,
 *   pollInterval: 100,    // poll every 100ms when queue is empty
 *   errorBackoff: 1000,   // wait 1s after errors before retrying
 * });
 * ```
 */
export interface WorkerOptions {
  readonly concurrency?: number;
  readonly batchSize?: number;
  /**
   * Polling interval in milliseconds for pull-based providers.
   * How often to check for new jobs when queue is empty.
   *
   * Choose based on your latency requirements:
   * - Real-time (50-100ms): High responsiveness, higher CPU usage
   * - Standard (100-500ms): Balanced approach
   * - Batch processing (1000ms+): Lower overhead, higher latency
   */
  readonly pollInterval: number;
  /**
   * Backoff time in milliseconds after errors.
   * How long to wait before retrying after a fetch/processing error.
   *
   * Choose based on your error characteristics:
   * - Transient errors (1000ms): Quick recovery
   * - Rate limiting (5000ms+): Respect API limits
   * - Service degradation (10000ms+): Reduce load during incidents
   */
  readonly errorBackoff: number;
}

/**
 * Job handler function - processes job data
 *
 * Receives ActiveJob<T> which includes both persistent state and runtime metadata.
 * Runtime metadata (receiptHandle, lockToken, etc.) may be needed for some use cases.
 *
 * Returns Result for explicit error handling.
 *
 * @param data - The job's data payload
 * @param job - ActiveJob with persistent state + runtime metadata
 */
export type JobHandler<T> = (
  data: T,
  job: ActiveJob<T>,
) => Promise<Result<void, QueueError | Error>>;

/**
 * Queue statistics for monitoring
 */
export interface QueueStats {
  readonly queueName: string;
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  readonly paused: boolean;
}

/**
 * Provider capabilities declaration
 */
export interface ProviderCapabilities {
  readonly supportsDelayedJobs: boolean;
  readonly supportsPriority: boolean;
  readonly supportsRetries: boolean;
  readonly supportsDLQ: boolean;
  readonly supportsBatching: boolean;
  readonly supportsLongPolling: boolean;
  readonly maxJobSize: number; // bytes, 0 = unlimited
  readonly maxBatchSize: number; // max jobs per fetch, 0 = unlimited
  readonly maxDelaySeconds: number; // max delay in seconds, 0 = unlimited
}

/**
 * Health status for monitoring
 *
 * Returns raw metrics only - userland determines health thresholds.
 * Different applications have different SLAs and health criteria:
 * - Mission-critical: may require errorRate < 5%
 * - Batch processing: may tolerate errorRate > 80%
 * - Real-time: may need queueDepth < 10
 *
 * @example
 * ```typescript
 * const health = await queue.getHealth();
 * if (health.success) {
 *   const isHealthy = !health.data.isPaused &&
 *                     health.data.errorRate < myAppThreshold &&
 *                     health.data.queueDepth < myCapacityLimit;
 *   if (!isHealthy) alerts.send('Queue unhealthy', health.data);
 * }
 * ```
 */
export interface HealthStatus {
  readonly activeWorkers: number;
  readonly queueDepth: number;
  readonly errorRate: number; // error rate as percentage
  readonly completedCount: number;
  readonly failedCount: number;
  readonly isPaused: boolean;
}
