/**
 * Mock Observability Client for Testing
 *
 * Provides a test double that captures all telemetry without
 * actually sending data to backends. Essential for unit testing.
 *
 * NOTE: This class does NOT implement UnifiedObservabilityClient to avoid
 * the complexity of mocking full OTel types. Instead, it uses structural
 * typing - TypeScript will check compatibility at usage sites.
 * See mock-client.type-test.ts for compile-time drift detection.
 */

import type { SmartContext } from "../../enrichment/context.mjs";
// Import and re-export canonical types from types.mts
import type {
  RecordedBreadcrumb,
  RecordedError,
  RecordedLog,
  RecordedMetric,
  RecordedSpan,
  RecordedTag,
} from "../../types.mjs";
import type { SmartClientConfig } from "../../unified-smart-client.mjs";
import type { Attributes } from "@opentelemetry/api";

import { ErrorCategory, categorizeErrorForObservability } from "../../smart-errors.mjs";

// Re-export for convenience
export type {
  RecordedMetric,
  RecordedSpan,
  RecordedLog,
  RecordedError,
  RecordedBreadcrumb,
  RecordedTag,
};

/**
 * Mock implementation of ObservabilityClient for testing
 * Only implements the methods that are documented in the README
 */
export class MockObservabilityClient {
  // recorded telemetry
  private _metrics: RecordedMetric[] = [];
  private _spans: RecordedSpan[] = [];
  private _logs: RecordedLog[] = [];
  private _errors: RecordedError[] = [];
  private _breadcrumbs: RecordedBreadcrumb[] = [];
  private _tags: RecordedTag[] = [];
  private _context: SmartContext = {};
  private _user: { id?: string; [key: string]: unknown } | null = null;
  private _traceId: string =
    "trace-" + Math.random().toString(36).substring(2, 11);

  // scope cache for testing
  private _scopeCache = new Map<string, any>();

  // mock config
  private readonly config: SmartClientConfig;

  constructor(config: Partial<SmartClientConfig> = {}) {
    this.config = {
      serviceName: "test-service",
      environment: "node", // Default to node for testing
      ...config,
    } as SmartClientConfig;
  }

  /**
   * Mock Metrics API
   *
   * NOTE: Public API accepts Record<string, unknown> for better DX
   * but we store as-is since OTel's Attributes is compatible at runtime
   */
  readonly metrics = {
    increment: (
      name: string,
      value = 1,
      attributes?: Record<string, unknown>,
    ) => {
      this._metrics.push({
        type: "increment",
        name,
        value,
        attributes: attributes as Attributes, // Runtime compatible - both are objects
        timestamp: Date.now(),
      });
    },

    decrement: (
      name: string,
      value = 1,
      attributes?: Record<string, unknown>,
    ) => {
      this._metrics.push({
        type: "decrement",
        name,
        value,
        attributes: attributes as Attributes, // Runtime compatible
        timestamp: Date.now(),
      });
    },

    record: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => {
      this._metrics.push({
        type: "record",
        name,
        value,
        attributes: attributes as Attributes, // Runtime compatible
        timestamp: Date.now(),
      });
    },

    gauge: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) => {
      this._metrics.push({
        type: "gauge",
        name,
        value,
        attributes: attributes as Attributes, // Runtime compatible
        timestamp: Date.now(),
      });
    },

    timing: async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - start;
        this.metrics.record(`${name}.duration`, duration, { unit: "ms" });
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.metrics.record(`${name}.duration`, duration, {
          unit: "ms",
          error: true,
        });
        throw error;
      }
    },

    timer: (name: string) => {
      const start = Date.now();
      return {
        end: (attributes?: Record<string, unknown>) => {
          const duration = Date.now() - start;
          this.metrics.record(name, duration, { unit: "ms", ...attributes });
          return duration;
        },
      };
    },

    // Test assertion helpers
    hasIncremented: (name: string): boolean => {
      return this._metrics.some(
        (m) => m.type === "increment" && m.name === name,
      );
    },

    getIncrement: (name: string): number | undefined => {
      const matches = this._metrics.filter(
        (m) => m.type === "increment" && m.name === name,
      );
      if (matches.length === 0) return undefined;
      // Sum all increment values for this name
      return matches.reduce((sum, m) => sum + (m.value ?? 0), 0);
    },

    /**
     * Get details of the most recent increment for a metric name
     */
    getIncrementDetails: (
      name: string,
    ): { value: number; attributes?: Attributes } | undefined => {
      const idx = [...this._metrics]
        .reverse()
        .findIndex((m) => m.type === "increment" && m.name === name);
      if (idx === -1) return undefined;
      const record = [...this._metrics].reverse()[idx];
      if (!record) return undefined;
      return { value: record.value ?? 0, attributes: record.attributes };
    },

    hasGauge: (name: string): boolean => {
      return this._metrics.some((m) => m.type === "gauge" && m.name === name);
    },

    getGauge: (name: string): number | undefined => {
      const metric = this._metrics.find(
        (m) => m.type === "gauge" && m.name === name,
      );
      return metric?.value;
    },

    hasRecorded: (name: string): boolean => {
      return this._metrics.some((m) => m.type === "record" && m.name === name);
    },

    getRecorded: (name: string): number | undefined => {
      const metric = this._metrics.find(
        (m) => m.type === "record" && m.name === name,
      );
      return metric?.value;
    },

    incremented: (name: string): boolean => {
      return this.metrics.hasIncremented(name);
    },
  };

  /**
   * Mock Tracing API
   */
  readonly traces = {
    startSpan: (name: string, options?: Record<string, unknown>) => {
      const span: RecordedSpan = {
        name,
        attributes: options?.attributes as Attributes,
        timestamp: Date.now(),
      };
      this._spans.push(span);

      // return mock span object
      return {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        end: () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setStatus: (status: any) => {
          span.status = status.code === 1 ? "OK" : "ERROR";
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAttribute: (key: string, value: any) => {
          span.attributes = { ...span.attributes, [key]: value };
        },
        recordException: (error: Error) => {
          span.error = error;
        },
      };
    },

    withSpan: async <T,>(
      name: string,
      fn: () => Promise<T>,
      options?: Record<string, unknown>,
    ): Promise<T> => {
      const span: RecordedSpan = {
        name,
        attributes: options?.attributes as Attributes,
        timestamp: Date.now(),
      };

      const start = Date.now();
      try {
        const result = await fn();
        span.status = "OK";
        span.duration = Date.now() - start;
        this._spans.push(span);
        return result;
      } catch (error) {
        span.status = "ERROR";
        span.error = error as Error;
        span.duration = Date.now() - start;
        this._spans.push(span);

        // Automatically record errors in traces (as per README)
        this.errors.record(error as Error, { span: name });

        throw error;
      }
    },

    // Required methods from UnifiedObservabilityClient
    getActiveSpan: () => {
      // Return the most recent span as the "active" one for testing
      return this._spans.length > 0
        ? this._spans[this._spans.length - 1]
        : undefined;
    },

    // Test helpers for traces
    getSpans: () => this._spans,

    hasSpan: (name: string): boolean => {
      return this._spans.some((s) => s.name === name);
    },

    getSpan: (name: string): RecordedSpan | undefined => {
      return this._spans.find((s) => s.name === name);
    },
  };

  /**
   * Mock Result API
   */
  readonly result = {
    trace: async <T,>(
      name: string,
      fn: () => T | Promise<T>,
      options?: Record<string, unknown>,
    ): Promise<T> => {
      return this.traces.withSpan(name, fn as () => Promise<T>, options);
    },

    metrics: async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      return this.metrics.timing(name, fn);
    },
  };

  /**
   * Mock Logging API
   * NOTE: Accepts Record<string, unknown> for consistency with main API
   */
  readonly logs = {
    info: (message: string, attributes?: Record<string, unknown>) => {
      this._logs.push({
        level: "info",
        message,
        attributes: attributes as Attributes, // Runtime compatible with LogAttributes
        timestamp: Date.now(),
      });
    },

    warn: (message: string, attributes?: Record<string, unknown>) => {
      this._logs.push({
        level: "warn",
        message,
        attributes: attributes as Attributes, // Runtime compatible
        timestamp: Date.now(),
      });
    },

    error: (
      message: string,
      error?: Error,
      attributes?: Record<string, unknown>,
    ) => {
      this._logs.push({
        level: "error",
        message,
        attributes: attributes as Attributes, // Runtime compatible
        error,
        timestamp: Date.now(),
      });
    },

    debug: (message: string, attributes?: Record<string, unknown>) => {
      this._logs.push({
        level: "debug",
        message,
        attributes: attributes as Attributes, // Runtime compatible
        timestamp: Date.now(),
      });
    },

    // Required method from UnifiedObservabilityClient
    createErrorReporter: (scope: string) => {
      return {
        report: (error: Error, additionalContext?: Record<string, unknown>) => {
          this.errors.capture(error, { scope, ...additionalContext });
        },
        reportResult: <_T, _E extends Error>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result: any, // Result<T, E> from functional-errors
          additionalContext?: Record<string, unknown>,
        ) => {
          // For mock purposes, assume result.isErr() indicates an error

          if (
            result &&
            typeof result === "object" &&
            "isErr" in result &&
            result.isErr?.()
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing
            this.errors.capture(result.error || new Error("Result error"), {
              scope,
              ...additionalContext,
            });
          }
        },
      };
    },

    // Test helper
    getRecorded: () => this._logs,
  };

  /**
   * Mock Error API
   * NOTE: Context uses Record<string, unknown> for flexibility
   */
  readonly errors = {
    capture: (error: Error, context?: Record<string, unknown>) => {
      this._errors.push({
        error,
        context: context as any, // Runtime compatible with Attributes
        timestamp: Date.now(),
      });
    },

    record: (error: Error, context?: Record<string, unknown>) => {
      this.errors.capture(error, context);
    },

    // Test helper - get recorded errors
    getRecorded: () => this._errors,

    // Test helper - get last error as tuple (for backward compatibility)
    getLastError: ():
      | [Error, Record<string, unknown> | undefined]
      | undefined => {
      const lastError = this._errors[this._errors.length - 1];
      if (!lastError) return undefined;
      return [lastError.error, lastError.context as Record<string, unknown>];
    },

    wrap: <T extends (...args: any[]) => any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      fn: T,
      name?: string,
    ): T => {
      return ((...args: Parameters<T>) => {
        try {
          const result = fn(...args);
          if (result instanceof Promise) {
            return result.catch((error) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              this.errors.capture(error, { function: name });
              throw error;
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result;
        } catch (error) {
          this.errors.capture(error as Error, { function: name });
          throw error;
        }
      }) as T;
    },

    boundary: async <T,>(
      fn: () => T | Promise<T>,
      fallback: (error: Error) => T | Promise<T>,
    ): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        this.errors.capture(error as Error, { boundary: true });
        return await fallback(error as Error);
      }
    },

    // Required methods from UnifiedObservabilityClient
    recordResult: <_T, _E extends Error>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: any, // Result<T, E> from functional-errors
      context?: Record<string, unknown>,
    ) => {
      // For mock purposes, assume result.isErr() indicates an error

      if (
        result &&
        typeof result === "object" &&
        "isErr" in result &&
        result.isErr?.()
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing
        this.errors.capture(result.error || new Error("Result error"), context);
      }
    },

    withHandling: <T,>(
      fn: () => T | Promise<T>,
      customContext?: Record<string, unknown>,
    ): T | Promise<T> => {
      try {
        const result = fn();

        if (result instanceof Promise) {
          return result.catch((error) => {
            this.errors.capture(error, customContext);
            throw error;
          }) as T | Promise<T>;
        }

        return result;
      } catch (error) {
        this.errors.capture(error as Error, customContext);
        throw error;
      }
    },

    categorize: categorizeErrorForObservability,
  };

  /**
   * Mock Context API
   */
  readonly context = {
    // business context namespace (new API)
    business: {
      run: <T,>(ctx: SmartContext, fn: () => T): T => {
        const previousContext = this._context;
        this._context = { ...previousContext, ...ctx };
        try {
          return fn();
        } finally {
          this._context = previousContext;
        }
      },

      setUser: (userId: string, attributes?: Record<string, unknown>) => {
        this._user = { id: userId, ...attributes };
      },

      addBreadcrumb: (message: string, data?: Record<string, unknown>) => {
        this._breadcrumbs.push({
          message,
          data,
          timestamp: Date.now(),
        });

        // maintain bounded buffer (max 100 breadcrumbs, matching context enricher default)
        if (this._breadcrumbs.length > 100) {
          this._breadcrumbs.shift(); // remove oldest
        }
      },

      addTag: (key: string, value: string | number | boolean) => {
        this._tags.push({
          key,
          value,
          timestamp: Date.now(),
        });
      },

      set: (key: string, value: unknown) => {
        this._context[key] = value;
      },

      get: () => this._context,

      clear: () => {
        this._context = {};
        this._breadcrumbs = [];
        this._tags = [];
        this._user = null;
      },

      // test helpers
      getBreadcrumbs: () => this._breadcrumbs,
      getTags: () => this._tags,
      getUser: () => this._user,
      getTraceId: () => this._traceId,
    },

    // legacy API (for backward compatibility in tests)
    run: <T,>(ctx: SmartContext, fn: () => T): T => {
      const previousContext = this._context;
      this._context = { ...previousContext, ...ctx };
      try {
        return fn();
      } finally {
        this._context = previousContext;
      }
    },

    setUser: (userId: string, attributes?: Record<string, unknown>) => {
      this._user = { id: userId, ...attributes };
    },

    addBreadcrumb: (message: string, data?: Record<string, unknown>) => {
      this._breadcrumbs.push({
        message,
        data,
        timestamp: Date.now(),
      });

      // maintain bounded buffer (max 100 breadcrumbs, matching context enricher default)
      if (this._breadcrumbs.length > 100) {
        this._breadcrumbs.shift(); // remove oldest
      }
    },

    addTag: (key: string, value: string | number | boolean) => {
      this._tags.push({
        key,
        value,
        timestamp: Date.now(),
      });
    },

    set: (key: string, value: unknown) => {
      this._context[key] = value;
    },

    get: () => this._context,

    clear: () => {
      this._context = {};
      this._breadcrumbs = [];
      this._tags = [];
      this._user = null;
    },

    // test helpers
    getBreadcrumbs: () => this._breadcrumbs,
    getTags: () => this._tags,
    getUser: () => this._user,
    getTraceId: () => this._traceId,
  };

  /**
   * Test helpers - Get recorded telemetry
   */
  getMetrics(): RecordedMetric[] {
    return [...this._metrics];
  }

  getSpans(): RecordedSpan[] {
    return [...this._spans];
  }

  getLogs(): RecordedLog[] {
    return [...this._logs];
  }

  getErrors(): RecordedError[] {
    return [...this._errors];
  }

  /**
   * Test helpers - Query recorded telemetry
   */
  findMetric(name: string): RecordedMetric | undefined {
    return this._metrics.find((m) => m.name === name);
  }

  findSpan(name: string): RecordedSpan | undefined {
    return this._spans.find((s) => s.name === name);
  }

  findLog(message: string): RecordedLog | undefined {
    return this._logs.find((l) => l.message === message);
  }

  /**
   * Top-level trace method (convenience)
   */
  trace = async <T,>(
    name: string,
    fn: () => T | Promise<T>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock flexibility for test options
    options?: any,
  ): Promise<T> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Mock passes through test options as-is
    return this.traces.withSpan(name, fn as () => Promise<T>, options);
  };

  /**
   * Get scoped instrumentation (for testing high-cardinality scope validation)
   * Returns a mock scoped instrument that validates scope names.
   *
   * Respects scopeNameValidation config option (API Boundary fix):
   * - 'warn' (default): Logs warning but allows scope name
   * - 'strict': Throws error for high-cardinality patterns
   * - 'disabled': Skips validation entirely
   */
  getInstrumentation(name: string, version?: string): any {
    // create cache key
    const scopeKey = `${name}@${version ?? "latest"}`;

    // check cache first
    let scoped = this._scopeCache.get(scopeKey);
    if (scoped) {
      return scoped;
    }

    // get validation mode from config (default: 'warn' for API boundary compliance)
    const validationMode = this.config.scopeNameValidation ?? "warn";

    // skip validation if disabled
    if (validationMode !== "disabled") {
      // validate scope name for high-cardinality patterns (same as real client)
      const highCardinalityPatterns = [
        { pattern: /user[/_-]\d+/i, description: "user IDs" },
        { pattern: /request[/_-][0-9a-f]{8,}/i, description: "request IDs" },
        { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, description: "UUIDs" },
        { pattern: /\d{13,}/, description: "timestamps" },
        { pattern: /session[/_-][0-9a-f]{8,}/i, description: "session IDs" },
        { pattern: /tenant[/_-]\d+/i, description: "tenant IDs" },
        { pattern: /customer[/_-]\d+/i, description: "customer IDs" },
      ];

      for (const { pattern, description } of highCardinalityPatterns) {
        if (pattern.test(name)) {
          const message =
            `High-cardinality scope name detected: "${name}" contains ${description}. ` +
            `Scope names should be static module identifiers (e.g., "my-app/checkout"). ` +
            `Use attributes for dynamic data: ` +
            `instrument.metrics.increment("requests", 1, { userId: "123" }). ` +
            `See: https://opentelemetry.io/docs/specs/otel/glossary/#instrumentation-scope`;

          if (validationMode === "strict") {
            throw new Error(message);
          } else {
            // 'warn' mode - log warning but allow the scope name
            console.warn(`[MockObservabilityClient] ${message}`);
          }
          // only report once per scope name
          break;
        }
      }

      // warn for long scope names
      if (name.length > 100) {
        console.warn(
          `[MockObservabilityClient] Scope name is unusually long (${name.length} chars): "${name}". ` +
          `Consider using shorter, static scope names.`
        );
      }
    }

    // create and cache the scoped instrument
    scoped = {
      metrics: this.metrics,
      traces: this.traces,
      logs: this.logs,
      errors: this.errors,
      result: this.result,
      raw: {
        meter: {},
        tracer: {},
        logger: {},
      },
    };

    this._scopeCache.set(scopeKey, scoped);
    return scoped;
  }

  /**
   * Test helper - Clear all recorded telemetry
   */
  reset(): void {
    this._metrics = [];
    this._spans = [];
    this._logs = [];
    this._errors = [];
    this._breadcrumbs = [];
    this._tags = [];
    this._context = {};
    this._user = null;
  }

  /**
   * Test helper - Assert expectations
   */
  assertMetricRecorded(name: string, value?: number): void {
    const metric = this.findMetric(name);
    if (!metric) {
      throw new Error(`Expected metric '${name}' to be recorded`);
    }
    if (value !== undefined && metric.value !== value) {
      throw new Error(
        `Expected metric '${name}' to have value ${value}, got ${metric.value}`,
      );
    }
  }

  assertSpanRecorded(name: string, status?: "OK" | "ERROR"): void {
    const span = this.findSpan(name);
    if (!span) {
      throw new Error(`Expected span '${name}' to be recorded`);
    }
    if (status && span.status !== status) {
      throw new Error(
        `Expected span '${name}' to have status ${status}, got ${span.status}`,
      );
    }
  }

  assertErrorCaptured(message?: string): void {
    if (this._errors.length === 0) {
      throw new Error("Expected at least one error to be captured");
    }
    if (message) {
      const found = this._errors.some((e) => e.error.message === message);
      if (!found) {
        throw new Error(
          `Expected error with message '${message}' to be captured`,
        );
      }
    }
  }
}

/**
 * Factory function to create mock client
 */
export function createMockClient(
  config?: Partial<SmartClientConfig>,
): MockObservabilityClient {
  return new MockObservabilityClient(config);
}

/**
 * Test helper - Run function with mock client
 */
export async function withMockClient<T>(
  fn: (client: MockObservabilityClient) => T | Promise<T>,
  config?: Partial<SmartClientConfig>,
): Promise<{ result: T; client: MockObservabilityClient }> {
  const client = createMockClient(config);
  const result = await fn(client);
  return { result, client };
}
