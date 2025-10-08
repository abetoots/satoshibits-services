/**
 * IQueueProvider - Queue-Scoped Provider Interface
 *
 * This interface represents a queue-specific provider instance.
 * Each provider instance is bound to a single queue and provides
 * queue operations without needing to pass the queue name.
 *
 * This interface supports two processing models:
 *
 * **Push Model** (Efficient - for providers like BullMQ):
 * Provider implements `process()` method and manages job fetching internally
 * using native blocking mechanisms (e.g., Redis BRPOPLPUSH).
 *
 * **Pull Model** (Simple - for basic providers like Memory):
 * Provider implements `fetch()`, `ack()`, `nack()` methods.
 * Worker class manages fetch loop and calls these primitives.
 *
 * Providers MUST implement either push OR pull methods (or both).
 */

import type {
  Job,
  ActiveJob,
  JobOptions,
  ProviderCapabilities,
  QueueError,
  QueueStats,
  HealthStatus,
} from "../core/types.mjs";
import type { Result } from "@satoshibits/functional";

/**
 * Queue-scoped provider interface - all operations are for the bound queue
 */
export interface IQueueProvider {
  // ========================================
  // Core Job Operations (All Providers)
  // ========================================

  /**
   * Add a job to this queue
   * @param job Job persistent state to add
   * @param options Optional job creation options (for provider-specific options, removeOnComplete, removeOnFail)
   * @returns Result with added job or error
   */
  add<T>(job: Job<T>, options?: JobOptions): Promise<Result<Job<T>, QueueError>>;

  /**
   * Get a specific job by ID from this queue
   * @param jobId Job ID to retrieve
   * @returns Result with job (null if not found) or error
   */
  getJob<T>(jobId: string): Promise<Result<Job<T> | null, QueueError>>;

  // ========================================
  // Push Model (Optional - for efficient providers)
  // ========================================

  /**
   * Register a job processor (push model)
   * Provider fetches jobs and calls handler using native mechanisms.
   *
   * Handler receives ActiveJob with runtime metadata (receiptHandle, lockToken, etc.)
   *
   * @param handler Function to process each job
   * @param options Processing options (concurrency, error callback, etc.)
   * @returns Shutdown function to stop processing
   */
  process?<T>(
    handler: (job: ActiveJob<T>) => Promise<void>,
    options: {
      concurrency?: number;
      onError?: (error: QueueError) => void;
    },
  ): () => Promise<void>;

  // ========================================
  // Pull Model (Optional - for simple providers)
  // ========================================

  /**
   * Fetch jobs for processing (pull model)
   * Worker manages fetch loop and concurrency.
   *
   * Returns ActiveJob with runtime metadata (receiptHandle for SQS, lockToken, etc.)
   * needed for subsequent ack/nack operations.
   *
   * @param batchSize Number of jobs to fetch
   * @param waitTimeMs Optional long-polling wait time in milliseconds
   * @returns Result with array of ActiveJobs or error
   */
  fetch?<T>(
    batchSize: number,
    waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>>;

  /**
   * Acknowledge successful job completion (pull model)
   * Provider updates job state, handles removal, etc.
   *
   * @param job ActiveJob with runtime metadata (receiptHandle, lockToken, etc.)
   * @param result Optional result data
   * @returns Result indicating success or error
   */
  ack?<T>(job: ActiveJob<T>, result?: unknown): Promise<Result<void, QueueError>>;

  /**
   * Negative acknowledge - job failed (pull model)
   * Provider handles retry logic, DLQ movement, etc.
   *
   * @param job ActiveJob with runtime metadata (receiptHandle, lockToken, etc.)
   * @param error Error that occurred
   * @returns Result indicating success or error
   */
  nack?<T>(job: ActiveJob<T>, error: Error): Promise<Result<void, QueueError>>;

  // ========================================
  // Queue Management (All Providers)
  // ========================================

  /**
   * Pause job processing for this queue
   */
  pause(): Promise<Result<void, QueueError>>;

  /**
   * Resume job processing for this queue
   */
  resume(): Promise<Result<void, QueueError>>;

  /**
   * Delete this queue and all its jobs
   */
  delete(): Promise<Result<void, QueueError>>;

  /**
   * Get statistics for this queue
   */
  getStats(): Promise<Result<QueueStats, QueueError>>;

  /**
   * Get health status for monitoring
   */
  getHealth(): Promise<Result<HealthStatus, QueueError>>;

  // ========================================
  // Dead Letter Queue Operations (Optional - if supportsDLQ)
  // ========================================

  /**
   * Get jobs from dead letter queue
   * @param limit Maximum number of jobs to retrieve (default: 100)
   */
  getDLQJobs?<T>(limit?: number): Promise<Result<Job<T>[], QueueError>>;

  /**
   * Retry a failed job from DLQ
   * Moves job back to main queue for reprocessing
   * @param jobId Job ID to retry
   */
  retryJob?(jobId: string): Promise<Result<void, QueueError>>;

  // ========================================
  // Lifecycle (All Providers)
  // ========================================

  /**
   * Connect to backend (if needed)
   */
  connect(): Promise<void>;

  /**
   * Gracefully disconnect from backend
   */
  disconnect(): Promise<void>;

  // ========================================
  // Capabilities Declaration (All Providers)
  // ========================================

  /**
   * Declare what features this provider supports
   * Used for warn-and-degrade behavior
   */
  readonly capabilities: ProviderCapabilities;
}

/**
 * Base provider factory interface
 * Providers that support multiple queues should implement this to create
 * queue-scoped provider instances
 */
export interface IProviderFactory {
  /**
   * Create a queue-scoped provider instance
   * @param queueName Name of the queue to bind to
   * @returns Queue-scoped provider instance
   */
  forQueue(queueName: string): IQueueProvider;
}
