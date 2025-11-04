import type { Result } from "@satoshibits/functional";
import type { QueueError } from "../../core/types.mjs";
import type { Worker as BullMQWorker } from "bullmq";

/**
 * BullMQ-specific Worker extensions.
 * Provides access to BullMQ Worker features not available in the core Worker API.
 */
export interface IBullMQWorkerExtensions {
  /**
   * Get the underlying BullMQ Worker instance.
   * Returns undefined if the worker hasn't been started yet or has been closed.
   *
   * @returns Result containing the BullMQ Worker instance or undefined
   *
   * @example
   * ```typescript
   * const extensions = worker.bullmq;
   * if (extensions) {
   *   const result = extensions.getBullMQWorker();
   *   if (result.success && result.data) {
   *     const bullWorker = result.data;
   *     const isPaused = await bullWorker.isPaused();
   *   }
   * }
   * ```
   */
  getBullMQWorker(): Result<BullMQWorker | undefined, QueueError>;
}
