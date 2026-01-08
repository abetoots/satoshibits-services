import { SpanStatusCode, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  serviceInstanceIdDetector,
} from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK as OTelNodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

import type {
  NodeClientConfig,
  ProcessHandlerOptions,
} from "./config/client-config.mjs";
import type { BaseSDK, BaseSDKState } from "./sdk-factory.mjs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { initializeSanitizer } from "./enrichment/sanitizer.mjs";
import { createResource } from "./internal/resource-factory.mjs";
import { SmartSampler } from "./sampling.mjs";

/**
 * Node SDK - Server-side OpenTelemetry initialization
 *
 * Follows the same class-based pattern as BrowserSDK for consistency (H2 fix).
 * Separates configuration (constructor) from initialization (start method).
 */
export class NodeSDK {
  private config: NodeClientConfig;
  private isStarted = false;
  private sdk?: OTelNodeSDK;
  private sanitizer: ReturnType<typeof initializeSanitizer> | null = null;

  constructor(config: NodeClientConfig) {
    this.config = config;
    // No side effects in constructor - all initialization happens in start()
  }

  /**
   * Start the SDK following OpenTelemetry NodeSDK initialization pattern.
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

    // Validate sampling rate if provided
    const validatedConfig = { ...this.config };
    if (
      validatedConfig.samplingRate !== undefined &&
      (validatedConfig.samplingRate < 0 || validatedConfig.samplingRate > 1)
    ) {
      console.warn(
        `Invalid samplingRate: ${validatedConfig.samplingRate}. Using default.`,
      );
      validatedConfig.samplingRate = undefined;
    }

    // Warn about unimplemented Prometheus config (Gemini review finding)
    // TODO: Implement Prometheus exporter when @opentelemetry/exporter-prometheus is added as dependency
    if (validatedConfig.enablePrometheus) {
      console.warn(
        "enablePrometheus is configured but Prometheus exporter is not yet implemented. " +
          "Metrics will be exported via OTLP only. See GitHub issue for progress.",
      );
    }

    // For tests or constrained environments, allow disabling network exporters
    const disableExport =
      process.env.OBS_TEST_NO_EXPORT === "1" ||
      (validatedConfig.testSpanProcessor ?? validatedConfig.testMetricReader);

    // Normalize endpoint - strip /v1/traces suffix if present (Gemini review finding)
    // This aligns with Browser SDK behavior and supports both base URLs and full trace URLs
    const rawEndpoint = validatedConfig.endpoint ?? "http://localhost:4318";
    const baseEndpoint = rawEndpoint.replace(/\/v1\/traces\/?$/, "");

    // Setup exporters - use injected test components if provided, otherwise network
    let spanProcessor: SpanProcessor | undefined;
    if (validatedConfig.testSpanProcessor) {
      spanProcessor = validatedConfig.testSpanProcessor;
    } else if (!disableExport) {
      spanProcessor = new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${baseEndpoint}/v1/traces`,
          headers: validatedConfig.headers,
        }),
      );
    }

    const metricReader =
      validatedConfig.testMetricReader ??
      (disableExport
        ? undefined
        : new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: `${baseEndpoint}/v1/metrics`,
              headers: validatedConfig.headers,
            }),
            exportIntervalMillis: 10000,
          }));

    // create service resource with explicit information using resource factory
    const serviceResource = createResource({
      serviceName: validatedConfig.serviceName,
      serviceVersion: validatedConfig.serviceVersion,
      environment: process.env.NODE_ENV ?? "development",
    });

    // detect resources automatically from environment (skip in tests to avoid network calls)
    const resource = disableExport
      ? serviceResource
      : detectResources({
          detectors: [
            envDetector,
            processDetector,
            osDetector,
            hostDetector,
            serviceInstanceIdDetector,
          ],
        }).merge(serviceResource);

    // Initialize SDK with all three signals
    this.sdk = new OTelNodeSDK({
      resource, // now includes auto-detected + service info
      contextManager: new AsyncLocalStorageContextManager(), // Enable context propagation for Node.js
      // Only set processors if not disabled - undefined processors will use no-op implementations
      ...(spanProcessor && { spanProcessor }),
      ...(metricReader && { metricReader }),
      ...(disableExport
        ? {}
        : {
            logRecordProcessor: new BatchLogRecordProcessor(
              new OTLPLogExporter({
                url: `${baseEndpoint}/v1/logs`,
                headers: validatedConfig.headers,
              }),
            ),
          }),
      // use SmartSampler if sampling config is provided (AdaptiveSampler internalized)
      sampler: validatedConfig.sampling
        ? new SmartSampler(validatedConfig.sampling)
        : undefined,
      instrumentations:
        validatedConfig.disableInstrumentation === true ||
        validatedConfig.autoInstrument === false
          ? []
          : [
              getNodeAutoInstrumentations({
                "@opentelemetry/instrumentation-fs": {
                  enabled: false, // reduce noise in tests
                },
              }),
            ],
    });

    // Start the SDK - await to ensure initialization completes before first telemetry
    this.sdk.start();
    console.debug("OpenTelemetry SDK initialized successfully");

    this.sanitizer = initializeSanitizer(validatedConfig.sanitizerOptions);
    this.isStarted = true;

    return {
      shutdown: this.shutdown.bind(this),
      sanitizer: this.sanitizer,
    };
  }

  /**
   * Shutdown the SDK gracefully
   */
  public async shutdown(): Promise<void> {
    if (!this.isStarted || !this.sdk) {
      return;
    }

    try {
      await this.sdk.shutdown();
      console.debug("OpenTelemetry SDK shutdown complete");
    } catch (error) {
      console.error("Error during SDK shutdown:", error);
    } finally {
      this.isStarted = false;
      this.sdk = undefined;
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
 * Now delegates to NodeSDK class for consistent pattern with BrowserSDK (H2 fix).
 * This should only be called once, typically from index.mts
 */
export function initializeSdk(config: NodeClientConfig): BaseSDKState {
  if (nodeSdkState.isInitialized || isInitializing) {
    console.warn("SDK already initialized or initialization in progress");
    return nodeSdkState;
  }

  isInitializing = true;
  try {
    // Use the class-based SDK for consistency with BrowserSDK (H2 fix)
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
