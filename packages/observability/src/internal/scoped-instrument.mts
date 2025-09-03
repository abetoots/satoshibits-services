/**
 * Scoped Instrumentation Client
 *
 * Provides properly scoped access to OpenTelemetry instrumentation following the
 * OpenTelemetry specification for instrumentation scope (name and version).
 * Acts as a lightweight facade that delegates to the parent client's smart features.
 *
 * @module internal/scoped-instrument
 * @internal
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Meter, SpanOptions, Tracer } from "@opentelemetry/api";
import type { LogAttributes, Logger } from "@opentelemetry/api-logs";
import type { UnifiedObservabilityClient } from "../unified-smart-client.mjs";
import {
  categorizeErrorForObservability,
  reportResultError,
} from "../smart-errors.mjs";
import {
  createSmartCounter,
  createSmartGauge,
  createSmartHistogram,
  createSmartUpDownCounter,
} from "../smart-metrics.mjs";
import { getEnrichedLabels } from "../enrichment/context.mjs";
import {
  emitLogEntry,
  reportErrorWithInstrumentation,
} from "../utils/observability-helpers.mjs";
import { getResultAdapter } from "../utils/result-adapter.mjs";
import { isThenable } from "../utils/thenable.mjs";
import { MetricValidation, createSafeCacheKey } from "./metric-validation.mjs";

// Local lightweight instrument interfaces to avoid unsafe `any`
interface CounterInstrument {
  increment: (value?: number, customContext?: Record<string, unknown>) => void;
}

interface UpDownInstrument {
  add: (value: number, customContext?: Record<string, unknown>) => void;
}

interface HistogramInstrument {
  record: (value: number, customContext?: Record<string, unknown>) => void;
}

interface GaugeInstrument {
  set: (value: number, customContext?: Record<string, unknown>) => void;
}

/**
 * Scoped Instrumentation Client
 *
 * Provides properly scoped access to OpenTelemetry instrumentation following the
 * OpenTelemetry specification for instrumentation scope (name and version).
 * Acts as a lightweight facade that delegates to the parent client's smart features.
 *
 * @public
 * @since 2.0.0
 */
export class ScopedInstrument {
  private readonly meter: Meter;
  private readonly tracer: Tracer;
  private readonly logger: Logger;
  private readonly parentClient: UnifiedObservabilityClient;
  private readonly scopeName: string;

  /**
   * @internal - Created by UnifiedObservabilityClient.getInstrumentation()
   */
  constructor(
    meter: Meter,
    tracer: Tracer,
    logger: Logger,
    parentClient: UnifiedObservabilityClient,
    scopeName: string,
  ) {
    this.meter = meter;
    this.tracer = tracer;
    this.logger = logger;
    this.parentClient = parentClient;
    this.scopeName = scopeName;
  }

  /**
   * Metrics API - Scoped to this instrumentation
   */
  readonly metrics = {
    /**
     * Increment a counter metric (one-step API)
     *
     * Supports flexible argument patterns:
     * - increment("name")                    -> value=1, no attributes
     * - increment("name", 5)                 -> value=5, no attributes
     * - increment("name", { attr: "val" })   -> value=1, with attributes
     * - increment("name", 5, { attr: "val" }) -> value=5, with attributes
     */
    increment: (
      name: string,
      valueOrAttributes?: number | Record<string, unknown>,
      attributes?: Record<string, unknown>,
    ) => {
      // detect if second argument is attributes (object) vs value (number)
      let finalValue = 1;
      let finalAttrs = attributes;

      if (typeof valueOrAttributes === "object" && valueOrAttributes !== null) {
        // (name, attributes) form - use default value 1
        finalAttrs = valueOrAttributes;
      } else if (typeof valueOrAttributes === "number") {
        // (name, value) or (name, value, attributes) form
        finalValue = valueOrAttributes;
      } else if (valueOrAttributes !== undefined) {
        // invalid type (e.g., string) - pass through for validation to reject
        finalValue = valueOrAttributes as unknown as number;
      }

      // validate inputs according to OTel spec
      const validName = MetricValidation.validateName(name, {
        metricType: "counter",
        scopeName: this.scopeName,
      });
      if (!validName) return;

      const validValue = MetricValidation.validateValue(finalValue, {
        metricType: "counter",
        scopeName: this.scopeName,
      });
      if (validValue === null || validValue < 0) return; // counters can't decrement

      const key = createSafeCacheKey(this.scopeName, "counter", validName);
      const cache = this.parentClient.getInstrumentCache();
      let counter = cache.get(key) as
        | CounterInstrument
        | undefined;
      if (!counter) {
        counter = createSmartCounter(validName, this.meter);
        cache.set(key, counter);
      }
      // use parent client's sanitizer for consistency with logs and config support
      const sanitized = this.parentClient.sanitizeAttributes(finalAttrs);
      counter.increment(validValue, sanitized);
    },

    /**
     * Decrement a counter metric (one-step API)
     *
     * Supports flexible argument patterns:
     * - decrement("name")                    -> value=1, no attributes
     * - decrement("name", 5)                 -> value=5, no attributes
     * - decrement("name", { attr: "val" })   -> value=1, with attributes
     * - decrement("name", 5, { attr: "val" }) -> value=5, with attributes
     */
    decrement: (
      name: string,
      valueOrAttributes?: number | Record<string, unknown>,
      attributes?: Record<string, unknown>,
    ) => {
      // detect if second argument is attributes (object) vs value (number)
      let finalValue = 1;
      let finalAttrs = attributes;

      if (typeof valueOrAttributes === "object" && valueOrAttributes !== null) {
        // (name, attributes) form - use default value 1
        finalAttrs = valueOrAttributes;
      } else if (typeof valueOrAttributes === "number") {
        // (name, value) or (name, value, attributes) form
        finalValue = valueOrAttributes;
      } else if (valueOrAttributes !== undefined) {
        // invalid type (e.g., string) - pass through for validation to reject
        finalValue = valueOrAttributes as unknown as number;
      }

      // validate inputs according to OTel spec
      const validName = MetricValidation.validateName(name, {
        metricType: "updown",
        scopeName: this.scopeName,
      });
      if (!validName) return;

      const validValue = MetricValidation.validateValue(finalValue, {
        metricType: "updown",
        scopeName: this.scopeName,
      });
      if (validValue === null || validValue < 0) return; // ensure positive value before negating

      const key = createSafeCacheKey(this.scopeName, "updown", validName);
      const cache = this.parentClient.getInstrumentCache();
      let counter = cache.get(key) as
        | UpDownInstrument
        | undefined;
      if (!counter) {
        counter = createSmartUpDownCounter(validName, this.meter);
        cache.set(key, counter);
      }
      // use parent client's sanitizer for consistency with logs and config support
      const sanitized = this.parentClient.sanitizeAttributes(finalAttrs);
      counter.add(-validValue, sanitized);
    },

    /**
     * Record a histogram value (one-step API)
     */
    record: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => {
      // validate inputs according to OTel spec
      const validName = MetricValidation.validateName(name, {
        metricType: "histogram",
        scopeName: this.scopeName,
      });
      if (!validName) return;

      const validValue = MetricValidation.validateValue(value, {
        metricType: "histogram",
        scopeName: this.scopeName,
      });
      if (validValue === null) return;

      const key = createSafeCacheKey(this.scopeName, "histogram", validName);
      const cache = this.parentClient.getInstrumentCache();
      let histogram = cache.get(key) as
        | HistogramInstrument
        | undefined;
      if (!histogram) {
        histogram = createSmartHistogram(validName, this.meter);
        cache.set(key, histogram);
      }
      // use parent client's sanitizer for consistency with logs and config support
      const sanitized = this.parentClient.sanitizeAttributes(attributes);
      histogram.record(validValue, sanitized);
    },

    /**
     * Alias for record() to match README/demo API naming.
     */
    histogram: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => this.metrics.record(name, value, attributes),

    /**
     * Set a gauge value (one-step API)
     */
    gauge: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => {
      // validate inputs according to OTel spec
      const validName = MetricValidation.validateName(name, {
        metricType: "gauge",
        scopeName: this.scopeName,
      });
      if (!validName) return;

      const validValue = MetricValidation.validateValue(value, {
        metricType: "gauge",
        scopeName: this.scopeName,
      });
      if (validValue === null) return;

      const key = createSafeCacheKey(this.scopeName, "gauge", validName);
      const cache = this.parentClient.getInstrumentCache();
      let gauge = cache.get(key) as GaugeInstrument | undefined;
      if (!gauge) {
        gauge = createSmartGauge(validName, this.meter);
        cache.set(key, gauge);
      }
      // use parent client's sanitizer for consistency with logs and config support
      const sanitized = this.parentClient.sanitizeAttributes(attributes);
      gauge.set(validValue, sanitized);
    },

    /**
     * Measure execution time of a function
     */
    timing: async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      const perf = (
        globalThis as unknown as { performance?: { now?: () => number } }
      ).performance;
      const start = perf?.now?.() ?? Date.now();
      try {
        const result = await fn();
        const duration = (perf?.now?.() ?? Date.now()) - start;
        this.metrics.record(`${name}.duration`, duration, { unit: "ms" });
        return result;
      } catch (error) {
        const duration = (perf?.now?.() ?? Date.now()) - start;
        this.metrics.record(`${name}.duration`, duration, {
          unit: "ms",
          error: true,
        });
        throw error;
      }
    },

    /**
     * Create a timer to manually measure duration
     */
    timer: (name: string) => {
      const perf = (
        globalThis as unknown as { performance?: { now?: () => number } }
      ).performance;
      const start = perf?.now?.() ?? Date.now();
      return {
        end: (attributes?: Record<string, unknown>) => {
          const duration = (perf?.now?.() ?? Date.now()) - start;
          this.metrics.record(name, duration, { unit: "ms", ...attributes });
          return duration;
        },
      };
    },
  };

  /**
   * Tracing API - Scoped to this instrumentation
   */
  readonly traces = {
    /**
     * Start a new span
     */
    startSpan: (name: string, options?: SpanOptions) => {
      return this.tracer.startSpan(name, options);
    },

    /**
     * Get the active span
     */
    getActiveSpan: () => trace.getActiveSpan(),

    /**
     * Execute a function within a span
     */
    withSpan: async <T,>(
      name: string,
      fn: () => Promise<T>,
      options?: SpanOptions,
    ): Promise<T> => {
      return this.tracer.startActiveSpan(name, options ?? {}, async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      });
    },

    /**
     * Flush pending spans - delegates to tracer directly
     */
    flush: async (): Promise<void> => {
      // OpenTelemetry tracers don't have a flush method - this is handled by the SDK
      // for now, this is a no-op as span flushing is automatic
      return Promise.resolve();
    },
  };

  /**
   * Logging API - Scoped to this instrumentation
   */
  readonly logs = {
    /**
     * Log an info message
     */
    info: (message: string, attributes?: LogAttributes) => {
      // validate message input
      if (!message || typeof message !== "string") {
        return;
      }
      emitLogEntry(
        this.logger,
        SeverityNumber.INFO,
        "INFO",
        message,
        attributes,
        (attrs) => this.parentClient.sanitizeAttributes(attrs),
      );
    },

    /**
     * Log a warning message
     */
    warn: (message: string, attributes?: LogAttributes) => {
      // validate message input
      if (!message || typeof message !== "string") {
        return;
      }
      emitLogEntry(
        this.logger,
        SeverityNumber.WARN,
        "WARN",
        message,
        attributes,
        (attrs) => this.parentClient.sanitizeAttributes(attrs),
      );
    },

    /**
     * Log a debug message
     */
    debug: (message: string, attributes?: LogAttributes) => {
      // validate message input
      if (!message || typeof message !== "string") {
        return;
      }
      emitLogEntry(
        this.logger,
        SeverityNumber.DEBUG,
        "DEBUG",
        message,
        attributes,
        (attrs) => this.parentClient.sanitizeAttributes(attrs),
      );
    },

    /**
     * Log an error message
     */
    error: (message: string, error?: Error, attributes?: LogAttributes) => {
      // validate message input
      if (!message || typeof message !== "string") {
        return;
      }
      const sanitizedError = this.parentClient.sanitizeError(error);
      const sanitizedAttrs = this.parentClient.sanitizeAttributes(attributes);

      this.logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: message,
        attributes: {
          ...(sanitizedAttrs ?? {}),
          ...getEnrichedLabels(),
          ...(sanitizedError
            ? {
                "error.type": sanitizedError.name,
                "error.message": sanitizedError.message,
                "error.stack": sanitizedError.stack,
                "error.category":
                  categorizeErrorForObservability(sanitizedError),
              }
            : {}),
        },
      });
    },
  };

  /**
   * Result API - For Result pattern integration (scoped to this instrumentation)
   */
  readonly result = {
    /**
     * Trace a function that returns a Result
     */
    trace: async <T,>(
      name: string,
      fn: () => T | Promise<T>,
      options?: SpanOptions,
    ): Promise<T> => {
      return this.tracer.startActiveSpan(name, options ?? {}, async (span) => {
        try {
          const result = await fn();
          const adapter = getResultAdapter(result);
          if (adapter) {
            if (!adapter.isSuccess()) {
              const error = adapter.getError();
              if (error) {
                span.recordException(
                  error instanceof Error ? error : new Error(String(error)),
                );
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message:
                    error instanceof Error ? error.message : String(error),
                });
              }
            } else {
              span.setStatus({ code: SpanStatusCode.OK });
            }
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      });
    },

    /**
     * Record metrics for Result-returning functions
     */
    metrics: async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - start;

        // check if it's a Result type
        const adapter = getResultAdapter(result);
        if (adapter) {
          if (!adapter.isSuccess()) {
            this.metrics.increment(`${name}.failure`, 1);
          } else {
            this.metrics.increment(`${name}.success`, 1);
          }
        }

        this.metrics.record(`${name}.duration`, duration);
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.metrics.increment(`${name}.failure`, 1);
        this.metrics.record(`${name}.duration`, duration);
        throw error;
      }
    },
  };

  /**
   * Error handling API - Scoped to this instrumentation
   */
  readonly errors = {
    /**
     * Capture/record an error with context (scoped)
     */
    capture: (error: Error, context?: Record<string, unknown>) => {
      // handle invalid inputs gracefully
      if (!error || typeof error !== "object") {
        return;
      }

      reportErrorWithInstrumentation(
        error,
        context,
        this.logger,
        this.tracer,
        (err) => this.parentClient.sanitizeError(err),
      );
    },

    /**
     * Record an error with context (alias for capture)
     */
    record: (error: Error, context?: Record<string, unknown>) => {
      // handle invalid inputs gracefully
      if (!error || typeof error !== "object") {
        return;
      }
      this.errors.capture(error, context);
    },

    /**
     * Record a Result type
     */
    recordResult: (result: unknown, context?: Record<string, unknown>) => {
      // handle invalid inputs gracefully
      if (result == null) {
        return;
      }
      reportResultError(result, context);
    },

    /**
     * Categorize an error
     */
    categorize: categorizeErrorForObservability,

    /**
     * Wrap a function with automatic error capture and retry/timeout options
     *
     * Security note: By default, function arguments are NOT captured in error context
     * to prevent leaking sensitive data (passwords, API keys, etc.).
     * Set captureArgs: true only for non-sensitive functions.
     */
    wrap: <T extends (...args: unknown[]) => unknown>(
      fn: T,
      options?: {
        retry?: number;
        timeout?: number;
        name?: string;
        /** Capture function arguments in error context (default: false for security) */
        captureArgs?: boolean;
      },
    ): T => {
      const fnName = options?.name ?? "anonymous";
      const retries = options?.retry ?? 0;
      const timeout = options?.timeout;
      const captureArgs = options?.captureArgs ?? false; // default to false for security

      return ((...args: Parameters<T>) => {
        // if no async options (retry/timeout), handle sync functions synchronously
        if (!retries && !timeout) {
          try {
            const result = fn(...args);

            // if result is already a promise, handle errors on it
            if (isThenable(result)) {
              return result.catch((error) => {
                this.errors.capture(error as Error, {
                  function: fnName,
                  ...(captureArgs && args.length > 0 ? { args } : {}),
                });
                throw error;
              }) as ReturnType<T>;
            }

            // return synchronous result as-is
            return result as ReturnType<T>;
          } catch (error) {
            this.errors.capture(error as Error, {
              function: fnName,
              ...(captureArgs && args.length > 0 ? { args } : {}),
            });
            throw error;
          }
        }

        // async path for retry/timeout options
        const executeWithRetry = async (
          attempt = 0,
        ): Promise<ReturnType<T>> => {
          try {
            let promise = Promise.resolve(fn(...args));

            // apply timeout if specified, with proper cleanup
            if (timeout) {
              let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
              const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(
                  () => reject(new Error("Operation timed out")),
                  timeout,
                );
              });

              // race the function against the timeout, but always clean up the timer
              promise = Promise.race([promise, timeoutPromise]).finally(() => {
                if (timeoutHandle !== undefined) {
                  clearTimeout(timeoutHandle);
                }
              });
            }

            const result = await promise;
            return result as ReturnType<T>;
          } catch (error) {
            const isLastAttempt = attempt >= retries;

            if (isLastAttempt) {
              this.errors.capture(error as Error, {
                function: fnName,
                ...(captureArgs && args.length > 0 ? { args } : {}),
                attempt: attempt + 1,
                totalAttempts: retries + 1,
              });
              throw error;
            }

            // retry on failure
            return executeWithRetry(attempt + 1);
          }
        };

        return executeWithRetry() as ReturnType<T>;
      }) as T;
    },

    /**
     * Create an error boundary with fallback
     */
    boundary: async <T,>(
      fn: () => T | Promise<T>,
      fallback?: (error: Error) => T | Promise<T>,
    ): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        const err = error as Error;
        this.errors.capture(err, { boundary: true });

        if (fallback) {
          return await fallback(err);
        }

        throw error;
      }
    },
  };

  /**
   * Get the raw OpenTelemetry APIs for this scope
   */
  get raw() {
    return {
      meter: this.meter,
      tracer: this.tracer,
      logger: this.logger,
    };
  }
}
