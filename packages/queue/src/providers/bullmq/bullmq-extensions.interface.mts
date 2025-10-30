/**
 * BullMQ-specific extensions for advanced queue features
 * These features are not available in other providers and should be used
 * when you need BullMQ-specific functionality like recurring job schedulers.
 */

import type { Result } from '@satoshibits/functional';
import type { QueueError } from '../../core/types.mjs';

/**
 * Options for creating a recurring job scheduler
 */
export interface JobSchedulerOptions<T = unknown> {
  /**
   * Cron pattern for the recurring job (e.g., '0 0 * * *' for daily at midnight)
   */
  readonly pattern: string;

  /**
   * Name of the job to be added on each recurrence
   */
  readonly jobName: string;

  /**
   * Data payload for the recurring job
   */
  readonly data: T;

  /**
   * Optional timezone for the cron pattern (e.g., 'America/New_York')
   * Defaults to UTC if not specified
   */
  readonly timezone?: string;

  /**
   * Optional BullMQ-specific options for the recurring job
   * These options will be passed to the underlying BullMQ job
   */
  readonly jobOptions?: {
    readonly priority?: number;
    readonly attempts?: number;
    readonly backoff?: {
      readonly type: 'fixed' | 'exponential';
      readonly delay: number;
    };
    readonly removeOnComplete?: boolean | number;
    readonly removeOnFail?: boolean | number;
  };
}

/**
 * Information about a recurring job scheduler
 */
export interface JobScheduler {
  /**
   * Unique identifier for the scheduler
   */
  readonly id: string;

  /**
   * Cron pattern
   */
  readonly pattern: string;

  /**
   * Job name
   */
  readonly jobName: string;

  /**
   * Next scheduled execution time
   */
  readonly next?: Date;

  /**
   * Timezone (if specified)
   */
  readonly timezone?: string;
}

/**
 * BullMQ-specific extensions interface
 * Access via `queue.bullmq` namespace when using BullMQ provider
 */
export interface IBullMQExtensions {
  /**
   * Create or update a recurring job scheduler
   *
   * @param id - Unique identifier for the scheduler
   * @param options - Scheduler configuration
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * await queue.bullmq.upsertJobScheduler('daily-cleanup', {
   *   pattern: '0 2 * * *',  // 2 AM daily
   *   jobName: 'cleanup',
   *   data: { type: 'daily' },
   *   timezone: 'America/New_York'
   * });
   * ```
   */
  upsertJobScheduler<T = unknown>(
    id: string,
    options: JobSchedulerOptions<T>,
  ): Promise<Result<void, QueueError>>;

  /**
   * Get all recurring job schedulers for this queue
   *
   * @returns Result with array of job schedulers
   *
   * @example
   * ```typescript
   * const result = await queue.bullmq.getJobSchedulers();
   * if (result.success) {
   *   const schedulers = result.data;
   *   schedulers.forEach(s => console.log(`${s.id}: ${s.pattern}`));
   * }
   * ```
   */
  getJobSchedulers(): Promise<Result<JobScheduler[], QueueError>>;

  /**
   * Remove a recurring job scheduler
   *
   * @param id - Scheduler identifier to remove
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * await queue.bullmq.removeJobScheduler('daily-cleanup');
   * ```
   */
  removeJobScheduler(id: string): Promise<Result<void, QueueError>>;
}
