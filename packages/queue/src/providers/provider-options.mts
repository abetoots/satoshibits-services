/**
 * Provider-specific options (escape hatch types).
 *
 * These types import the native options from each provider's SDK and use
 * TypeScript's `Omit` utility to create safe subsets. This prevents users
 * from overriding critical properties that the abstraction layer manages,
 * while still providing full type safety and autocompletion for all
 * other provider-specific features.
 *
 * Includes both per-job options and provider-level configuration types.
 */

import type {
  JobsOptions as BullJobsOptions,
  DefaultJobOptions,
} from "bullmq";
import type { SendMessageCommandInput } from "@aws-sdk/client-sqs";

/**
 * Safe BullMQ per-job options.
 *
 * We block properties that are managed by the normalized `Job` and `JobOptions`
 * interfaces to ensure the abstraction's invariants are maintained.
 *
 * Blocked (core identity and retry options):
 * - `jobId`: Managed by the library's `jobId` factory.
 * - `attempts`: Managed by the normalized `attempts` option.
 * - `delay`: Managed by the normalized `delay` option via `scheduledFor`.
 *
 * Allowed (including normalized option overrides for advanced use cases):
 * - `priority`: Can override normalized priority for provider-specific behavior
 * - `removeOnComplete`: Can override normalized option for fine-grained control
 * - `removeOnFail`: Can override normalized option for fine-grained control
 * - `backoff`: Custom retry strategies (exponential, fixed, custom)
 * - `lifo`: LIFO queue ordering
 * - `stackTraceLimit`: Error stack trace depth control
 * - `sizeLimit`: Job payload size validation
 * - `repeat`: Cron-based job scheduling
 * - `keepLogs`: Log retention control
 * - and all other BullMQ-specific features
 */
export type BullMQJobOptions = Omit<
  BullJobsOptions,
  "jobId" | "attempts" | "delay"
>;

/**
 * Safe BullMQ provider-level default job options.
 *
 * More permissive than per-job options, allowing defaults for `attempts`,
 * `backoff`, `removeOnComplete`, etc., but omits properties that are
 * nonsensical as provider-wide defaults.
 *
 * Blocked:
 * - `jobId`: Job IDs must be unique per job, not set as a default
 * - `delay`: Delays are job-specific, not provider-wide defaults
 *
 * Allowed:
 * - `attempts`: Default number of retry attempts for all jobs
 * - `backoff`: Default retry strategy for all jobs
 * - `priority`: Default priority for all jobs
 * - `removeOnComplete`: Default cleanup behavior for completed jobs
 * - `removeOnFail`: Default cleanup behavior for failed jobs
 * - and all other BullMQ default job options
 */
export type BullMQDefaultJobOptions = Omit<DefaultJobOptions, "jobId" | "delay">;

/**
 * Safe SQS job options.
 *
 * We block properties that are managed by the provider implementation itself.
 *
 * Blocked:
 * - `QueueUrl`: Determined from provider configuration.
 * - `MessageBody`: Used for the serialized job payload.
 * - `DelaySeconds`: Calculated from the normalized `delay` option.
 * - `MessageAttributes`: Constructed by the provider to transport job metadata.
 *   Users should use the normalized `metadata` field instead.
 *
 * Allowed examples:
 * - `MessageGroupId`: FIFO queue grouping for ordered processing
 * - `MessageDeduplicationId`: FIFO deduplication control
 * - `MessageSystemAttributes`: System attributes like AWSTraceHeader for X-Ray tracing
 */
export type SQSJobOptions = Omit<
  SendMessageCommandInput,
  "QueueUrl" | "MessageBody" | "DelaySeconds" | "MessageAttributes"
>;
