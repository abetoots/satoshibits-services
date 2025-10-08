/**
 * Type-safe event emitter for the queue system
 *
 * Wraps Node's EventEmitter with strongly-typed version that
 * ensures compile-time safety for event names and payloads.
 */

import { EventEmitter } from "events";

import type { QueueError } from "./types.mjs";

/**
 * Define all queue system events with their payloads
 * Aligned with README.md documentation
 */
export interface QueueEventMap {
  // Worker lifecycle events (matches README.md:140-144)
  active: {
    jobId: string;
    queueName: string;
    attempts: number;
    status: string;
    workerId?: string;
    metadata?: Record<string, unknown>;
  };

  completed: {
    jobId: string;
    queueName: string;
    attempts: number;
    status: string;
    duration: number;
    metadata?: Record<string, unknown>;
  };

  failed: {
    jobId: string;
    queueName: string;
    error: string;
    errorType: string;
    attempts: number;
    status: string;
    duration: number;
    willRetry: boolean;
    structuredError?: QueueError | Error;
  };

  "job.retrying": {
    jobId: string;
    queueName: string;
    attempts: number;
    status: string;
    maxAttempts?: number;
    attempt?: number;
  };

  // Processor events
  "processor.shutting_down": Record<string, never>;

  "processor.shutdown_timeout": {
    queueName: string;
    timeout: number;
    activeJobs: number;
    message: string;
  };

  // Queue events
  "queue.error": {
    queueName: string;
    error: QueueError;
  };

  "queue.drained": {
    queueName: string;
  };

  "queue.paused": {
    queueName: string;
  };

  "queue.resumed": {
    queueName: string;
  };
}

export type QueueEventName = keyof QueueEventMap;

/**
 * Type-safe event listener
 */
export type QueueEventListener<K extends QueueEventName> = (
  payload: QueueEventMap[K],
) => void | Promise<void>;

// Export individual event payload types for use in tests
export type ActiveEventPayload = QueueEventMap["active"];
export type CompletedEventPayload = QueueEventMap["completed"];
export type FailedEventPayload = QueueEventMap["failed"];
export type JobRetryingEventPayload = QueueEventMap["job.retrying"];
export type ProcessorShuttingDownEventPayload =
  QueueEventMap["processor.shutting_down"];
export type ProcessorShutdownTimeoutEventPayload =
  QueueEventMap["processor.shutdown_timeout"];
export type QueueErrorEventPayload = QueueEventMap["queue.error"];
export type QueueDrainedEventPayload = QueueEventMap["queue.drained"];
export type QueuePausedEventPayload = QueueEventMap["queue.paused"];
export type QueueResumedEventPayload = QueueEventMap["queue.resumed"];

/**
 * Type-safe event emitter for queue system
 * Wraps Node's EventEmitter with type safety
 *
 * Error Handling Philosophy:
 * - By default, errors in listeners propagate (fail-fast)
 * - Use onSafe() for fire-and-forget listeners that suppress errors
 * - This aligns with "thin abstraction" - userland owns error policy
 */
export class TypedEventEmitter {
  private emitter = new EventEmitter();
  private isEmittingError = false;
  private safeListenerMap = new WeakMap<
    QueueEventListener<QueueEventName>,
    (payload: unknown) => void
  >();

  /**
   * Handle errors from event listeners
   * Shared logic for both sync and async error paths
   *
   * @param error - The error that occurred
   * @param event - The event being handled
   * @param listenerType - Whether from 'on' or 'once'
   * @param isAsync - Whether error came from async handler
   */
  private handleErrorInListener<K extends QueueEventName>(
    error: unknown,
    event: K,
    listenerType: "on" | "once",
    isAsync: boolean,
  ): void {
    if (event !== "queue.error" && !this.isEmittingError) {
      this.isEmittingError = true;
      try {
        const errorPrefix = isAsync ? "Error" : "Synchronous error";
        this.emit("queue.error", {
          queueName: "system",
          error: {
            type: "RuntimeError",
            code: "PROCESSING",
            message: `${errorPrefix} in ${listenerType} listener for event '${String(event)}': ${(error as Error)?.message}`,
            cause: error,
            retryable: false,
          } as QueueError,
        });
      } finally {
        this.isEmittingError = false;
      }
    } else {
      // fail-fast: let error propagate unhandled (userland owns policy)
      throw error;
    }
  }

  /**
   * Wrap a listener with error suppression for fire-and-forget behavior
   * Only used by onSafe() - regular on() lets errors propagate
   *
   * Behavior:
   * - For non-queue.error events: Catches errors and re-emits as queue.error
   * - For queue.error events: Lets errors propagate (fail-fast)
   *
   * This enforces "userland owns policy" - if your queue.error listener throws,
   * that's a programming error that should crash the process.
   */
  private wrapListenerWithErrorSuppression<K extends QueueEventName>(
    event: K,
    listener: QueueEventListener<K>,
    listenerType: "on" | "once",
  ): (payload: QueueEventMap[K]) => void {
    return (payload: QueueEventMap[K]) => {
      try {
        Promise.resolve(listener(payload)).catch((error) => {
          this.handleErrorInListener(error, event, listenerType, true);
        });
      } catch (error) {
        this.handleErrorInListener(error, event, listenerType, false);
      }
    };
  }

  /**
   * Add a listener for a specific event
   * Errors in listeners will propagate (fail-fast)
   * Use onSafe() if you want fire-and-forget behavior
   */
  on<K extends QueueEventName>(
    event: K,
    listener: QueueEventListener<K>,
  ): this {
    //Userland can implement IIFEs or void operators to ignore returned promises
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Add a one-time listener for a specific event
   * Errors in listeners will propagate (fail-fast)
   * Use onceSafe() if you want fire-and-forget behavior
   */
  once<K extends QueueEventName>(
    event: K,
    listener: QueueEventListener<K>,
  ): this {
    //Userland can implement IIFEs or void operators to ignore returned promises
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.emitter.once(event, listener);
    return this;
  }

  /**
   * Add a fire-and-forget listener (errors are suppressed and emitted as queue.error)
   * Use this for non-critical listeners where you want to continue processing
   * For critical listeners, use on() and handle errors explicitly
   */
  onSafe<K extends QueueEventName>(
    event: K,
    listener: QueueEventListener<K>,
  ): this {
    const wrappedListener = this.wrapListenerWithErrorSuppression(
      event,
      listener,
      "on",
    );
    this.safeListenerMap.set(
      listener as QueueEventListener<QueueEventName>,
      wrappedListener as (payload: unknown) => void,
    );
    this.emitter.on(event, wrappedListener);
    return this;
  }

  /**
   * Add a one-time fire-and-forget listener (errors are suppressed)
   */
  onceSafe<K extends QueueEventName>(
    event: K,
    listener: QueueEventListener<K>,
  ): this {
    const wrappedListener = this.wrapListenerWithErrorSuppression(
      event,
      listener,
      "once",
    );
    this.emitter.once(event, wrappedListener);
    return this;
  }

  /**
   * Remove a listener for a specific event
   * Works for both regular and safe listeners
   */
  off<K extends QueueEventName>(
    event: K,
    listener: QueueEventListener<K>,
  ): this {
    // try to remove as safe listener first
    const wrappedListener = this.safeListenerMap.get(
      listener as QueueEventListener<QueueEventName>,
    );
    if (wrappedListener) {
      this.emitter.off(event, wrappedListener);
      this.safeListenerMap.delete(
        listener as QueueEventListener<QueueEventName>,
      );
    } else {
      // remove as regular listener
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      this.emitter.off(event, listener);
    }
    return this;
  }

  /**
   * Remove all listeners for an event or all events
   */
  removeAllListeners(event?: QueueEventName): this {
    this.emitter.removeAllListeners(event);
    return this;
  }

  /**
   * Emit an event with its payload
   */
  emit<K extends QueueEventName>(event: K, payload: QueueEventMap[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: QueueEventName): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Get all event names that have listeners
   */
  eventNames(): QueueEventName[] {
    return this.emitter.eventNames() as QueueEventName[];
  }
}
