/**
 * Default job ID generator
 *
 * Uses the native crypto.randomUUID() for zero-dependency, production-safe unique IDs.
 * This is the sensible default for distributed systems.
 *
 * Users can provide custom ID generators via the `jobId` option:
 *
 * @example
 * ```typescript
 * // Use the default
 * const queue = new Queue('emails');
 *
 * // Or provide your own
 * import { nanoid } from 'nanoid';
 * const queue = new Queue('emails', {
 *   defaultJobOptions: {
 *     jobId: () => nanoid()
 *   }
 * });
 *
 * // Or per-job
 * await queue.add('send', data, { jobId: 'specific-id-123' });
 * ```
 */

/**
 * UUID v4 generator using native crypto API
 *
 * - Zero dependencies
 * - Suitable for distributed systems
 * - Strong uniqueness guarantees
 * - Production-safe default
 */
export function uuidId(): string {
  return crypto.randomUUID();
}
