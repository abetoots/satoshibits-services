/**
 * Worker - Unified API for job processing
 *
 * Responsibilities:
 * - Adapt to both push and pull provider models
 * - Instrument handler for consistent event emission
 * - Manage concurrency for pull-based providers
 * - Provide lifecycle management (start/stop)
 */

import type {
  ActiveJob,
  JobHandler,
  QueueError,
  WorkerOptions,
} from "../core/types.mjs";
import type {
  IProviderFactory,
  IQueueProvider,
} from "../providers/provider.interface.mjs";

import { TypedEventEmitter } from "../core/events.mjs";
import { ProviderHelper } from "../core/provider-helpers.mjs";
import { ConstructorValidator } from "../core/validators.mjs";

export class Worker<T = unknown> extends TypedEventEmitter {
  private readonly boundProvider: IQueueProvider;
  private shutdownFn?: () => Promise<void>;
  private isRunning = false;
  private activeJobs = 0;
  private lastFetchEmpty = false;
  private readonly maxConcurrency: number;
  private readonly batchSize: number;
  private readonly pollInterval: number;
  private readonly errorBackoff: number;
  private readonly handler: JobHandler<T>;

  /**
   * Create a worker to process jobs
   *
   * @param queueName - Name of the queue to process jobs from
   * @param handler - Function to process each job
   * @param options - Worker configuration options
   * @param options.provider - Queue provider instance (defaults to MemoryProvider)
   * @param options.concurrency - Maximum number of concurrent jobs (default: 1)
   * @param options.pollInterval - REQUIRED: Polling interval in ms for pull model. Choose based on latency requirements.
   * @param options.batchSize - Number of jobs to fetch at once (default: 1)
   * @param options.errorBackoff - REQUIRED: Backoff time in ms after errors. Choose based on error characteristics.
   *
   * **Note on Timeouts**:
   * This library does not provide built-in timeout functionality as it would be
   * incomplete (Promise.race doesn't cancel execution). Instead, implement timeout
   * handling in userland using AbortController for proper cancellation:
   *
   * @example
   * ```typescript
   * const worker = new Worker('emails', async (data, job) => {
   *   const controller = new AbortController();
   *   const timeoutId = setTimeout(() => controller.abort(), 5000);
   *
   *   try {
   *     const response = await fetch(url, { signal: controller.signal });
   *     clearTimeout(timeoutId);
   *     return Result.ok(response);
   *   } catch (error) {
   *     if (error.name === 'AbortError') {
   *       return Result.err({
   *         type: 'RuntimeError',
   *         code: 'TIMEOUT',
   *         message: 'Operation timed out after 5000ms',
   *         retryable: true
   *       });
   *     }
   *     throw error;
   *   }
   * }, {
   *   pollInterval: 100,
   *   errorBackoff: 1000,
   * });
   * ```
   */
  constructor(
    public readonly queueName: string,
    handler: JobHandler<T>,
    options: WorkerOptions & { provider?: IQueueProvider | IProviderFactory },
  ) {
    super();

    const validator: ConstructorValidator = new ConstructorValidator(
      `Worker:${queueName}`,
    );

    // validate required parameters
    validator.requireNonEmptyString("queueName", queueName);
    validator.requireFunction("handler", handler);

    // validate required timing options - prevent CPU spin-loop bugs
    validator.requireFiniteNonNegativeNumber(
      "pollInterval",
      options.pollInterval,
    );
    validator.requireFiniteNonNegativeNumber(
      "errorBackoff",
      options.errorBackoff,
    );

    this.handler = handler;

    // resolve provider (default to MemoryProvider if not specified)
    this.boundProvider = ProviderHelper.resolveBoundProvider(
      options.provider,
      queueName,
    );

    this.maxConcurrency = options.concurrency ?? 1;
    this.batchSize = options.batchSize ?? 1;
    this.pollInterval = options.pollInterval;
    this.errorBackoff = options.errorBackoff;
  }

  /**
   * Start processing jobs
   * Detects provider model and adapts accordingly
   */
  start(): void {
    if (this.isRunning) {
      throw new Error(`Worker for queue ${this.queueName} is already running`);
    }

    this.isRunning = true;

    // Check which model the provider supports
    if (this.boundProvider.process) {
      // PUSH MODEL: Provider manages fetch, we instrument handler
      this.startPushModel();
    } else if (
      this.boundProvider.fetch &&
      this.boundProvider.ack &&
      this.boundProvider.nack
    ) {
      // PULL MODEL: We manage fetch loop
      this.startPullModel();
    } else {
      throw new Error(
        `Provider for queue ${this.queueName} must implement either process() or fetch()/ack()/nack()`,
      );
    }
  }

  /**
   * Stop processing jobs gracefully
   * Matches README.md:206-209 API
   *
   * @param options.disconnectProvider - Whether to disconnect the provider (default: false).
   *   Set to true if this worker owns the provider. For shared providers, leave false
   *   and disconnect manually after closing all workers/queues.
   */
  async close(options?: {
    timeout?: number;
    finishActiveJobs?: boolean;
    disconnectProvider?: boolean;
  }): Promise<void> {
    const {
      timeout = 30000,
      finishActiveJobs = true,
      disconnectProvider = false,
    } = options ?? {};

    if (this.isRunning) {
      this.emit("processor.shutting_down", {});
      this.isRunning = false;

      // Wait for active jobs to complete if requested
      if (finishActiveJobs) {
        const deadline = Date.now() + timeout;
        while (this.activeJobs > 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Emit timeout event if active jobs remain (userland decides how to handle)
        if (this.activeJobs > 0) {
          this.emit("processor.shutdown_timeout", {
            queueName: this.queueName,
            timeout,
            activeJobs: this.activeJobs,
            message: `Shutdown timeout exceeded after ${timeout}ms. ${this.activeJobs} jobs still active.`,
          });
        }
      }

      // Call provider shutdown if available
      if (this.shutdownFn) {
        await this.shutdownFn();
      }
    }

    // Disconnect provider if requested, regardless of running state
    if (disconnectProvider) {
      await this.boundProvider.disconnect();
    }
  }

  /**
   * Push model: Provider manages fetch, we instrument handler
   */
  private startPushModel(): void {
    const instrumentedHandler = this.createInstrumentedHandler();

    this.shutdownFn = this.boundProvider.process!(instrumentedHandler, {
      concurrency: this.maxConcurrency,
      onError: (error: QueueError) => {
        // Worker API layer emits queue.error event
        this.emit("queue.error", {
          queueName: this.queueName,
          error,
        });
      },
    });
  }

  /**
   * Pull model: We manage fetch loop and concurrency
   * Fixed: Don't await infinite loops - return immediately
   */
  private startPullModel(): void {
    // Start single fetch loop with error boundary
    this.fetchLoop().catch((error: unknown) => {
      // fatal error in fetch loop - emit error event and stop worker
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.emit("queue.error", {
        queueName: this.queueName,
        error: {
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Fatal error in fetch loop: ${errorMessage}`,
          cause: error,
          retryable: false,
        },
      });

      // stop worker gracefully
      this.isRunning = false;
    });
  }

  /**
   * Fetch loop for pull-based providers
   * Implements backpressure as documented in ARCHITECTURE.md:495-506
   */
  private async fetchLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // BACKPRESSURE: respect concurrency limit
        if (this.activeJobs >= this.maxConcurrency) {
          await this.sleep(this.pollInterval);
          continue;
        }

        // Calculate how many jobs we can fetch
        const availableSlots = this.maxConcurrency - this.activeJobs;
        const fetchCount = Math.min(this.batchSize, availableSlots);

        if (fetchCount <= 0) {
          await this.sleep(this.pollInterval);
          continue;
        }

        // Fetch jobs from provider with optional long-polling
        const waitTimeMs = this.boundProvider.capabilities.supportsLongPolling
          ? this.pollInterval
          : undefined;
        const result = await this.boundProvider.fetch!<T>(
          fetchCount,
          waitTimeMs,
        );

        if (!result.success) {
          this.emit("queue.error", {
            queueName: this.queueName,
            error: result.error,
          });
          // backoff on error
          await this.sleep(this.errorBackoff);
          continue;
        }

        const jobs = result.data;

        // emit queue.drained if queue becomes empty
        if (jobs.length === 0 && !this.lastFetchEmpty) {
          this.emit("queue.drained", {
            queueName: this.queueName,
          });
        }

        // update empty state tracking
        this.lastFetchEmpty = jobs.length === 0;

        // Process jobs concurrently (fire and forget)
        for (const job of jobs) {
          if (!this.isRunning) break;
          void this.processJob(job); // fire and forget - process in parallel
        }

        // if no jobs, backoff slightly to avoid tight polling
        if (jobs.length === 0) {
          await this.sleep(this.pollInterval);
        }
      } catch (error) {
        this.emit("queue.error", {
          queueName: this.queueName,
          error: {
            type: "RuntimeError",
            code: "PROCESSING",
            message: `Fetch loop error: ${(error as Error).message}`,
            cause: error,
            retryable: true,
          },
        });
        // backoff on error
        await this.sleep(this.errorBackoff);
      }
    }
  }

  /**
   * Execute job with full instrumentation (shared logic for both push and pull models)
   * Handles timeout, error normalization, event emission, and activeJobs tracking
   */
  private async executeJobWithInstrumentation(
    job: ActiveJob<T>,
    callbacks: {
      onSuccess?: (result: unknown) => Promise<void>;
      onFailure?: (error: Error) => Promise<void>;
    },
  ): Promise<void> {
    this.activeJobs++;
    const startTime = Date.now();

    // emit active event
    this.emit("active", {
      jobId: job.id,
      queueName: this.queueName,
      attempts: job.attempts,
      status: job.status,
      metadata: job.metadata,
    });

    try {
      // execute handler
      const result = await this.handler(job.data, job);

      // check handler result
      if (!result.success) {
        // Preserve full error structure (QueueError | Error)
        // Don't flatten QueueError to Error - userland needs code, retryable, etc.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw result.error;
      }

      // success callback (e.g., ack in pull model)
      if (callbacks.onSuccess) {
        await callbacks.onSuccess(result.data);
      }

      this.emit("completed", {
        jobId: job.id,
        queueName: this.queueName,
        attempts: job.attempts,
        status: job.status,
        duration: Date.now() - startTime,
        metadata: job.metadata,
      });
    } catch (error: unknown) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      // failure callback (e.g., nack in pull model)
      if (callbacks.onFailure) {
        await callbacks.onFailure(errorObj);
      }

      this.emit("failed", {
        jobId: job.id,
        queueName: this.queueName,
        error: errorObj.message,
        errorType: errorObj.name || "Error",
        attempts: job.attempts,
        status: job.status,
        duration: Date.now() - startTime,
        willRetry: job.attempts < job.maxAttempts,
        structuredError: error as QueueError | Error,
      });

      // emit job.retrying if the job will be retried
      if (job.attempts < job.maxAttempts) {
        this.emit("job.retrying", {
          jobId: job.id,
          queueName: this.queueName,
          attempts: job.attempts + 1,
          status: "waiting",
          maxAttempts: job.maxAttempts,
        });
      }

      // re-throw for caller to handle (important for push model)
      throw errorObj;
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * Process a single job (pull model)
   */
  private async processJob(job: ActiveJob<T>): Promise<void> {
    try {
      await this.executeJobWithInstrumentation(job, {
        onSuccess: async () => {
          // ack the job if available (pull model)
          if (this.boundProvider.ack) {
            const ackResult = await this.boundProvider.ack(job);

            if (ackResult && !ackResult.success) {
              this.emit("queue.error", {
                queueName: this.queueName,
                error: ackResult.error,
              });
            }
          }
        },
        onFailure: async (error) => {
          // nack the job if available (pull model)
          if (this.boundProvider.nack) {
            const nackResult = await this.boundProvider.nack(job, error);

            if (nackResult && !nackResult.success) {
              this.emit("queue.error", {
                queueName: this.queueName,
                error: nackResult.error,
              });
            }
          }
        },
      });
    } catch {
      // error already handled by executeJobWithInstrumentation and onFailure callback
      // suppress re-throw for pull model since we handle ack/nack ourselves
    }
  }

  /**
   * Create instrumented handler for push model
   * Wraps user handler to emit consistent events
   */
  private createInstrumentedHandler(): (job: ActiveJob<T>) => Promise<void> {
    return (job: ActiveJob<T>) =>
      this.executeJobWithInstrumentation(job, {
        // push model: provider handles ack/nack, so no callbacks needed
      });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
