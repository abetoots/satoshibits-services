import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SpanStatusCode, trace } from "@opentelemetry/api";
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
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

import type { BaseSDK, BaseSDKState } from "./sdk-factory.mjs";
import type { NodeClientConfig } from "./unified-smart-client.mjs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { initializeSanitizer } from "./enrichment/sanitizer.mjs";
import { SmartSampler } from "./sampling.mjs";
import { createResource } from "./internal/resource-factory.mjs";

/**
 * This module manages SDK initialization and provides access to
 * either real or no-op implementations based on initialization success.
 */

// SDK state - starts with no-ops
let nodeSdkState: BaseSDKState & {
  config: NodeClientConfig | null;
} = {
  environment: "node",
  config: null,
  isInitialized: false,
  cleanupFunctions: [],
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  shutdown: () => {},
  sanitizer: null,
};

// Guard against concurrent initialization
let isInitializing = false;

/**
 * Initialize the OpenTelemetry SDK
 * This should only be called once, typically from index.mts
 */
export async function initializeSdk(config: NodeClientConfig): Promise<BaseSDKState> {
  if (nodeSdkState.isInitialized || isInitializing) {
    console.warn("SDK already initialized or initialization in progress");
    return nodeSdkState;
  }

  isInitializing = true;
  try {
    // Validate sampling rate if provided
    if (
      config.samplingRate !== undefined &&
      (config.samplingRate < 0 || config.samplingRate > 1)
    ) {
      console.warn(
        `Invalid samplingRate: ${config.samplingRate}. Using default.`,
      );
      config.samplingRate = undefined;
    }

    // For tests or constrained environments, allow disabling network exporters
    const disableExport =
      process.env.OBS_TEST_NO_EXPORT === "1" ||
      (config.testSpanProcessor ?? config.testMetricReader);

    // Setup exporters - use injected test components if provided, otherwise network
    let spanProcessor: SpanProcessor | undefined;
    if (config.testSpanProcessor) {
      spanProcessor = config.testSpanProcessor;
    } else if (!disableExport) {
      spanProcessor = new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${config.endpoint ?? "http://localhost:4318"}/v1/traces`,
          headers: config.headers,
        }),
      );
    }

    const metricReader =
      config.testMetricReader ??
      (disableExport
        ? undefined
        : new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: `${config.endpoint ?? "http://localhost:4318"}/v1/metrics`,
              headers: config.headers,
            }),
            exportIntervalMillis: 10000,
          }));

    // create service resource with explicit information using resource factory
    const serviceResource = createResource({
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
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
    const sdk = new NodeSDK({
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
                url: `${config.endpoint ?? "http://localhost:4318"}/v1/logs`,
                headers: config.headers,
              }),
            ),
          }),
      // use SmartSampler if sampling config is provided (AdaptiveSampler internalized)
      sampler: config.sampling ? new SmartSampler(config.sampling) : undefined,
      instrumentations:
        config.disableInstrumentation === true ||
        config.autoInstrument === false
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
    await sdk.start();
    console.debug("OpenTelemetry SDK initialized successfully");

    // Initialize state
    nodeSdkState.isInitialized = true;
    nodeSdkState.shutdown = sdk.shutdown.bind(sdk);
    nodeSdkState.sanitizer = initializeSanitizer(config.sanitizerOptions);

    setupProcessHandlers();
  } catch (error) {
    console.error("Failed to initialize OpenTelemetry SDK:", error);
    console.warn(
      "OpenTelemetry will provide no-op implementations for metrics and traces",
    );

    // OpenTelemetry will provide no-op implementations automatically
    // Mark as not initialized to indicate SDK setup failed
    nodeSdkState.isInitialized = false;
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
  if (nodeSdkState) {
    removeProcessHandlers();
    await nodeSdkState.shutdown();
    console.debug("OpenTelemetry SDK shutdown complete");

    // Reset to initial state
    nodeSdkState = {
      environment: "node",
      config: null,
      isInitialized: false,
      cleanupFunctions: [],
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

function setupProcessHandlers(): void {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;

  sigtermHandler = () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    // This handler is synchronous. It kicks off an async shutdown and
    // ensures the process doesn't exit until it's complete or times out.
    void (async () => {
      try {
        // Give shutdown a 5-second grace period before force-exiting.
        await Promise.race([
          shutdownSdk(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Shutdown timed out")), 5000),
          ),
        ]);
        console.log("Graceful shutdown complete. Exiting.");
        process.exit(0);
      } catch (error) {
        console.error("Error during graceful shutdown:", error);
        process.exit(1);
      }
    })();
  };
  process.on("SIGTERM", sigtermHandler);

  uncaughtExceptionHandler = (error: Error) => {
    console.error("Uncaught exception detected:", error);

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
    // After an uncaught exception, the process is in an unstable state and
    // MUST be terminated.
    console.log("Attempting to flush telemetry before exiting...");
    void (async () => {
      try {
        // Use a very short timeout for the flush.
        await Promise.race([
          shutdownSdk(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Flush on exception timed out")),
              2000,
            ),
          ),
        ]);
      } catch (shutdownError) {
        console.error(
          "Error during telemetry flush on exception:",
          shutdownError,
        );
      } finally {
        // IMPORTANT: The process MUST exit after an uncaught exception.
        process.exit(1);
      }
    })();
  };
  process.on("uncaughtException", uncaughtExceptionHandler);

  unhandledRejectionHandler = (reason: unknown) => {
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

export const NodeSDKWrapper: BaseSDK<NodeClientConfig> = {
  initializeSdk,
};
