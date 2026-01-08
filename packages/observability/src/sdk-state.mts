/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * SDK State Module - Simplified state coordination for observability SDK
 *
 * Provides Promise-lock pattern for init/shutdown coordination.
 * Replaces over-engineered state machine per Doc 3 review [C1].
 *
 * @see 3-SIMPLICITY_AND_DEAD_CODE_MULTI_MODEL_REVIEW.md - Issue C1
 */

import type { initializeSanitizer } from "./enrichment/sanitizer.mjs";

/** SDK state data */
export interface SDKStateData {
  environment: "node" | "browser" | "unknown";
  isInitialized: boolean;
  shutdown: () => Promise<void>;
  sanitizer: ReturnType<typeof initializeSanitizer> | null;
}

/** State event types for dispatch interface compatibility */
export type SDKStateEvent =
  | { type: "INIT_START"; environment: "node" | "browser" }
  | {
      type: "INIT_SUCCESS";
      shutdown: () => Promise<void>;
      sanitizer: ReturnType<typeof initializeSanitizer> | null;
    }
  | { type: "INIT_FAILURE"; error?: Error }
  | { type: "SHUTDOWN_START" }
  | { type: "SHUTDOWN_COMPLETE" }
  | { type: "REGISTER_CLEANUP"; cleanup: () => void | Promise<void> };

// internal state
let environment: "node" | "browser" | "unknown" = "unknown";
let isInitialized = false;
let shutdownFn: () => Promise<void> = async () => {};
let sanitizerRef: ReturnType<typeof initializeSanitizer> | null = null;
const cleanupFns: (() => void | Promise<void>)[] = [];

// promise locks for coordination
let initPromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;

/** SDK state coordinator - maintains interface parity with previous SDKStateMachine */
export const sdkStateMachine = {
  getState(): Readonly<SDKStateData> {
    return {
      environment,
      isInitialized,
      shutdown: shutdownFn,
      sanitizer: sanitizerRef,
    };
  },

  isReady(): boolean {
    return isInitialized;
  },

  dispatch(event: SDKStateEvent): void {
    switch (event.type) {
      case "INIT_START":
        environment = event.environment;
        break;
      case "INIT_SUCCESS":
        shutdownFn = event.shutdown;
        sanitizerRef = event.sanitizer;
        isInitialized = true;
        break;
      case "INIT_FAILURE":
        // reset all state on failure (Codex review fix)
        isInitialized = false;
        environment = "unknown";
        shutdownFn = async () => {};
        sanitizerRef = null;
        cleanupFns.length = 0;
        break;
      case "SHUTDOWN_START":
        // no-op, shutdown coordination handled via promise lock
        break;
      case "SHUTDOWN_COMPLETE":
        isInitialized = false;
        environment = "unknown";
        shutdownFn = async () => {};
        sanitizerRef = null;
        cleanupFns.length = 0;
        break;
      case "REGISTER_CLEANUP":
        cleanupFns.push(event.cleanup);
        break;
    }
  },

  getInitPromise(): Promise<void> | null {
    return initPromise;
  },

  setInitPromise(promise: Promise<void> | null): void {
    initPromise = promise;
  },

  getShutdownPromise(): Promise<void> | null {
    return shutdownPromise;
  },

  setShutdownPromise(promise: Promise<void> | null): void {
    shutdownPromise = promise;
  },

  async runCleanups(): Promise<void> {
    for (const fn of [...cleanupFns]) {
      try {
        await fn();
      } catch (error) {
        console.error("Cleanup function error:", error);
      }
    }
    cleanupFns.length = 0;
  },

  /** Reset state (for testing) */
  reset(): void {
    environment = "unknown";
    isInitialized = false;
    shutdownFn = async () => {};
    sanitizerRef = null;
    cleanupFns.length = 0;
    initPromise = null;
    shutdownPromise = null;
  },
};

// legacy exports for type compatibility
export type SDKPhase = "uninitialized" | "ready";
export { sdkStateMachine as SDKStateMachine };
