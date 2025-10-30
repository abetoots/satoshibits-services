/**
 * BullMQProvider - Production Redis-backed queue provider
 *
 * Implements both push and pull models using BullMQ v5.
 * Delegates to BullMQ's native features (retries, DLQ, backoff) rather than reimplementing.
 *
 * This provider supports multiple queues and provides a factory method
 * to create queue-scoped provider instances.
 */

import { Result } from "@satoshibits/functional";
import {
  Queue as BullQueue,
  Worker as BullWorker,
  DelayedError,
  RateLimitError,
  UnrecoverableError,
  WaitingChildrenError,
  WaitingError,
} from "bullmq";
import genericPool from "generic-pool";
import { randomUUID } from "crypto";

import type {
  ActiveJob,
  HealthStatus,
  Job,
  JobOptions,
  ProviderCapabilities,
  QueueError,
  QueueStats,
} from "../../core/types.mjs";
import type { BullMQDefaultJobOptions } from "../provider-options.mjs";
import type {
  IProviderFactory,
  IQueueProvider,
} from "../provider.interface.mjs";
/**
 * BoundBullMQProvider - Queue-scoped wrapper around BullMQProvider
 * Implements IQueueProvider interface with queue-specific operations
 */
import type {
  IBullMQExtensions,
  JobScheduler,
  JobSchedulerOptions,
} from "./bullmq-extensions.interface.mjs";
import type {
  Job as BullJob,
  JobsOptions as BullJobsOptions,
  ConnectionOptions,
  DefaultJobOptions,
} from "bullmq";
import type { Pool } from "generic-pool";

import { QueueErrorFactory } from "../../core/utils.mjs";

/**
 * Configuration for BullMQ provider
 */
export interface BullMQProviderConfig {
  /**
   * Redis connection options, passed directly to BullMQ.
   * @see https://docs.bullmq.io/guide/connections
   */
  connection: ConnectionOptions;

  /**
   * Optional prefix for all Redis keys created by BullMQ (default: 'bull').
   * Useful for isolating multiple queue instances in the same Redis database.
   */
  prefix?: string;

  /**
   * Default job options for all jobs created by this provider instance.
   * These can be overridden by per-job options.
   *
   * Uses BullMQ's native `DefaultJobOptions` type with `jobId` and `delay`
   * omitted, as these are nonsensical as provider-wide defaults.
   *
   * Examples:
   * - `attempts`: Default retry attempts for all jobs
   * - `backoff`: Default retry strategy (exponential, fixed, custom)
   * - `removeOnComplete`: Automatic cleanup of completed jobs
   * - `removeOnFail`: Automatic cleanup of failed jobs
   * - `stackTraceLimit`: Error stack trace depth
   */
  defaultJobOptions?: BullMQDefaultJobOptions;

  /**
   * @deprecated This property is not used. Health is determined by queue statistics.
   */
  healthErrorRateThreshold?: number;
}

/**
 * BullMQProvider - Multi-queue Redis-backed provider
 * Implements IProviderFactory to create queue-scoped instances
 */
export class BullMQProvider implements IProviderFactory {
  private readonly connection: ConnectionOptions;
  private readonly prefix: string;
  private readonly defaultJobOptions: DefaultJobOptions;
  private readonly healthErrorRateThreshold: number; // MED-BQ-002
  private queues = new Map<string, BullQueue>();
  private workers = new Map<string, BullWorker>();
  private fetchWorkerPools = new Map<string, Pool<BullWorker>>();
  private isShuttingDown = false;

  readonly capabilities: ProviderCapabilities = {
    supportsDelayedJobs: true, // BullMQ DELAYED set
    supportsPriority: true, // BullMQ priority queues
    supportsRetries: true, // BullMQ native retry logic
    supportsDLQ: true, // BullMQ failed queue
    supportsBatching: true, // LRANGE batching
    supportsLongPolling: true, // BRPOPLPUSH blocking
    maxJobSize: 512_000_000, // 512MB (Redis limit)
    maxBatchSize: 100, // reasonable batch size
    maxDelaySeconds: 0, // unlimited
  };

  constructor(config: BullMQProviderConfig) {
    // MED-BQ-004: validate connection config
    if (!config.connection) {
      throw new Error(
        "BullMQProviderConfig requires a `connection` object (Redis/IORedis connection options).",
      );
    }

    this.connection = config.connection;
    this.prefix = config.prefix ?? "bull";
    this.healthErrorRateThreshold = config.healthErrorRateThreshold ?? 50; // MED-BQ-002: default 50%

    // establish provider-level default job options, merging our opinionated
    // defaults with any user-provided overrides
    this.defaultJobOptions = {
      // opinionated defaults
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
      // user-provided defaults take precedence
      ...(config.defaultJobOptions ?? {}),
    };
  }

  /**
   * Create a queue-scoped provider instance
   *
   * Eagerly creates the underlying BullMQ Queue instance to ensure it's
   * immediately available for inspection (e.g., for bull-board integration).
   */
  forQueue(queueName: string): IQueueProvider {
    // eagerly create the BullMQ Queue instance
    this.getOrCreateQueue(queueName);
    return new BoundBullMQProvider(this, queueName);
  }

  /**
   * Connect (establishes Redis connection)
   */
  async connect(): Promise<void> {
    // BullMQ establishes connections lazily when queues/workers are created
    // no-op here
  }

  /**
   * Disconnect and cleanup all queues/workers
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    // drain and close all fetch worker pools
    for (const [_, pool] of this.fetchWorkerPools.entries()) {
      await pool.drain();
      await pool.clear();
    }
    this.fetchWorkerPools.clear();

    // close all workers
    const workerClosePromises = Array.from(this.workers.values()).map((w) =>
      w.close(),
    );
    await Promise.all(workerClosePromises);
    this.workers.clear();

    // close all queues
    const queueClosePromises = Array.from(this.queues.values()).map((q) =>
      q.close(),
    );
    await Promise.all(queueClosePromises);
    this.queues.clear();
  }

  /**
   * ADVANCED USAGE: Returns the underlying BullMQ Queue instance for a given queue name.
   *
   * This method is an escape hatch for accessing provider-specific features like bull-board.
   * Use with caution, as it couples your application to BullMQ internals.
   *
   * @param name The name of the queue.
   * @returns The BullMQ Queue instance, or undefined if not found.
   *
   * @example
   * ```typescript
   * const providerFactory = new BullMQProvider({ connection: redis });
   * const queue = new Queue('emails', { provider: providerFactory.forQueue('emails') });
   *
   * // For bull-board integration
   * const bullQueue = providerFactory.getBullMQQueue('emails');
   * if (bullQueue) {
   *   const adapter = new BullMQAdapter(bullQueue);
   * }
   * ```
   */
  public getBullMQQueue(name: string): BullQueue | undefined {
    return this.queues.get(name);
  }

  /**
   * ADVANCED USAGE: Returns all managed BullMQ Queue instances.
   *
   * Useful for integrating with monitoring tools like bull-board.
   *
   * @returns A read-only map of queue names to BullMQ Queue instances.
   *
   * @example
   * ```typescript
   * import { createBullBoard } from '@bull-board/api';
   * import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
   *
   * const providerFactory = new BullMQProvider({ connection: redis });
   * // ... create queues ...
   *
   * const bullQueues = Array.from(providerFactory.getBullMQQueues().values());
   * const adapters = bullQueues.map(q => new BullMQAdapter(q));
   * createBullBoard({ queues: adapters });
   * ```
   */
  public getBullMQQueues(): ReadonlyMap<string, BullQueue> {
    return this.queues;
  }

  /**
   * Get the default job options configured for this provider
   * Used internally by extensions to maintain consistent behavior
   * @internal
   */
  public getDefaultJobOptions(): DefaultJobOptions {
    return this.defaultJobOptions;
  }

  /**
   * Map a provider error to a QueueError
   * Used internally by extensions to maintain consistent error handling
   * @internal
   */
  public mapProviderError(error: unknown, queueName: string): QueueError {
    return this.mapError(error, queueName);
  }

  /**
   * ADVANCED USAGE: Returns the underlying BullMQ Worker instance for a given queue name.
   *
   * This method is an escape hatch for accessing provider-specific features.
   * Useful for advanced monitoring or programmatic health checks.
   *
   * @param name The name of the queue.
   * @returns The BullMQ Worker instance, or undefined if not found.
   */
  public getBullMQWorker(name: string): BullWorker | undefined {
    return this.workers.get(name);
  }

  /**
   * Get or create a BullMQ Queue instance
   */
  private getOrCreateQueue(queueName: string): BullQueue {
    if (this.isShuttingDown) {
      throw new Error("Provider is shutting down");
    }

    let queue = this.queues.get(queueName);
    if (queue) {
      return queue;
    }

    queue = new BullQueue(queueName, {
      connection: this.connection,
      prefix: this.prefix,
    });

    this.queues.set(queueName, queue);
    return queue;
  }

  /**
   * Get or create a worker pool for atomic fetch operations
   * Workers are pooled to avoid create/destroy overhead on each fetch() call
   *
   * IMPORTANT: Workers are created with null processor for manual job fetching.
   * This allows unlimited concurrent getNextJob() calls without hitting BullMQ's
   * default concurrency limit (which is 1 when a processor function is provided).
   *
   * See: https://docs.bullmq.io/patterns/manually-fetching-jobs
   */
  private getOrCreateFetchWorkerPool(queueName: string): Pool<BullWorker> {
    if (this.isShuttingDown) {
      throw new Error("Provider is shutting down");
    }

    let pool = this.fetchWorkerPools.get(queueName);
    if (pool) {
      return pool;
    }

    pool = genericPool.createPool(
      {
        // eslint-disable-next-line @typescript-eslint/require-await
        create: async () => {
          // Create worker with null processor for manual fetching (no concurrency limit)
          return new BullWorker(queueName, null, {
            connection: this.connection,
            prefix: this.prefix,
          });
        },
        destroy: async (worker) => {
          await worker.close();
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        validate: async (worker) => {
          return worker.isRunning();
        },
      },
      {
        min: 1, // keep 1 worker warm
        max: 5, // max 5 workers for bursts
        idleTimeoutMillis: 30000, // cleanup idle workers after 30s
        acquireTimeoutMillis: 5000, // fail fast if pool exhausted
      },
    );

    this.fetchWorkerPools.set(queueName, pool);
    return pool;
  }

  /**
   * Internal: Add a job to the queue
   */
  async _addJob<T>(
    queueName: string,
    job: Job<T>,
    options?: JobOptions,
  ): Promise<Result<Job<T>, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const queue = this.getOrCreateQueue(queueName);

      // translate normalized options to BullMQ options
      // spread order matters for the override hierarchy:
      // 1. provider defaults
      // 2. normalized options (priority, removeOnComplete, removeOnFail)
      // 3. provider-specific options (can override normalized options)
      // 4. critical options (jobId, attempts, delay - cannot be overridden)
      const bullOptions: BullJobsOptions = {
        // start with provider-level defaults
        ...this.defaultJobOptions,
        // apply normalized options
        priority: job.priority,
        removeOnComplete:
          options?.removeOnComplete ?? this.defaultJobOptions.removeOnComplete,
        removeOnFail:
          options?.removeOnFail ?? this.defaultJobOptions.removeOnFail,
        // spread safe, user-provided provider-specific options
        // the BullMQJobOptions type ensures dangerous options like jobId/attempts/delay are omitted
        // these can override normalized options (priority, removeOnComplete, removeOnFail) for advanced use cases
        ...(options?.providerOptions?.bullmq ?? {}),
        // enforce critical options to prevent overrides
        // these MUST come last to ensure core guarantees (job identity and retry) are maintained
        jobId: job.id,
        attempts: job.maxAttempts,
        delay: job.scheduledFor
          ? Math.max(0, job.scheduledFor.getTime() - Date.now())
          : undefined,
      };

      // wrap job data and metadata
      const bullJobData = {
        _jobData: job.data,
        _metadata: job.metadata,
      };

      const bullJob = await queue.add(job.name, bullJobData, bullOptions);

      // map back to normalized job
      const addedJob = await this.mapBullJobToJob<T>(bullJob, queueName);
      return Result.ok(addedJob);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Get a specific job by ID
   */
  async _getJob<T>(
    queueName: string,
    jobId: string,
  ): Promise<Result<Job<T> | null, QueueError>> {
    try {
      const queue = this.getOrCreateQueue(queueName);
      const bullJob = await queue.getJob(jobId);

      if (!bullJob) {
        return Result.ok(null);
      }

      const job = await this.mapBullJobToJob<T>(bullJob, queueName);
      return Result.ok(job);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Fetch jobs for processing (pull model)
   * Uses Worker.getNextJob() for atomic fetch-and-lock operations
   * Workers are pooled to avoid create/destroy overhead
   */
  async _fetchJobs<T>(
    queueName: string,
    count: number,
    _waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    const pool = this.getOrCreateFetchWorkerPool(queueName);
    let worker: BullWorker | null = null;

    try {
      // acquire worker from pool
      worker = await pool.acquire();

      const jobs: ActiveJob<T>[] = [];
      for (let i = 0; i < count; i++) {
        const token = randomUUID(); // generate unique token per job
        // atomic operation: fetch + move to active state
        const bullJob = await worker.getNextJob(token);
        if (!bullJob) break; // no more jobs available

        const mappedJob = await this.mapBullJobToJob<T>(bullJob, queueName);
        // store token for ack/nack operations - create ActiveJob with providerMetadata
        const job: ActiveJob<T> = {
          ...mappedJob,
          providerMetadata: {
            bullmq: { token },
          },
        };
        jobs.push(job);
      }

      return Result.ok(jobs);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    } finally {
      // return worker to pool
      if (worker) {
        await pool.release(worker);
      }
    }
  }

  /**
   * Internal: Acknowledge successful job completion (pull model)
   */
  async _ackJob<T>(
    queueName: string,
    job: ActiveJob<T>,
    result?: unknown,
  ): Promise<Result<void, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const jobId = job.id;
      const token = (job.providerMetadata?.bullmq as { token: string })?.token;

      if (!token) {
        return Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Job ${jobId} is missing its lock token and cannot be acked.`,
          queueName,
          jobId,
          retryable: false,
        });
      }

      const queue = this.getOrCreateQueue(queueName);
      const bullJob = await queue.getJob(jobId);

      if (!bullJob) {
        return Result.err(QueueErrorFactory.jobNotFound(jobId, queueName));
      }

      // mark job as completed using the correct token
      await bullJob.moveToCompleted(result ?? {}, token);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Negative acknowledge - job failed (pull model)
   * Delegates to BullMQ's native retry logic
   */
  async _nackJob<T>(
    queueName: string,
    job: ActiveJob<T>,
    error: Error,
  ): Promise<Result<void, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const jobId = job.id;
      const token = (job.providerMetadata?.bullmq as { token: string })?.token;

      if (!token) {
        return Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Job ${jobId} is missing its lock token and cannot be nacked.`,
          queueName,
          jobId,
          retryable: false,
        });
      }

      const queue = this.getOrCreateQueue(queueName);
      const bullJob = await queue.getJob(jobId);

      if (!bullJob) {
        return Result.err(QueueErrorFactory.jobNotFound(jobId, queueName));
      }

      // delegate to BullMQ's native retry logic using the correct token
      // BullMQ will check attemptsMade vs attempts and handle retry/DLQ automatically
      await bullJob.moveToFailed(error, token);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Push model - register job processor
   * Uses BullMQ Worker with BRPOPLPUSH (efficient blocking)
   */
  _processJobs<T>(
    queueName: string,
    handler: (job: ActiveJob<T>) => Promise<void>,
    options: {
      concurrency?: number;
      onError?: (error: QueueError) => void;
    },
  ): () => Promise<void> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- QueueError is intentional design, should be Error subclass
      throw this.mapError(new Error("Provider is shutting down."), queueName);
    }

    try {
      const worker = new BullWorker(
        queueName,
        async (bullJob: BullJob) => {
          // map BullMQ job to normalized job
          const mappedJob = await this.mapBullJobToJob<T>(bullJob, queueName);

          // create ActiveJob with providerMetadata
          const job: ActiveJob<T> = {
            ...mappedJob,
            providerMetadata: {
              bullmq: { token: bullJob.token },
            },
          };

          // call handler - errors propagate to BullMQ for retry/DLQ
          await handler(job);
          return { success: true };
        },
        {
          connection: this.connection,
          prefix: this.prefix,
          concurrency: options.concurrency ?? 1,
        },
      );

      // store worker
      const workerKey = `${queueName}-${Date.now()}`;
      this.workers.set(workerKey, worker);

      // handle errors
      worker.on("error", (error) => {
        const queueError = this.mapError(error, queueName);
        console.error(
          `[BullMQProvider] Worker error for ${queueName}:`,
          queueError,
        );

        // report to Worker API layer via callback
        options.onError?.(queueError);
      });

      // return shutdown function
      return async () => {
        await worker.close();
        this.workers.delete(workerKey);
      };
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- QueueError is intentional design, should be Error subclass
      throw this.mapError(error, queueName);
    }
  }

  /**
   * Internal: Pause queue processing
   */
  async _pauseQueue(queueName: string): Promise<Result<void, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const queue = this.getOrCreateQueue(queueName);
      await queue.pause();

      // also pause all workers for this queue
      for (const worker of this.workers.values()) {
        if (worker.name === queueName) {
          await worker.pause();
        }
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Resume queue processing
   */
  async _resumeQueue(queueName: string): Promise<Result<void, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const queue = this.getOrCreateQueue(queueName);
      await queue.resume(); // Queue.resume() is async

      // also resume all workers for this queue
      for (const worker of this.workers.values()) {
        if (worker.name === queueName) {
          worker.resume(); // Worker.resume() is sync
        }
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Delete queue and all jobs
   */
  async _deleteQueue(queueName: string): Promise<Result<void, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      // close and remove all workers for this queue
      const workersToRemove: string[] = [];
      for (const [key, worker] of this.workers.entries()) {
        if (worker.name === queueName) {
          await worker.close();
          workersToRemove.push(key);
        }
      }
      workersToRemove.forEach((key) => this.workers.delete(key));

      // obliterate the queue
      const queue = this.queues.get(queueName);
      if (queue) {
        await queue.obliterate({ force: true });
        await queue.close();
        this.queues.delete(queueName);
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Get queue statistics
   */
  async _getStats(queueName: string): Promise<Result<QueueStats, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const queue = this.getOrCreateQueue(queueName);
      const counts = await queue.getJobCounts();
      const isPaused = await queue.isPaused();

      const stats: QueueStats = {
        queueName,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        paused: isPaused,
      };

      return Result.ok(stats);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Get health status for monitoring
   */
  async _getHealth(
    queueName: string,
  ): Promise<Result<HealthStatus, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const queue = this.getOrCreateQueue(queueName);
      const counts = await queue.getJobCounts();
      const isPaused = await queue.isPaused();

      const activeWorkers = counts.active ?? 0;
      const queueDepth = counts.waiting ?? 0;

      // calculate error rate
      const totalProcessed = (counts.completed ?? 0) + (counts.failed ?? 0);
      const errorRate =
        totalProcessed > 0 ? ((counts.failed ?? 0) / totalProcessed) * 100 : 0;

      // Return raw metrics - userland determines health thresholds
      const health: HealthStatus = {
        activeWorkers,
        queueDepth,
        errorRate,
        completedCount: counts.completed ?? 0,
        failedCount: counts.failed ?? 0,
        isPaused,
      };

      return Result.ok(health);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Get jobs from dead letter queue (failed queue)
   */
  async _getDLQJobs<T>(
    queueName: string,
    limit = 100,
  ): Promise<Result<Job<T>[], QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    // MED-BQ-003: validate and cap limit parameter
    if (limit < 1) {
      return Result.ok([]);
    }
    const cappedLimit = Math.min(limit, 1000); // cap at 1000 to prevent excessive memory usage

    try {
      const queue = this.getOrCreateQueue(queueName);
      const bullJobs = await queue.getFailed(0, cappedLimit - 1);

      const jobs = await Promise.all(
        bullJobs.map((bj) => this.mapBullJobToJob<T>(bj, queueName)),
      );

      return Result.ok(jobs);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Retry job from DLQ
   */
  async _retryJob(
    queueName: string,
    jobId: string,
  ): Promise<Result<void, QueueError>> {
    // HIGH-BQ-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        retryable: false,
        message: "Provider is shutting down.",
        queueName,
      });
    }

    try {
      const queue = this.getOrCreateQueue(queueName);
      const bullJob = await queue.getJob(jobId);

      if (!bullJob) {
        return Result.err(QueueErrorFactory.jobNotFound(jobId, queueName));
      }

      // use BullMQ's native retry
      await bullJob.retry();

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Map BullMQ job to normalized Job type
   */
  private async mapBullJobToJob<T>(
    bullJob: BullJob,
    queueName: string,
  ): Promise<Job<T>> {
    const state = await bullJob.getState();

    // extract job data and metadata from wrapped structure
    let jobData: T;
    let metadata: Record<string, unknown> | undefined;

    if (
      bullJob.data &&
      typeof bullJob.data === "object" &&
      "_jobData" in bullJob.data
    ) {
      const data = bullJob.data as {
        _jobData: T;
        _metadata?: Record<string, unknown>;
      };
      jobData = data._jobData;
      metadata = data._metadata;
    } else {
      // fallback for jobs not created by this provider
      jobData = bullJob.data as T;
    }

    return {
      id: bullJob.id ?? "",
      name: bullJob.name ?? "default",
      queueName,
      data: jobData,
      status: this.mapBullState(state),
      attempts: bullJob.attemptsMade ?? 0,
      maxAttempts:
        bullJob.opts?.attempts ?? this.defaultJobOptions.attempts ?? 3,
      createdAt: new Date(bullJob.timestamp),
      processedAt: bullJob.processedOn
        ? new Date(bullJob.processedOn)
        : undefined,
      completedAt: bullJob.finishedOn
        ? new Date(bullJob.finishedOn)
        : undefined,
      failedAt:
        state === "failed" && bullJob.finishedOn
          ? new Date(bullJob.finishedOn)
          : undefined,
      scheduledFor: bullJob.opts?.delay
        ? new Date(bullJob.timestamp + bullJob.opts.delay)
        : undefined,
      error: bullJob.failedReason,
      priority: bullJob.opts?.priority,
      metadata,
    };
  }

  /**
   * Map BullMQ state to normalized JobStatus
   */
  private mapBullState(
    state: string,
  ): "waiting" | "active" | "completed" | "failed" | "delayed" {
    switch (state) {
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "delayed":
        return "delayed";
      case "active":
        return "active";
      case "waiting":
      case "wait":
        return "waiting";
      default:
        return "waiting";
    }
  }

  /**
   * Map errors to QueueError
   */
  private mapError(error: unknown, queueName: string): QueueError {
    // type-safe instanceof checks first (BullMQ-specific errors)
    if (error instanceof RateLimitError) {
      return {
        type: "RuntimeError",
        code: "RATE_LIMIT", // LOW-BQ-001 FIX: specific code for better observability
        message: error.message || "Rate limit exceeded",
        queueName,
        retryable: true, // rate limits are transient
        cause: error,
      };
    }

    if (error instanceof UnrecoverableError) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: error.message || "Unrecoverable error",
        queueName,
        retryable: false, // explicitly marked as unrecoverable
        cause: error,
      };
    }

    // delayed/waiting errors are state transitions, not errors
    // but if they bubble up, treat as processing errors
    if (error instanceof DelayedError) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: error.message || "Job moved to delayed state",
        queueName,
        retryable: false,
        cause: error,
      };
    }

    if (error instanceof WaitingChildrenError) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: error.message || "Job waiting for children",
        queueName,
        retryable: false,
        cause: error,
      };
    }

    if (error instanceof WaitingError) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: error.message || "Job moved to waiting state",
        queueName,
        retryable: false,
        cause: error,
      };
    }

    // fallback to string matching for other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    // connection errors (Redis)
    if (
      lowerMessage.includes("connect") ||
      lowerMessage.includes("econnrefused") ||
      lowerMessage.includes("enotfound") ||
      (lowerMessage.includes("redis") && lowerMessage.includes("connection"))
    ) {
      return {
        type: "RuntimeError",
        code: "CONNECTION",
        message: `Redis connection failed: ${errorMessage}`,
        queueName,
        retryable: true, // connection errors are typically retryable
        cause: error instanceof Error ? error : undefined,
      };
    }

    // timeout errors
    if (
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("timed out")
    ) {
      return {
        type: "RuntimeError",
        code: "TIMEOUT",
        message: errorMessage,
        queueName,
        retryable: true, // timeouts are transient
        cause: error instanceof Error ? error : undefined,
      };
    }

    // stalled job errors (BullMQ-specific)
    if (lowerMessage.includes("stalled") || lowerMessage.includes("stall")) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: `Job stalled: ${errorMessage}`,
        queueName,
        retryable: true, // stalled jobs can be retried
        cause: error instanceof Error ? error : undefined,
      };
    }

    // lock lost errors (BullMQ-specific)
    if (
      (lowerMessage.includes("lock") &&
        (lowerMessage.includes("lost") || lowerMessage.includes("mismatch"))) ||
      lowerMessage.includes("joblock")
    ) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: `Job lock error: ${errorMessage}`,
        queueName,
        retryable: false, // lock errors usually indicate concurrent processing
        cause: error instanceof Error ? error : undefined,
      };
    }

    // redis script errors (BullMQ uses Lua scripts)
    if (
      lowerMessage.includes("script") ||
      lowerMessage.includes("lua") ||
      lowerMessage.includes("evalsha")
    ) {
      return {
        type: "RuntimeError",
        code: "PROCESSING",
        message: `Redis script error: ${errorMessage}`,
        queueName,
        retryable: false, // script errors indicate logic issues
        cause: error instanceof Error ? error : undefined,
      };
    }

    // queue not found errors
    if (
      (lowerMessage.includes("queue") && lowerMessage.includes("not found")) ||
      (lowerMessage.includes("queue") &&
        lowerMessage.includes("does not exist"))
    ) {
      return {
        type: "ConfigurationError",
        code: "INVALID_CONFIG",
        message: `Queue not found: ${errorMessage}`,
        retryable: false,
        details: { queueName },
      };
    }

    // duplicate job errors
    if (
      lowerMessage.includes("duplicate") ||
      lowerMessage.includes("already exists")
    ) {
      return {
        type: "DataError",
        code: "DUPLICATE",
        message: errorMessage,
        retryable: false,
        queueName,
      };
    }

    // serialization errors
    if (
      lowerMessage.includes("circular") ||
      lowerMessage.includes("stringify") ||
      lowerMessage.includes("serialize")
    ) {
      return {
        type: "DataError",
        code: "SERIALIZATION",
        message: `Failed to serialize job data: ${errorMessage}`,
        retryable: false,
        queueName,
        data: error instanceof Error ? error : undefined,
      };
    }

    // HIGH-BQ-002 FIX: default to runtime error with explicit retryable: false
    // Unknown errors should not be retried to prevent infinite loops
    return {
      type: "RuntimeError",
      code: "PROCESSING",
      message: errorMessage,
      retryable: false, // explicit non-retryable for unknown errors
      queueName,
      cause: error instanceof Error ? error : undefined,
    };
  }
}

/**
 * BullMQExtensions - Implementation of BullMQ-specific advanced features
 * Provides access to features like recurring job schedulers that are not available in other providers
 */
class BullMQExtensions implements IBullMQExtensions {
  constructor(
    private readonly provider: BullMQProvider,
    private readonly queueName: string,
  ) {}

  async upsertJobScheduler<T = unknown>(
    id: string,
    options: JobSchedulerOptions<T>,
  ): Promise<Result<void, QueueError>> {
    try {
      const queue = this.provider.getBullMQQueue(this.queueName);
      if (!queue) {
        return Result.err({
          type: "ConfigurationError",
          code: "INVALID_CONFIG",
          message: `Queue "${this.queueName}" not found`,
          retryable: false,
          details: { queueName: this.queueName },
        });
      }

      // build BullMQ job options from our JobSchedulerOptions
      // merge provider-level defaults with job-specific options for consistency with _addJob
      const bullJobOptions: BullJobsOptions = {
        // start with provider-level defaults
        ...this.provider.getDefaultJobOptions(),
        // apply user-provided options, which will override defaults
        ...(options.jobOptions ?? {}),
      };

      // BullMQ's upsertJobScheduler takes: (id, repeatOpts, jobTemplate)
      await queue.upsertJobScheduler(
        id,
        {
          pattern: options.pattern,
          ...(options.timezone ? { tz: options.timezone } : {}),
        },
        {
          name: options.jobName,
          data: options.data,
          opts: bullJobOptions,
        },
      );

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.provider.mapProviderError(error, this.queueName));
    }
  }

  async getJobSchedulers(): Promise<Result<JobScheduler[], QueueError>> {
    try {
      const queue = this.provider.getBullMQQueue(this.queueName);
      if (!queue) {
        return Result.err({
          type: "ConfigurationError",
          code: "INVALID_CONFIG",
          message: `Queue "${this.queueName}" not found`,
          retryable: false,
          details: { queueName: this.queueName },
        });
      }

      const bullSchedulers = await queue.getJobSchedulers();

      const schedulers: JobScheduler[] = bullSchedulers
        .filter((s) => s.id != null) // filter out schedulers without IDs
        .map((s) => ({
          id: s.id!, // safe to assert non-null due to filter
          pattern: s.pattern ?? "",
          jobName: s.name ?? "",
          next: s.next ? new Date(s.next) : undefined,
          timezone: s.tz,
        }));

      return Result.ok(schedulers);
    } catch (error) {
      return Result.err(this.provider.mapProviderError(error, this.queueName));
    }
  }

  async removeJobScheduler(id: string): Promise<Result<void, QueueError>> {
    try {
      const queue = this.provider.getBullMQQueue(this.queueName);
      if (!queue) {
        return Result.err({
          type: "ConfigurationError",
          code: "INVALID_CONFIG",
          message: `Queue "${this.queueName}" not found`,
          retryable: false,
          details: { queueName: this.queueName },
        });
      }

      await queue.removeJobScheduler(id);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.provider.mapProviderError(error, this.queueName));
    }
  }
}

class BoundBullMQProvider implements IQueueProvider {
  constructor(
    private readonly provider: BullMQProvider,
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
    error: Error,
  ): Promise<Result<void, QueueError>> {
    return this.provider._nackJob(this.queueName, job, error);
  }

  process<T>(
    handler: (job: ActiveJob<T>) => Promise<void>,
    options: {
      concurrency?: number;
      onError?: (error: QueueError) => void;
    },
  ): () => Promise<void> {
    return this.provider._processJobs<T>(this.queueName, handler, options);
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

  async getDLQJobs<T>(limit?: number): Promise<Result<Job<T>[], QueueError>> {
    return this.provider._getDLQJobs<T>(this.queueName, limit);
  }

  async retryJob(jobId: string): Promise<Result<void, QueueError>> {
    return this.provider._retryJob(this.queueName, jobId);
  }

  /**
   * Get BullMQ-specific extensions for advanced features
   * Access provider-specific methods like recurring job schedulers
   *
   * @returns BullMQ extensions instance
   *
   * @example
   * ```typescript
   * const extensions = boundProvider.getBullMQExtensions();
   * await extensions.upsertJobScheduler('daily-cleanup', {
   *   pattern: '0 2 * * *',
   *   jobName: 'cleanup',
   *   data: { type: 'daily' }
   * });
   * ```
   */
  getBullMQExtensions(): IBullMQExtensions {
    return new BullMQExtensions(this.provider, this.queueName);
  }
}
