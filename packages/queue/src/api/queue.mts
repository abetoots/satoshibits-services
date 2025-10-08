/**
 * Queue - Thin API layer for job enqueueing
 *
 * Responsibilities:
 * - Validate inputs
 * - Check provider capabilities (warn-and-degrade)
 * - Emit lifecycle events
 * - Delegate to provider
 */

import { Result } from "@satoshibits/functional";

import type {
  HealthStatus,
  Job,
  JobOptions,
  QueueError,
  QueueOptions,
  QueueStats,
} from "../core/types.mjs";
import type {
  IProviderFactory,
  IQueueProvider,
} from "../providers/provider.interface.mjs";

import { TypedEventEmitter } from "../core/events.mjs";
import { uuidId } from "../core/job-id-generators.mjs";
import { ProviderHelper } from "../core/provider-helpers.mjs";
import { ConstructorValidator } from "../core/validators.mjs";

export class Queue<T = unknown> extends TypedEventEmitter {
  private readonly boundProvider: IQueueProvider;
  private readonly options: QueueOptions;

  constructor(
    public readonly name: string,
    options?: Partial<QueueOptions> & {
      provider?: IQueueProvider | IProviderFactory;
    },
  ) {
    super();

    const validator: ConstructorValidator = new ConstructorValidator(
      `Queue:${name}`,
    );

    // validate queue name first - critical for routing
    validator.requireNonEmptyString("queueName", name);

    // validate explicit undefined/null - fail fast to catch user confusion
    if (
      options?.defaultJobOptions &&
      "jobId" in options.defaultJobOptions &&
      options.defaultJobOptions.jobId === undefined
    ) {
      validator.rejectExplicitUndefined(
        "defaultJobOptions.jobId",
        undefined,
        "a function",
      );
    }
    if (
      "onUnsupportedFeature" in (options ?? {}) &&
      options!.onUnsupportedFeature === undefined
    ) {
      validator.rejectExplicitUndefined(
        "onUnsupportedFeature",
        undefined,
        "a function",
      );
    }
    if ("provider" in (options ?? {}) && options!.provider === null) {
      throw new TypeError(`[Queue:${name}] provider cannot be null`);
    }
    if ("provider" in (options ?? {}) && options!.provider === undefined) {
      throw new TypeError(`[Queue:${name}] provider cannot be undefined`);
    }

    // normalize options with fallbacks
    const normalizedOptions = {
      defaultJobOptions: {
        attempts: options?.defaultJobOptions?.attempts ?? 3,
        jobId: options?.defaultJobOptions?.jobId ?? uuidId,
      },
      onUnsupportedFeature:
        options?.onUnsupportedFeature ?? ((msg) => console.warn(msg)),
    };

    // validate types after normalization
    validator.requireFunction(
      "defaultJobOptions.jobId",
      normalizedOptions.defaultJobOptions.jobId,
    );
    validator.requireFunction(
      "onUnsupportedFeature",
      normalizedOptions.onUnsupportedFeature,
    );

    this.options = normalizedOptions;

    // resolve provider (default to MemoryProvider if not specified)
    this.boundProvider = ProviderHelper.resolveBoundProvider(
      options?.provider,
      name,
    );
  }

  /**
   * Check capabilities and sanitize options (immutable)
   * Implements warn-and-degrade pattern without mutation
   * Returns a new sanitized options object with unsupported features removed
   */
  private sanitizeOptions(options: JobOptions): JobOptions {
    const sanitized = { ...options };
    const capabilities = this.boundProvider.capabilities;

    // check for delayed jobs support
    if (sanitized.delay !== undefined && !capabilities.supportsDelayedJobs) {
      const message = `[Queue:${this.name}] Provider does not support delayed jobs. delay will be ignored.`;
      this.options.onUnsupportedFeature(message);
      delete sanitized.delay;
    }

    // check for priority support
    if (sanitized.priority !== undefined && !capabilities.supportsPriority) {
      const message = `[Queue:${this.name}] Provider does not support job priorities. priority will be ignored.`;
      this.options.onUnsupportedFeature(message);
      delete sanitized.priority;
    }

    return sanitized;
  }

  /**
   * Create standardized error for unsupported features
   */
  private createUnsupportedFeatureError(featureName: string): QueueError {
    return {
      type: "ConfigurationError",
      code: "UNSUPPORTED_FEATURE",
      message: `[Queue:${this.name}] Provider does not support ${featureName}.`,
      retryable: false,
    };
  }

  /**
   * Add a job to the queue
   * Applies warn-and-degrade for unsupported features
   *
   * Returns Result to allow handling of expected errors (duplicate jobs, validation errors)
   */
  async add(
    jobName: string,
    data: T,
    options?: JobOptions,
  ): Promise<Result<Job<T>, QueueError>> {
    const mergedOptions = {
      attempts: this.options.defaultJobOptions.attempts,
      jobId: this.options.defaultJobOptions.jobId(),
      ...options,
    };

    // sanitize options immutably (warn-and-degrade pattern)
    const sanitizedOptions = this.sanitizeOptions(mergedOptions);

    // validate required fields after merge - user options could have overwritten defaults
    const validator: ConstructorValidator = new ConstructorValidator(
      `Queue:${this.name}`,
    );

    try {
      validator.requireNonEmptyString("jobId", sanitizedOptions.jobId);
      validator.requireNonNegativeNumber("attempts", sanitizedOptions.attempts);
    } catch (error) {
      return Result.err({
        type: "DataError",
        code: "VALIDATION",
        message: (error as Error).message,
        retryable: false,
      });
    }

    // Create job with persistent state only
    const job: Job<T> = {
      id: sanitizedOptions.jobId,
      name: jobName,
      queueName: this.name,
      data,
      status: "waiting",
      attempts: 0,
      maxAttempts: sanitizedOptions.attempts,
      createdAt: new Date(),
      priority: sanitizedOptions.priority,
      scheduledFor: sanitizedOptions.delay
        ? new Date(Date.now() + sanitizedOptions.delay)
        : undefined,
      metadata: sanitizedOptions.metadata,
    };

    // Add via provider - pass job (persistent state) and options (transient) separately
    return this.boundProvider.add(job, sanitizedOptions);
  }

  /**
   * Get a specific job by ID
   *
   * Returns Result - job not found is an expected scenario
   */
  async getJob(jobId: string): Promise<Result<Job<T> | null, QueueError>> {
    return this.boundProvider.getJob<T>(jobId);
  }

  /**
   * Get queue statistics
   *
   * Returns Result - queue not found is expected
   */
  async getStats(): Promise<Result<QueueStats, QueueError>> {
    return this.boundProvider.getStats();
  }

  /**
   * Pause job processing
   *
   * Returns Result - queue not found is expected
   */
  async pause(): Promise<Result<void, QueueError>> {
    const result = await this.boundProvider.pause();

    // emit queue.paused event if pause succeeded
    if (result.success) {
      this.emit("queue.paused", {
        queueName: this.name,
      });
    }

    return result;
  }

  /**
   * Resume job processing
   *
   * Returns Result - queue not found is expected
   */
  async resume(): Promise<Result<void, QueueError>> {
    const result = await this.boundProvider.resume();

    // emit queue.resumed event if resume succeeded
    if (result.success) {
      this.emit("queue.resumed", {
        queueName: this.name,
      });
    }

    return result;
  }

  /**
   * Delete queue and all jobs
   *
   * Returns Result - queue not found is expected
   */
  async delete(): Promise<Result<void, QueueError>> {
    return this.boundProvider.delete();
  }

  /**
   * Get health status for monitoring
   * Matches README.md:247-253
   */
  async getHealth(): Promise<Result<HealthStatus, QueueError>> {
    return this.boundProvider.getHealth();
  }

  /**
   * Get jobs from dead letter queue
   * Matches README.md:268-274
   */
  async getDLQJobs<T = unknown>(
    limit?: number,
  ): Promise<Result<Job<T>[], QueueError>> {
    if (!this.boundProvider.getDLQJobs) {
      return Result.err(
        this.createUnsupportedFeatureError("dead letter queue operations"),
      );
    }
    return this.boundProvider.getDLQJobs<T>(limit);
  }

  /**
   * Retry a failed job from DLQ
   * Matches README.md:273
   */
  async retryJob(jobId: string): Promise<Result<void, QueueError>> {
    if (!this.boundProvider.retryJob) {
      return Result.err(
        this.createUnsupportedFeatureError("job retry operations"),
      );
    }
    return this.boundProvider.retryJob(jobId);
  }

  /**
   * Close the queue and optionally disconnect the provider
   *
   * @param options.disconnectProvider - Whether to disconnect the provider (default: false).
   *   Set to true if this queue owns the provider. For shared providers, leave false
   *   and disconnect manually after closing all queues/workers.
   *
   * @example
   * ```typescript
   * // Single provider (not shared)
   * const queue = new Queue('tasks', { provider: new BullMQProvider() });
   * await queue.close({ disconnectProvider: true }); // clean up everything
   *
   * // Shared provider
   * const provider = new BullMQProvider({ connection });
   * const emailQueue = new Queue('emails', { provider });
   * const smsQueue = new Queue('sms', { provider });
   *
   * await emailQueue.close(); // leave provider connected
   * await smsQueue.close();   // leave provider connected
   * await provider.disconnect(); // user manages shared resource
   * ```
   */
  async close(options?: { disconnectProvider?: boolean }): Promise<void> {
    const shouldDisconnect = options?.disconnectProvider ?? false;
    if (shouldDisconnect) {
      await this.boundProvider.disconnect();
    }
  }
}
