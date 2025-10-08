/**
 * Queue Adapter Utilities - Shared utility functions for queue adapters
 * Uses composition pattern to provide reusable functionality without inheritance
 */

import type { QueueError } from "./types.mjs";

/**
 * Error Factory Utilities
 * Create standardized errors across all adapters
 */
export const QueueErrorFactory = {
  queueNotFound(queueName: string): QueueError {
    return {
      type: "NotFoundError",
      code: "QUEUE_NOT_FOUND",
      message: `Queue ${queueName} not found`,
      resourceId: queueName,
      resourceType: "queue",
      queueName,
      retryable: false,
    };
  },

  jobNotFound(jobId: string, queueName: string): QueueError {
    return {
      type: "NotFoundError",
      code: "JOB_NOT_FOUND",
      message: `Job ${jobId} not found in queue ${queueName}`,
      resourceId: jobId,
      resourceType: "job",
      queueName,
      retryable: false,
    };
  },

  duplicateJob(jobId: string, queueName: string): QueueError {
    return {
      type: "DataError",
      code: "DUPLICATE",
      message: `Job ${jobId} already exists in queue ${queueName}`,
      jobId,
      queueName,
      retryable: false,
    };
  },

  invalidJobData(reason: string, data?: unknown): QueueError {
    return {
      type: "DataError",
      code: "VALIDATION",
      message: reason,
      data,
      retryable: false,
    };
  },
};
