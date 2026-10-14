import { SpanStatusCode, trace } from "@opentelemetry/api";
import { standardPolicy } from "@satoshibits/redaction";

import type {
  NodeClientConfig,
  ProcessHandlerOptions,
} from "./config/client-config.mjs";
import type { StartOptions } from "./preset/runtime.mjs";
import type { BaseSDK, BaseSDKState } from "./sdk-factory.mjs";

import { initializeSanitizer } from "./enrichment/sanitizer.mjs";
import {
  getStatus,
  resetForTesting,
  shutdown as shutdownRuntime,
  start as startRuntime,
  startWithTestHooks,
} from "./preset/runtime.mjs";

/**
 * Node SDK - the deprecated 1.x facade over the preset's runtime.
 *
 * There is one runtime per process. When one is already there (the project
 * preloaded the preset), the facade attaches to it and builds nothing.
 * Otherwise it calls the preset's `start()` with its config mapped onto the
 * preset's options, under the standard redaction policy. The 1.x test hooks
 * (`testSpanProcessor`, `testMetricReader`) are installed as given, and every
 * signal without one is off; `OBS_TEST_NO_EXPORT=1` turns every signal off.
 */
export class NodeSDK {
  private config: NodeClientConfig;
  private isStarted = false;
  /** started the runtime with test hooks, so its shutdown forgets it and a later start may follow */
  private ownsTestRuntime = false;
  private sanitizer: ReturnType<typeof initializeSanitizer> | null = null;

  constructor(config: NodeClientConfig) {
    this.config = config;
    // No side effects in constructor - all initialization happens in start()
  }

  /**
   * Start telemetry through the preset, or attach to the runtime already there.
   * Returns state for caller to manage global updates.
   */
  public start(): {
    shutdown: () => Promise<void>;
    sanitizer: ReturnType<typeof initializeSanitizer>;
  } {
    if (this.isStarted) {
      console.warn("NodeSDK already started");
      throw new Error("NodeSDK already started");
    }

    const config = this.config;

    // as in 1.x: an invalid rate is reported (the rate itself was never applied)
    if (
      config.samplingRate !== undefined &&
      (config.samplingRate < 0 || config.samplingRate > 1)
    ) {
      console.warn(`Invalid samplingRate: ${config.samplingRate}. Using default.`);
    }

    // Warn about unimplemented Prometheus config (Gemini review finding)
    if (config.enablePrometheus) {
      console.warn(
        "enablePrometheus is configured but Prometheus exporter is not yet implemented. " +
          "Metrics will be exported via OTLP only. See GitHub issue for progress.",
      );
    }

    // sampling went to the 1.x SDK's own sampler; the preset takes a sampler by name only
    if (config.sampling !== undefined) {
      console.warn(
        "sampling is configured but has no effect: set OTEL_TRACES_SAMPLER and OTEL_TRACES_SAMPLER_ARG instead.",
      );
    }

    // a runtime in any state (running, disabled, shut down) is the process's one runtime
    if (getStatus().state !== "not-started") {
      if (config.testSpanProcessor !== undefined || config.testMetricReader !== undefined) {
        console.warn(
          "testSpanProcessor and testMetricReader are not used: telemetry was already started in this process.",
        );
      }
    } else {
      const testHooks =
        process.env.OBS_TEST_NO_EXPORT === "1" ||
        config.testSpanProcessor !== undefined ||
        config.testMetricReader !== undefined;
      const options: StartOptions = {
        serviceName: config.serviceName,
        ...(config.serviceVersion !== undefined && { serviceVersion: config.serviceVersion }),
        // a full trace URL was accepted in 1.x: the base is what the preset takes
        ...(config.endpoint !== undefined && {
          endpoint: config.endpoint.replace(/\/v1\/traces\/?$/, ""),
        }),
        ...(config.headers !== undefined && { headers: config.headers }),
        redaction: standardPolicy,
        ...((config.disableInstrumentation === true || config.autoInstrument === false) && {
          instrumentations: false,
        }),
        // a test runner has loaders of its own
        ...(testHooks && { loaderHook: false }),
      };
      if (testHooks) {
        startWithTestHooks(options, {
          spanProcessor: config.testSpanProcessor,
          metricReader: config.testMetricReader,
        });
      } else {
        startRuntime(options);
      }
      this.ownsTestRuntime = testHooks;
    }

    this.sanitizer = initializeSanitizer(config.sanitizerOptions);
    this.isStarted = true;

    return {
      shutdown: this.shutdown.bind(this),
      sanitizer: this.sanitizer,
    };
  }

  /**
   * Shut the runtime down gracefully, the one attached to included: there is
   * one per process, and a 1.x consumer flushes at exit through this call.
   *
   * A runtime this facade started in test mode (a test hook given, or
   * `OBS_TEST_NO_EXPORT=1`) is also reset, as the `/testing` kit's `stop()`
   * does: forgotten, with the API's global registrations cleared, so the next
   * test can initialize again. Outside test mode a shutdown is final, as the
   * preset's is, and a later initialize attaches to the stopped runtime.
   */
  public async shutdown(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      await shutdownRuntime();
      console.debug("OpenTelemetry SDK shutdown complete");
    } catch (error) {
      console.error("Error during SDK shutdown:", error);
    } finally {
      this.isStarted = false;
      if (this.ownsTestRuntime) {
        this.ownsTestRuntime = false;
        // the runtime was shut down above; what is left is the API's registrations
        await resetForTesting().catch(() => undefined);
      }
    }
  }
}

// ===== Legacy function-based API for backward compatibility =====

// SDK state - starts with no-ops
let nodeSdkState: BaseSDKState & {
  config: NodeClientConfig | null;
} = {
  environment: "node",
  config: null,
  isInitialized: false,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  shutdown: () => {},
  sanitizer: null,
};

// Guard against concurrent initialization
let isInitializing = false;
let globalNodeSDK: NodeSDK | null = null;

/**
 * Initialize the OpenTelemetry SDK (legacy function-based API)
 * Delegates to the NodeSDK class (H2 fix).
 * This should only be called once, typically from index.mts
 */
export function initializeSdk(config: NodeClientConfig): BaseSDKState {
  if (nodeSdkState.isInitialized || isInitializing) {
    console.warn("SDK already initialized or initialization in progress");
    return nodeSdkState;
  }

  isInitializing = true;
  try {
    // use the class-based SDK (H2 fix)
    globalNodeSDK = new NodeSDK(config);
    const { shutdown, sanitizer } = globalNodeSDK.start();

    // Update legacy state for backward compatibility
    nodeSdkState.isInitialized = true;
    nodeSdkState.shutdown = shutdown;
    nodeSdkState.sanitizer = sanitizer;

    // Only setup process handlers if explicitly enabled (API Boundary fix)
    // Previously this was always called, which violated consumer control over process lifecycle
    if (config.enableProcessHandlers) {
      setupProcessHandlers(config.processHandlerOptions);
    }
  } catch (error) {
    console.error("Failed to initialize OpenTelemetry SDK:", error);
    console.warn(
      "OpenTelemetry will provide no-op implementations for metrics and traces",
    );

    // OpenTelemetry will provide no-op implementations automatically
    // Mark as not initialized to indicate SDK setup failed
    nodeSdkState.isInitialized = false;
    globalNodeSDK = null;
  } finally {
    // Always reset isInitializing flag, whether initialization succeeded or failed
    isInitializing = false;
  }

  return nodeSdkState;
}

/**
 * Shutdown the SDK gracefully
 */
export async function shutdownSdk(): Promise<void> {
  if (nodeSdkState.isInitialized || globalNodeSDK) {
    removeProcessHandlers();

    // Use class-based shutdown if available (H2 fix)
    if (globalNodeSDK) {
      await globalNodeSDK.shutdown();
      globalNodeSDK = null;
    } else {
      await nodeSdkState.shutdown();
    }

    // Reset to initial state
    nodeSdkState = {
      environment: "node",
      config: null,
      isInitialized: false,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      shutdown: () => {},
      sanitizer: null,
    };
  }
}

let processHandlersRegistered = false;
let sigtermHandler: ((signal: NodeJS.Signals) => void) | null = null;
let uncaughtExceptionHandler: ((error: Error) => void) | null = null;
let unhandledRejectionHandler: ((reason: unknown) => void) | null = null;

/**
 * Setup process handlers for graceful shutdown and error tracking.
 *
 * API Boundary Fix: This function no longer calls process.exit().
 * Consumer controls process termination via callbacks in ProcessHandlerOptions.
 *
 * @param options - Optional configuration for handler behavior
 */
function setupProcessHandlers(options?: ProcessHandlerOptions): void {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;

  const shutdownTimeoutMs = options?.shutdownTimeoutMs ?? 5000;
  const exceptionFlushTimeoutMs = options?.exceptionFlushTimeoutMs ?? 2000;

  sigtermHandler = () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    // This handler is synchronous. It kicks off an async shutdown.
    void (async () => {
      let shutdownError: Error | undefined;
      let beforeShutdownError: Error | undefined;

      // Run consumer's before-shutdown hook first (isolated to ensure flush always runs)
      if (options?.onBeforeShutdown) {
        try {
          await options.onBeforeShutdown();
        } catch (error) {
          beforeShutdownError =
            error instanceof Error ? error : new Error(String(error));
          console.error("Error in onBeforeShutdown hook:", beforeShutdownError);
        }
      }

      // Always attempt telemetry flush, even if beforeShutdown failed
      try {
        await Promise.race([
          shutdownSdk(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Shutdown timed out")),
              shutdownTimeoutMs,
            ),
          ),
        ]);
        console.log("Graceful shutdown complete.");
      } catch (error) {
        shutdownError =
          error instanceof Error ? error : new Error(String(error));
        console.error("Error during graceful shutdown:", shutdownError);
      }

      // Combine errors if both hook and shutdown failed
      const finalError = shutdownError ?? beforeShutdownError;

      // API Boundary Fix: Let consumer decide what to do next
      // Previously this called process.exit() which violated consumer control
      if (options?.onShutdownComplete) {
        options.onShutdownComplete(finalError);
      }
      // If no callback provided, process continues - consumer must handle termination
    })();
  };
  process.on("SIGTERM", sigtermHandler);

  uncaughtExceptionHandler = (error: Error) => {
    console.error("Uncaught exception detected:", error);

    // Doc 4 H4 Fix: Save handler reference BEFORE any async work, since shutdownSdk()
    // will set the module-level variable to null during cleanup
    const savedHandler = uncaughtExceptionHandler;

    // 1. Record the exception telemetry
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setAttribute("error.type", "uncaught_exception");
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    } else {
      const tracer = trace.getTracer("global-error-handler");
      const span = tracer.startSpan("uncaught_exception");
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.setAttribute("error.type", "uncaught_exception");
      span.end();
    }

    // 2. Attempt a rapid, best-effort telemetry flush.
    console.log("Attempting to flush telemetry...");
    void (async () => {
      try {
        // Use a short timeout for the flush since process is unstable
        await Promise.race([
          shutdownSdk(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Flush on exception timed out")),
              exceptionFlushTimeoutMs,
            ),
          ),
        ]);
      } catch (shutdownError) {
        console.error(
          "Error during telemetry flush on exception:",
          shutdownError,
        );
      }

      // API Boundary Fix: Let consumer decide what to do next
      // Previously this called process.exit(1) which violated consumer control
      if (options?.onUncaughtException) {
        options.onUncaughtException(error);
      } else {
        // If no callback provided, re-throw using setImmediate to preserve
        // default Node.js behavior (crash with stack trace).
        // We can't throw directly here since we're in an async context -
        // that would cause an unhandledRejection instead of uncaughtException.
        // setImmediate ensures the throw happens in the main event loop.
        //
        // Doc 4 H4 Fix (Gemini 3 Pro Preview): Unregister this handler BEFORE
        // re-throwing to prevent infinite loop. Without this, the re-thrown
        // error would trigger this same handler again, causing infinite
        // "Uncaught exception detected" logs instead of a proper crash.
        // Use savedHandler since shutdownSdk() may have set uncaughtExceptionHandler to null
        if (savedHandler) {
          process.off("uncaughtException", savedHandler);
        }
        setImmediate(() => {
          throw error;
        });
      }
    })();
  };
  process.on("uncaughtException", uncaughtExceptionHandler);

  unhandledRejectionHandler = (reason: unknown) => {
    // Log to console to preserve default Node.js visibility behavior
    // (attaching a listener otherwise silences the default warning)
    console.error("Unhandled rejection:", reason);

    const rejectionError = new Error(`Unhandled rejection: ${String(reason)}`);
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(rejectionError);
      activeSpan.setAttribute("error.type", "unhandled_rejection");
    } else {
      const tracer = trace.getTracer("global-error-handler");
      const span = tracer.startSpan("unhandled_rejection");
      span.recordException(rejectionError);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(reason),
      });
      span.setAttribute("error.type", "unhandled_rejection");
      span.end();
    }
    // Note: unhandledRejection doesn't need process.exit - Node.js handles this
    // based on --unhandled-rejections flag (default: warn in Node 15+)
  };
  process.on("unhandledRejection", unhandledRejectionHandler);
}

function removeProcessHandlers(): void {
  if (!processHandlersRegistered) return;

  if (sigtermHandler) {
    process.off("SIGTERM", sigtermHandler);
    sigtermHandler = null;
  }

  if (uncaughtExceptionHandler) {
    process.off("uncaughtException", uncaughtExceptionHandler);
    uncaughtExceptionHandler = null;
  }

  if (unhandledRejectionHandler) {
    process.off("unhandledRejection", unhandledRejectionHandler);
    unhandledRejectionHandler = null;
  }

  processHandlersRegistered = false;
}

export const getSdkState = () => nodeSdkState;

// ===== Consumer Utility Functions (API Boundary Fix) =====
// These utilities allow consumers to handle process lifecycle in their own handlers
// while still benefiting from SDK telemetry flushing.

/**
 * Flush all pending telemetry and shut down the SDK with a timeout.
 * Useful for consumers who want to ensure telemetry is sent before process termination.
 *
 * NOTE: This function shuts down the SDK completely. After calling this,
 * no more telemetry will be collected. Use this only when the process is
 * about to terminate.
 *
 * @param timeoutMs - Maximum time to wait for flush (default: 5000ms)
 * @returns Promise that resolves when flush completes or times out
 *
 * @example
 * ```typescript
 * // In your own SIGTERM handler:
 * process.on('SIGTERM', async () => {
 *   await myAppCleanup();
 *   await flushTelemetry(3000);
 *   process.exit(0);
 * });
 * ```
 */
export async function flushTelemetry(timeoutMs = 5000): Promise<void> {
  try {
    await Promise.race([
      shutdownSdk(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("Telemetry flush timed out")),
          timeoutMs,
        ),
      ),
    ]);
  } catch (error) {
    console.error("Error during telemetry flush:", error);
  }
}

/**
 * Record an error to telemetry without affecting process lifecycle.
 * Useful for consumers who want to record errors before handling them.
 *
 * @param error - The error to record
 * @param errorType - Type label for the error (default: "application_error")
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   recordErrorTelemetry(error, 'risky_operation_failed');
 *   // Handle error as you see fit
 * }
 * ```
 */
export function recordErrorTelemetry(
  error: Error,
  errorType = "application_error",
): void {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.recordException(error);
    activeSpan.setAttribute("error.type", errorType);
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  } else {
    const tracer = trace.getTracer("error-recorder");
    const span = tracer.startSpan(errorType);
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    span.setAttribute("error.type", errorType);
    span.end();
  }
}

/**
 * Create a graceful shutdown handler that flushes telemetry.
 * Returns a function suitable for use with process.on('SIGTERM', ...).
 *
 * This is a convenience factory for consumers who want SDK-managed telemetry flushing
 * but full control over process termination.
 *
 * @param options - Handler configuration
 * @returns A function to use as SIGTERM handler
 *
 * @example
 * ```typescript
 * const shutdownHandler = createShutdownHandler({
 *   timeoutMs: 3000,
 *   onBeforeFlush: async () => {
 *     await closeDbConnections();
 *   },
 *   onComplete: (error) => {
 *     if (error) console.error('Shutdown had errors:', error);
 *     process.exit(error ? 1 : 0);
 *   },
 * });
 * process.on('SIGTERM', shutdownHandler);
 * ```
 */
export function createShutdownHandler(options: {
  timeoutMs?: number;
  onBeforeFlush?: () => void | Promise<void>;
  onComplete: (error?: Error) => void;
}): () => void {
  return () => {
    console.log("Shutdown initiated...");
    void (async () => {
      let shutdownError: Error | undefined;
      try {
        if (options.onBeforeFlush) {
          await options.onBeforeFlush();
        }
        await flushTelemetry(options.timeoutMs ?? 5000);
      } catch (error) {
        shutdownError =
          error instanceof Error ? error : new Error(String(error));
      }
      options.onComplete(shutdownError);
    })();
  };
}

/**
 * Node SDK wrapper with async initialization
 * Uses specialized BaseSDK type with Promise return
 */
export const NodeSDKWrapper: BaseSDK<NodeClientConfig, BaseSDKState> = {
  initializeSdk,
};

// Re-export ProcessHandlerOptions for consumer use
export type { ProcessHandlerOptions } from "./config/client-config.mjs";
