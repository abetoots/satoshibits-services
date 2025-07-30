/**
 * Base handler implementation and utilities
 * 
 * Provides abstract base classes and utility functions for creating
 * metric handlers that process events and snapshots.
 */

import type { MetricEvent, MetricSnapshot, MetricHandler } from '../types.mjs';

/**
 * Abstract base class for metric handlers
 */
export abstract class BaseHandler implements MetricHandler {
  name: string;
  enabled = true;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Handle a single metric event
   */
  abstract handle(event: MetricEvent): void;

  /**
   * Handle an aggregated snapshot
   */
  abstract handleSnapshot(snapshot: MetricSnapshot): void;

  /**
   * Enable the handler
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable the handler
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if handler should process this event/snapshot
   */
  protected shouldHandle(): boolean {
    return this.enabled;
  }
}

/**
 * Handler that filters events based on criteria
 */
export class FilteredHandler extends BaseHandler {
  private filter: (event: MetricEvent) => boolean;
  private delegate: MetricHandler;

  constructor(
    name: string,
    filter: (event: MetricEvent) => boolean,
    delegate: MetricHandler
  ) {
    super(name);
    this.filter = filter;
    this.delegate = delegate;
  }

  handle(event: MetricEvent): void {
    if (this.shouldHandle() && this.filter(event)) {
      this.delegate.handle(event);
    }
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (this.shouldHandle()) {
      this.delegate.handleSnapshot(snapshot);
    }
  }
}

/**
 * Handler that batches events before processing
 */
export class BatchingHandler extends BaseHandler {
  private batch: MetricEvent[] = [];
  private batchSize: number;
  private flushInterval: number;
  private delegate: MetricHandler;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    name: string,
    batchSize: number,
    flushInterval: number,
    delegate: MetricHandler
  ) {
    super(name);
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.delegate = delegate;
    this.startTimer();
  }

  handle(event: MetricEvent): void {
    if (!this.shouldHandle()) return;

    this.batch.push(event);
    
    if (this.batch.length >= this.batchSize) {
      this.flush();
    }
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (this.shouldHandle()) {
      this.flush();
      this.delegate.handleSnapshot(snapshot);
    }
  }

  private flush(): void {
    if (this.batch.length === 0) return;

    const events = this.batch.splice(0);
    events.forEach(event => this.delegate.handle(event));
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.flush(), this.flushInterval);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  disable(): void {
    super.disable();
    this.stopTimer();
    this.flush();
  }
}

/**
 * Chain multiple handlers together
 */
export class HandlerChain extends BaseHandler {
  private handlers: MetricHandler[] = [];

  constructor(name: string, handlers: MetricHandler[] = []) {
    super(name);
    this.handlers = handlers;
  }

  add(handler: MetricHandler): this {
    this.handlers.push(handler);
    return this;
  }

  remove(handler: MetricHandler): this {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
    }
    return this;
  }

  handle(event: MetricEvent): void {
    if (!this.shouldHandle()) return;
    
    for (const handler of this.handlers) {
      try {
        handler.handle(event);
      } catch (error) {
        // rethrow to let the caller handle the error
        throw new Error(`Error in handler ${handler.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;
    
    for (const handler of this.handlers) {
      try {
        handler.handleSnapshot(snapshot);
      } catch (error) {
        // rethrow to let the caller handle the error
        throw new Error(`Error in handler ${handler.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/**
 * Type for event handler functions
 */
export type EventHandler = (event: MetricEvent) => void;

/**
 * Type for snapshot handler functions
 */
export type SnapshotHandler = (snapshot: MetricSnapshot) => void;

/**
 * Create a simple event handler from a function
 */
export function createEventHandler(
  name: string,
  handler: EventHandler
): MetricHandler {
  return {
    name,
    enabled: true,
    handle: handler,
    handleSnapshot: () => { /* no-op */ }
  };
}

/**
 * Create a simple snapshot handler from a function
 */
export function createSnapshotHandler(
  name: string,
  handler: SnapshotHandler
): MetricHandler {
  return {
    name,
    enabled: true,
    handle: () => { /* no-op */ },
    handleSnapshot: handler
  };
}