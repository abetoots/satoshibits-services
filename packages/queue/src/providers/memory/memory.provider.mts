/**
 * MemoryProvider - Pull Model Implementation
 *
 * Implements the pull-based primitives (fetch, ack, nack)
 * for in-memory queue storage. No orchestration logic - just storage primitives.
 *
 * This provider supports multiple queues and provides a factory method
 * to create queue-scoped provider instances.
 */

import { Result } from "@satoshibits/functional";

import type {
  ActiveJob,
  HealthStatus,
  Job,
  JobOptions,
  ProviderCapabilities,
  QueueError,
  QueueStats,
} from "../../core/types.mjs";
import type {
  IProviderFactory,
  IQueueProvider,
} from "../provider.interface.mjs";

import { QueueErrorFactory } from "../../core/utils.mjs";

/**
 * In-memory storage structure for a queue
 */
interface MemoryQueue<T = unknown> {
  name: string;
  jobs: Map<string, Job<T>>;
  isPaused: boolean;
  completedCount: number;
  failedCount: number;
}

/**
 * MemoryProvider - Multi-queue in-memory provider
 * Implements IProviderFactory to create queue-scoped instances
 */
export class MemoryProvider implements IProviderFactory {
  private queues = new Map<string, MemoryQueue>();
  private timers = new Map<string, NodeJS.Timeout>();
  private fetchLocks = new Set<string>();
  private jobOptions = new Map<string, JobOptions>(); // store job options by "queueName:jobId"

  readonly capabilities: ProviderCapabilities = {
    supportsDelayedJobs: true,
    supportsPriority: true,
    supportsRetries: true, // requeues jobs on failure
    supportsDLQ: false, // no native DLQ - userland responsibility
    supportsBatching: true,
    supportsLongPolling: false, // simple poll model
    maxJobSize: 0, // unlimited
    maxBatchSize: 0, // unlimited
    maxDelaySeconds: 0, // unlimited
  };

  /**
   * Create a queue-scoped provider instance
   */
  forQueue(queueName: string): IQueueProvider {
    return new BoundMemoryProvider(this, queueName);
  }

  /**
   * Connect (no-op for memory)
   */
  async connect(): Promise<void> {
    // no-op
  }

  /**
   * Disconnect and cleanup
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async disconnect(): Promise<void> {
    // clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.queues.clear();
    this.fetchLocks.clear();
    this.jobOptions.clear();
  }

  /**
   * Internal: Add a job to the queue
   */
  async _addJob<T>(
    queueName: string,
    job: Job<T>,
    options?: JobOptions,
  ): Promise<Result<Job<T>, QueueError>> {
    let queue = this.queues.get(queueName) as MemoryQueue<T>;
    if (!queue) {
      // auto-create queue
      const createResult = await this.createQueue(queueName);
      if (!createResult.success) {
        return Result.err(createResult.error);
      }
      queue = this.queues.get(queueName) as MemoryQueue<T>;
    }

    // check for duplicate job ID
    if (queue.jobs.has(job.id)) {
      return Result.err(QueueErrorFactory.duplicateJob(job.id, queueName));
    }

    // store job options for later use in ack/nack
    if (options) {
      this.jobOptions.set(`${queueName}:${job.id}`, options);
    }

    // handle delayed jobs
    if (job.scheduledFor && job.scheduledFor > new Date()) {
      const delay = job.scheduledFor.getTime() - Date.now();
      const timerId = setTimeout(() => {
        const currentJob = queue.jobs.get(job.id);
        if (currentJob && currentJob.status === "delayed") {
          queue.jobs.set(job.id, {
            ...currentJob,
            status: "waiting",
          });
        }
        this.timers.delete(`${queueName}:${job.id}`);
      }, delay);

      this.timers.set(`${queueName}:${job.id}`, timerId);

      const delayedJob = { ...job, status: "delayed" as const };
      queue.jobs.set(job.id, delayedJob);
      return Result.ok(delayedJob);
    }

    // store the job
    queue.jobs.set(job.id, job);
    return Result.ok(job);
  }

  /**
   * Internal: Get a specific job by ID
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _getJob<T>(
    queueName: string,
    jobId: string,
  ): Promise<Result<Job<T> | null, QueueError>> {
    const queue = this.queues.get(queueName) as MemoryQueue<T>;
    if (!queue) {
      return Result.ok(null);
    }

    const job = queue.jobs.get(jobId);
    return Result.ok(job ?? null);
  }

  /**
   * Internal: Fetch jobs for processing (pull model)
   * Atomically marks jobs as active and returns them
   *
   * Uses simple lock flag to prevent concurrent fetches for the same queue.
   * Returns empty array if already fetching (backpressure mechanism).
   * Relies on JavaScript's single-threaded nature - the critical section
   * contains no await points, so operations are atomic within the event loop.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _fetchJobs<T>(
    queueName: string,
    count: number,
    _waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    const queue = this.queues.get(queueName) as MemoryQueue<T>;
    if (!queue) {
      return Result.ok([]);
    }

    if (queue.isPaused) {
      return Result.ok([]);
    }

    // simple lock check - if already fetching, return empty (backpressure)
    const lockKey = `${queueName}-fetch`;
    if (this.fetchLocks.has(lockKey)) {
      return Result.ok([]);
    }

    // set lock
    this.fetchLocks.add(lockKey);

    try {
      // find waiting jobs
      const waitingJobs = Array.from(queue.jobs.values()).filter(
        (j) =>
          j.status === "waiting" &&
          (!j.scheduledFor || j.scheduledFor <= new Date()),
      );

      if (waitingJobs.length === 0) {
        return Result.ok([]);
      }

      // sort by priority (higher first) then by creation time
      waitingJobs.sort((a, b) => {
        const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDiff !== 0) return priorityDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      // take up to count jobs
      const jobsToFetch = waitingJobs.slice(0, count);

      // mark as active and return as ActiveJob (safe since ActiveJob extends Job)
      const fetchedJobs: ActiveJob<T>[] = [];
      for (const job of jobsToFetch) {
        const updatedJob: Job<T> = {
          ...job,
          status: "active",
          processedAt: new Date(),
        };
        queue.jobs.set(job.id, updatedJob);
        // Cast to ActiveJob - safe since we don't add providerMetadata in memory provider
        fetchedJobs.push(updatedJob as ActiveJob<T>);
      }

      return Result.ok(fetchedJobs);
    } finally {
      this.fetchLocks.delete(lockKey);
    }
  }

  /**
   * Internal: Acknowledge successful job completion (pull model)
   * Conditionally removes job from queue based on removeOnComplete option
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _ackJob<T>(
    queueName: string,
    job: ActiveJob<T>,
    _result?: unknown,
  ): Promise<Result<void, QueueError>> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return Result.err(QueueErrorFactory.queueNotFound(queueName));
    }

    const jobId = job.id;
    const storedJob = queue.jobs.get(jobId);
    if (!storedJob) {
      return Result.err(QueueErrorFactory.jobNotFound(jobId, queueName));
    }

    // update to completed and increment counter
    const completedJob = {
      ...storedJob,
      status: "completed" as const,
      completedAt: new Date(),
    };
    queue.jobs.set(jobId, completedJob);
    queue.completedCount++;

    // check removeOnComplete option (defaults to true if not specified)
    const optionsKey = `${queueName}:${jobId}`;
    const options = this.jobOptions.get(optionsKey);
    const shouldRemove = options?.removeOnComplete !== false; // default true

    if (shouldRemove) {
      queue.jobs.delete(jobId);
      this.jobOptions.delete(optionsKey);
    }

    return Result.ok(undefined);
  }

  /**
   * Internal: Negative acknowledge - job failed (pull model)
   * Implements retry logic: requeues job if attempts < maxAttempts
   * Conditionally removes job on final failure based on removeOnFail option
   *
   * If error has `retryable: false`, skips retry and moves directly to failed state.
   * This allows handlers to signal permanent failures that shouldn't be retried.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _nackJob<T>(
    queueName: string,
    job: ActiveJob<T>,
    error: Error | QueueError,
  ): Promise<Result<void, QueueError>> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return Result.err(QueueErrorFactory.queueNotFound(queueName));
    }

    const jobId = job.id;
    const storedJob = queue.jobs.get(jobId);
    if (!storedJob) {
      return Result.err(QueueErrorFactory.jobNotFound(jobId, queueName));
    }

    const newAttempts = storedJob.attempts + 1;

    // check if error signals permanent failure (retryable: false)
    const isPermanentFailure =
      "retryable" in error && error.retryable === false;

    if (!isPermanentFailure && newAttempts < storedJob.maxAttempts) {
      // requeue for retry (only if retryable and attempts remaining)
      const retriedJob = {
        ...storedJob,
        status: "waiting" as const,
        attempts: newAttempts,
        error: error.message,
      };
      queue.jobs.set(jobId, retriedJob);
    } else {
      // final failure - mark as failed
      // either: permanent error (retryable: false), or exhausted attempts
      const failedJob = {
        ...storedJob,
        status: "failed" as const,
        failedAt: new Date(),
        error: error.message,
        attempts: newAttempts,
      };
      queue.jobs.set(jobId, failedJob);
      queue.failedCount++;

      // check removeOnFail option (defaults to true if not specified)
      const optionsKey = `${queueName}:${jobId}`;
      const options = this.jobOptions.get(optionsKey);
      const shouldRemove = options?.removeOnFail !== false; // default true

      if (shouldRemove) {
        queue.jobs.delete(jobId);
        this.jobOptions.delete(optionsKey);
      }
    }

    return Result.ok(undefined);
  }

  /**
   * Internal: Pause job processing for a queue
   */
  async _pauseQueue(queueName: string): Promise<Result<void, QueueError>> {
    // auto-create queue if it doesn't exist
    const createResult = await this.createQueue(queueName);
    if (!createResult.success) {
      return createResult;
    }

    const queue = this.queues.get(queueName)!;
    queue.isPaused = true;
    return Result.ok(undefined);
  }

  /**
   * Internal: Resume job processing for a queue
   */
  async _resumeQueue(queueName: string): Promise<Result<void, QueueError>> {
    // auto-create queue if it doesn't exist
    const createResult = await this.createQueue(queueName);
    if (!createResult.success) {
      return createResult;
    }

    const queue = this.queues.get(queueName)!;
    queue.isPaused = false;
    return Result.ok(undefined);
  }

  /**
   * Internal: Delete a queue and all its jobs
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _deleteQueue(queueName: string): Promise<Result<void, QueueError>> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return Result.err(QueueErrorFactory.queueNotFound(queueName));
    }

    // clear all timers for this queue
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${queueName}:`)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }

    // delete the queue
    this.queues.delete(queueName);
    return Result.ok(undefined);
  }

  /**
   * Internal: Get queue statistics
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _getStats(queueName: string): Promise<Result<QueueStats, QueueError>> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return Result.err(QueueErrorFactory.queueNotFound(queueName));
    }

    const jobs = Array.from(queue.jobs.values());
    const stats: QueueStats = {
      queueName,
      waiting: jobs.filter((j) => j.status === "waiting").length,
      active: jobs.filter((j) => j.status === "active").length,
      completed: queue.completedCount,
      failed: queue.failedCount,
      delayed: jobs.filter((j) => j.status === "delayed").length,
      paused: queue.isPaused,
    };

    return Result.ok(stats);
  }

  /**
   * Internal: Get health status for monitoring
   */
  async _getHealth(
    queueName: string,
  ): Promise<Result<HealthStatus, QueueError>> {
    // auto-create queue if it doesn't exist
    const createResult = await this.createQueue(queueName);
    if (!createResult.success) {
      return createResult;
    }

    const queue = this.queues.get(queueName)!;
    const jobs = Array.from(queue.jobs.values());
    const activeWorkers = jobs.filter((j) => j.status === "active").length;
    const queueDepth = jobs.filter((j) => j.status === "waiting").length;

    // simple error rate: failed jobs / total processed (last minute approximation)
    const totalProcessed = queue.completedCount + queue.failedCount;
    const errorRate =
      totalProcessed > 0 ? (queue.failedCount / totalProcessed) * 100 : 0;

    const health: HealthStatus = {
      activeWorkers,
      queueDepth,
      errorRate,
      completedCount: queue.completedCount,
      failedCount: queue.failedCount,
      isPaused: queue.isPaused,
    };

    return Result.ok(health);
  }

  /**
   * Create a queue
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  private async createQueue(
    queueName: string,
  ): Promise<Result<void, QueueError>> {
    if (this.queues.has(queueName)) {
      return Result.ok(undefined);
    }

    this.queues.set(queueName, {
      name: queueName,
      jobs: new Map(),
      isPaused: false,
      completedCount: 0,
      failedCount: 0,
    });

    return Result.ok(undefined);
  }
}

/**
 * BoundMemoryProvider - Queue-scoped wrapper around MemoryProvider
 * Implements IQueueProvider interface with queue-specific operations
 */
class BoundMemoryProvider implements IQueueProvider {
  constructor(
    private readonly provider: MemoryProvider,
    private readonly queueName: string,
  ) {}

  get capabilities(): ProviderCapabilities {
    return this.provider.capabilities;
  }

  async connect(): Promise<void> {
    return this.provider.connect();
  }

  async disconnect(): Promise<void> {
    return this.provider.disconnect();
  }

  async add<T>(
    job: Job<T>,
    options?: JobOptions,
  ): Promise<Result<Job<T>, QueueError>> {
    return this.provider._addJob(this.queueName, job, options);
  }

  async getJob<T>(jobId: string): Promise<Result<Job<T> | null, QueueError>> {
    return this.provider._getJob<T>(this.queueName, jobId);
  }

  async fetch<T>(
    batchSize: number,
    waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    return this.provider._fetchJobs<T>(this.queueName, batchSize, waitTimeMs);
  }

  async ack<T>(
    job: ActiveJob<T>,
    result?: unknown,
  ): Promise<Result<void, QueueError>> {
    return this.provider._ackJob(this.queueName, job, result);
  }

  async nack<T>(
    job: ActiveJob<T>,
    error: Error | QueueError,
  ): Promise<Result<void, QueueError>> {
    return this.provider._nackJob(this.queueName, job, error);
  }

  async pause(): Promise<Result<void, QueueError>> {
    return this.provider._pauseQueue(this.queueName);
  }

  async resume(): Promise<Result<void, QueueError>> {
    return this.provider._resumeQueue(this.queueName);
  }

  async delete(): Promise<Result<void, QueueError>> {
    return this.provider._deleteQueue(this.queueName);
  }

  async getStats(): Promise<Result<QueueStats, QueueError>> {
    return this.provider._getStats(this.queueName);
  }

  async getHealth(): Promise<Result<HealthStatus, QueueError>> {
    return this.provider._getHealth(this.queueName);
  }
}
