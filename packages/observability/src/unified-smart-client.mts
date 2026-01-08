/**
 * Unified Observability Client
 *
 * Single entry point for all observability needs.
 * Wraps OpenTelemetry SDK with smart defaults and enhanced features.
 *
 * ## API Pattern Guide (M6 fix)
 *
 * There are two primary API patterns - choose based on your use case:
 *
 * ### 1. Scoped Instrumentation (RECOMMENDED for modules)
 * Use `client.getInstrumentation()` for module-level telemetry with proper scope attribution.
 * This is the OpenTelemetry-recommended pattern for organizing telemetry by logical module.
 * ```typescript
 * const checkout = client.getInstrumentation("my-app/checkout", "1.0.0");
 * checkout.metrics.increment("orders", 1, { status: "completed" });
 * await checkout.traces.withSpan("process-order", async () => { ... });
 * ```
 *
 * ### 2. Service-Level Convenience (for quick prototyping or simple apps)
 * Use `client.metrics.*`, `client.traces.*`, `client.logs.*` for service-wide telemetry.
 * These are convenience methods that delegate to `getInstrumentation(serviceName)`.
 * ```typescript
 * client.metrics.increment("requests.total", 1);
 * await client.traces.withSpan("handle-request", async () => { ... });
 * ```
 *
 * Both patterns produce valid OpenTelemetry telemetry - the scoped pattern just provides
 * better organization by attributing telemetry to specific modules within your service.
 */

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { LRUCache } from "lru-cache";

// Import extracted modules
import type { SmartClientConfig } from "./config/client-config.mjs";
import type { SmartContext } from "./enrichment/context.mjs";
// Import types and SDK core
import type { Meter, SpanOptions, Tracer } from "@opentelemetry/api";
import type { LogAttributes, Logger } from "@opentelemetry/api-logs";

// Doc 4 M3 Fix: static import replaces dynamic import to avoid CSP issues
// client-instance.mts only has a type-only import from this module, so no circular dependency
import { unregisterInstance } from "./client-instance.mjs";
import {
  addBreadcrumb,
  addTag,
  clearContext,
  ContextEnricher,
  getBusinessContext,
  getOrCreateDefaultEnricher,
  runWithBusinessContext,
  setDefaultEnricher,
  setUser,
} from "./enrichment/context.mjs";
// Import sanitization
import {
  getOrCreateDefaultSanitizerManager,
  sanitize,
  SanitizerManager,
  setDefaultSanitizerManager,
} from "./enrichment/sanitizer.mjs";
import { ScopedInstrument } from "./internal/scoped-instrument.mjs";
import {
  categorizeErrorForObservability,
  createErrorReporter,
  withErrorReporting,
} from "./smart-errors.mjs";
// Import environment utilities
import { detectEnvironment, getProcessEnv } from "./utils/environment.mjs";

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
 * Unified Observability Client
 *
 * Provides a single, comprehensive interface for all observability operations including
 * metrics, tracing, logging, error handling, and context management. Automatically
 * integrates with OpenTelemetry while providing smart defaults and enhanced features.
 *
 * @example
 * ```typescript
 * const config: SmartClientConfig = {
 *   serviceName: "my-service",
 *   environment: "node",
 *   samplingRate: 0.1
 * };
 *
 * const client = await createObservabilityClient(config);
 *
 * // Get scoped instrumentation for your module
 * const apiInstrument = client.getInstrumentation("my-service/api", "1.0.0");
 * const dbInstrument = client.getInstrumentation("my-service/database", "1.0.0");
 *
 * // Record metrics (scoped to module)
 * apiInstrument.metrics.increment("requests.count", 1, { endpoint: "/api/users" });
 *
 * // Trace operations (scoped to module)
 * await dbInstrument.traces.withSpan("query", async () => {
 *   return await db.query("SELECT * FROM users");
 * });
 *
 * // Handle errors (available on client for service-level concerns)
 * client.errors.capture(error, { context: "user-creation" });
 * ```
 *
 * @public
 * @since 1.0.0
 * @see {@link createObservabilityClient} Factory function for creating instances
 */
export class UnifiedObservabilityClient {
  private readonly config: SmartClientConfig;

  // Cache for scoped instrument clients (API Boundary Fix - Issue #10: configurable)
  private readonly scopedClients: LRUCache<string, ScopedInstrument>;

  // Instance-level instrument cache (was previously global)
  // Prevents unbounded memory growth and ensures instance isolation
  private readonly instrumentCache: LRUCache<
    string,
    CounterInstrument | UpDownInstrument | HistogramInstrument | GaugeInstrument
  >;

  // instance-level state management (was previously global)
  private readonly sanitizerManager: SanitizerManager;
  private readonly contextEnricher: ContextEnricher;

  /**
   * Creates a new UnifiedObservabilityClient instance
   *
   * @param config - Configuration object containing service settings and options
   *
   * @internal
   * @remarks
   * This constructor should not be called directly. Use {@link createObservabilityClient} instead.
   */
  constructor(config: SmartClientConfig) {
    this.config = config;

    // API Boundary Fix - Issue #10: configurable scoped client cache
    // Multi-model review (Codex): use Number.isFinite() to guard against NaN/Infinity
    // before Math.max(), then fall back to safe defaults
    const maxScopedClientsRaw = config.maxScopedClients;
    const maxScopedClients = Number.isFinite(maxScopedClientsRaw)
      ? Math.max(1, maxScopedClientsRaw!)
      : 100;
    this.scopedClients = new LRUCache<string, ScopedInstrument>({
      max: maxScopedClients,
    });

    // initialize instrument cache (was global, now instance-level for isolation)
    // API Boundary Fix - Issue #10: configurable TTL
    // Multi-model review (Codex): use Number.isFinite() guard before Math.max()
    const ttlMsRaw = config.instrumentCacheTtlMs;
    const ttlMs = Number.isFinite(ttlMsRaw)
      ? Math.max(0, ttlMsRaw!)
      : 1000 * 60 * 60; // default 1 hour
    const maxCachedInstrumentsRaw = config.maxCachedInstruments;
    const maxCachedInstruments = Number.isFinite(maxCachedInstrumentsRaw)
      ? Math.max(1, maxCachedInstrumentsRaw!)
      : 2000;
    this.instrumentCache = new LRUCache<
      string,
      | CounterInstrument
      | UpDownInstrument
      | HistogramInstrument
      | GaugeInstrument
    >({
      max: maxCachedInstruments,
      ttl: ttlMs === 0 ? undefined : ttlMs, // 0 disables TTL
    });

    // adopt the default sanitizer manager to preserve any config applied before initialization
    // this resolves C3: dual-path sanitizer architecture
    // @see ARCHITECTURE_MULTI_MODEL_REVIEW.md - Issue C3 resolution
    this.sanitizerManager = getOrCreateDefaultSanitizerManager(
      config.sanitizerOptions,
      {
        maxTenantSanitizers: config.maxTenantSanitizers,
        tenantConfigProvider: config.tenantSanitizerConfigProvider,
        contextProvider: () => {
          const businessCtx = getBusinessContext();
          if (businessCtx?.tenantId) {
            return {
              tenantId: businessCtx.tenantId,
              region: businessCtx.region as string | undefined,
            };
          }
          return undefined;
        },
      },
    );
    // set the adopted sanitizer as the default so getGlobalSanitizerManager returns the same instance
    setDefaultSanitizerManager(this.sanitizerManager);

    // adopt the default context enricher to preserve any data added before initialization
    // this resolves C3: dual-path context architecture
    // @see ARCHITECTURE_MULTI_MODEL_REVIEW.md - Issue C3 resolution
    if (config.enrichContext !== false) {
      const env = getProcessEnv();
      const environment = detectEnvironment();

      // get or create the default enricher, then adopt it
      // this ensures breadcrumbs/user/tags added before init are preserved
      this.contextEnricher = getOrCreateDefaultEnricher(
        {
          release: config.serviceName,
          version: config.serviceVersion ?? "0.0.0",
          environment: (env.NODE_ENV ??
            (environment === "browser" ? "production" : "development")) as
            | "production"
            | "staging"
            | "development"
            | "test",
        },
        { sanitizerOptions: config.sanitizerOptions },
      );
      // set the adopted enricher as the default so getGlobalContext returns the same instance
      setDefaultEnricher(this.contextEnricher);
    } else {
      // even when enrichContext is false, adopt any existing default enricher
      this.contextEnricher = getOrCreateDefaultEnricher();
      setDefaultEnricher(this.contextEnricher);
    }
  }

  /**
   * Service-level Metrics API (convenience methods)
   *
   * Convenience proxy to the service-scoped instrumentation metrics.
   * All methods delegate to `getInstrumentation(serviceName).metrics.*`.
   *
   * For better telemetry organization in larger applications, prefer using
   * `client.getInstrumentation("my-app/module-name")` for module-scoped metrics.
   *
   * @see {@link getInstrumentation} for scoped instrumentation (recommended)
   */
  readonly metrics = {
    increment: (
      name: string,
      value = 1,
      attributes?: Record<string, unknown>,
    ) =>
      this.getServiceInstrumentation().metrics.increment(
        name,
        value,
        attributes,
      ),

    decrement: (
      name: string,
      value = 1,
      attributes?: Record<string, unknown>,
    ) =>
      this.getServiceInstrumentation().metrics.decrement(
        name,
        value,
        attributes,
      ),

    record: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) =>
      this.getServiceInstrumentation().metrics.record(name, value, attributes),

    histogram: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) =>
      this.getServiceInstrumentation().metrics.histogram(
        name,
        value,
        attributes,
      ),

    gauge: (
      name: string,
      value: number,
      attributes?: Record<string, unknown>,
    ) =>
      this.getServiceInstrumentation().metrics.gauge(name, value, attributes),

    timing: async <T,>(name: string, fn: () => T | Promise<T>) =>
      this.getServiceInstrumentation().metrics.timing(name, fn),

    timer: (name: string) =>
      this.getServiceInstrumentation().metrics.timer(name),
  };

  /**
   * Service-level Tracing API (convenience methods)
   *
   * Convenience proxy to the service-scoped instrumentation traces.
   * All methods delegate to `getInstrumentation(serviceName).traces.*`.
   *
   * For better telemetry organization in larger applications, prefer using
   * `client.getInstrumentation("my-app/module-name")` for module-scoped tracing.
   *
   * @see {@link getInstrumentation} for scoped instrumentation (recommended)
   */
  readonly traces = {
    startSpan: (name: string, options?: SpanOptions) =>
      this.getServiceInstrumentation().traces.startSpan(name, options),

    getActiveSpan: () =>
      this.getServiceInstrumentation().traces.getActiveSpan(),

    withSpan: async <T,>(
      name: string,
      fn: () => Promise<T>,
      options?: SpanOptions,
    ): Promise<T> =>
      this.getServiceInstrumentation().traces.withSpan(name, fn, options),

    flush: async (): Promise<void> =>
      this.getServiceInstrumentation().traces.flush(),
  };

  /**
   * Get service-level meter from OpenTelemetry APIs
   *
   * API Boundary Fix - Issue #5: Supports "Bring Your Own Provider" mode.
   * If existingMeterProvider is configured, uses that instead of global.
   *
   * @private
   */
  private getMeter(): Meter {
    // API Boundary Fix - Issue #5: Use provided meter provider if configured
    if (this.config.existingMeterProvider) {
      return this.config.existingMeterProvider.getMeter(
        this.config.serviceName,
        this.config.serviceVersion,
      );
    }
    // Default: use globally registered meter provider
    return metrics.getMeter(
      this.config.serviceName,
      this.config.serviceVersion,
    );
  }

  /**
   * Get service-level tracer from OpenTelemetry APIs
   *
   * API Boundary Fix - Issue #5: Supports "Bring Your Own Provider" mode.
   * If existingTracerProvider is configured, uses that instead of global.
   *
   * @private
   */
  private getTracer(): Tracer {
    // API Boundary Fix - Issue #5: Use provided tracer provider if configured
    if (this.config.existingTracerProvider) {
      return this.config.existingTracerProvider.getTracer(
        this.config.serviceName,
        this.config.serviceVersion,
      );
    }
    // Default: use globally registered tracer provider
    return trace.getTracer(this.config.serviceName, this.config.serviceVersion);
  }

  /**
   * Get service-level logger from global OpenTelemetry APIs
   * @private
   */
  private getLogger(): Logger {
    return logs.getLogger(this.config.serviceName, this.config.serviceVersion);
  }

  /**
   * Validates scope name to prevent high-cardinality patterns.
   *
   * API Boundary Fix: Now respects scopeNameValidation config option.
   * Default behavior changed from 'strict' (throw) to 'warn' (log warning).
   *
   * @private
   */
  private validateScopeName(name: string): void {
    const validationMode = this.config.scopeNameValidation ?? "warn";

    // Skip validation entirely if disabled
    if (validationMode === "disabled") {
      return;
    }

    // Patterns that indicate high-cardinality (dynamic) scope names
    const highCardinalityPatterns = [
      { pattern: /user[/_-]\d+/i, description: "user IDs" },
      { pattern: /request[/_-][0-9a-f]{8,}/i, description: "request IDs" },
      {
        pattern:
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
        description: "UUIDs",
      },
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
          console.warn(`[Observability SDK] ${message}`);
        }
        // Only report once per scope name (first matching pattern)
        return;
      }
    }

    // Warn if scope name is suspiciously long (likely contains dynamic data)
    if (name.length > 100) {
      console.warn(
        `[Observability SDK] Scope name is unusually long (${name.length} chars): "${name}". ` +
          `Consider using shorter, static scope names.`,
      );
    }
  }

  /**
   * Get a scoped instrumentation client for a logical module or feature area
   *
   * This follows the OpenTelemetry specification for "Instrumentation Scope", which
   * is different from the overall "Service" identity. The service name (configured during
   * client initialization) represents the entire running application/process, while this
   * method provides scoped attribution to specific modules within that service.
   *
   * Creates properly scoped OpenTelemetry instruments with each scope getting its own
   * meter, tracer, and logger instances for proper telemetry organization, all while
   * sharing the same underlying SDK configuration and resources.
   *
   * **IMPORTANT:** Scope names should be static. Do not include dynamic data like user IDs,
   * request IDs, or UUIDs. Use attributes for high-cardinality data instead.
   *
   * Validation behavior is controlled by `scopeNameValidation` config option:
   * - `'warn'` (default): Logs a warning for high-cardinality patterns but allows the scope
   * - `'strict'`: Throws an error for high-cardinality patterns (legacy behavior)
   * - `'disabled'`: Skips validation entirely
   *
   * @param name - Instrumentation scope identifier (e.g., "my-app/user-service", "@company/http-client", "my-app/checkout")
   * @param version - Version of the instrumented module (optional, defaults to "latest")
   * @returns Scoped instrumentation client with metrics, traces, logs, result, and errors APIs
   *
   * @public
   * @since 2.0.0
   *
   * @example
   * ```typescript
   * // ✅ GOOD - Static module-level scopes
   * const checkout = client.getInstrumentation("my-ecommerce-api/checkout", "1.0.0");
   * const inventory = client.getInstrumentation("my-ecommerce-api/inventory", "1.0.0");
   *
   * // Use attributes for dynamic data
   * checkout.metrics.increment("orders", 1, { userId: "123", method: "stripe" });
   *
   * // ⚠️ NOT RECOMMENDED - High-cardinality scope names (warns by default)
   * const userScope = client.getInstrumentation(`user/${userId}`); // Warning logged
   * const requestScope = client.getInstrumentation(`request/${requestId}`); // Warning logged
   *
   * // To enforce strict validation (throws errors):
   * // initialize({ serviceName: "my-app", scopeNameValidation: "strict", ... })
   * ```
   */
  getInstrumentation(name: string, version?: string): ScopedInstrument {
    // Validate scope name to prevent high-cardinality misuse
    this.validateScopeName(name);

    const scopeKey = `${name}@${version ?? "latest"}`;

    let scoped = this.scopedClients.get(scopeKey);
    if (!scoped) {
      // Create properly scoped OpenTelemetry instruments
      // API Boundary Fix - Issue #5: Use provided providers if configured
      const meter = this.config.existingMeterProvider
        ? this.config.existingMeterProvider.getMeter(name, version)
        : metrics.getMeter(name, version);
      const tracer = this.config.existingTracerProvider
        ? this.config.existingTracerProvider.getTracer(name, version)
        : trace.getTracer(name, version);
      const logger = logs.getLogger(name, version);

      scoped = new ScopedInstrument(meter, tracer, logger, this, scopeKey);
      this.scopedClients.set(scopeKey, scoped);
    }

    return scoped;
  }

  /**
   * Gets the instrumentation client scoped to the service itself.
   *
   * This is the recommended way to emit service-level telemetry, such as
   * startup logs or process-wide metrics. It uses the `serviceName` and
   * `serviceVersion` provided in the client's initial configuration.
   *
   * @returns Scoped instrumentation client for the main service
   * @public
   * @since 2.0.0
   */
  getServiceInstrumentation(): ScopedInstrument {
    return this.getInstrumentation(
      this.config.serviceName,
      this.config.serviceVersion,
    );
  }

  /**
   * Get the instrument cache for this client instance
   * Used by ScopedInstrument to access instance-specific cache
   * @internal
   */
  getInstrumentCache(): LRUCache<
    string,
    CounterInstrument | UpDownInstrument | HistogramInstrument | GaugeInstrument
  > {
    return this.instrumentCache;
  }

  /**
   * Helper method for sanitizing attributes (used by ScopedInstrument)
   * Uses instance sanitizer manager instead of global
   * @internal
   */
  sanitizeAttributes(
    attributes?: Record<string, unknown> | LogAttributes,
  ): Record<string, unknown> | undefined {
    if (this.config.sanitize === false || !attributes) {
      return attributes;
    }

    // use instance sanitizer manager (tenant-aware)
    const ctx = this.sanitizerManager.getContext();
    const sanitizer = this.sanitizerManager.getSanitizer(ctx);
    const sanitized = sanitizer.sanitize(attributes);

    // ensure result is a Record or undefined (sanitize might return primitives)
    return sanitized &&
      typeof sanitized === "object" &&
      !Array.isArray(sanitized)
      ? sanitized
      : undefined;
  }

  /**
   * Helper method for sanitizing errors (used by ScopedInstrument)
   * Uses instance sanitizer manager instead of global
   * @internal
   */
  sanitizeError(error?: Error): Error | undefined {
    if (this.config.sanitize === false || !error) {
      return error;
    }

    // use instance sanitizer manager (tenant-aware)
    const ctx = this.sanitizerManager.getContext();
    const sanitizer = this.sanitizerManager.getSanitizer(ctx);
    return sanitizer.sanitizeError(error);
  }

  /**
   * Service-level Logging API (convenience methods)
   *
   * Convenience proxy to the service-scoped instrumentation logs.
   * All methods delegate to `getInstrumentation(serviceName).logs.*`.
   *
   * Provides structured logging with automatic trace correlation, context enrichment,
   * and PII sanitization. All log entries automatically include trace context when
   * available for seamless correlation with spans and metrics.
   *
   * For better telemetry organization in larger applications, prefer using
   * `client.getInstrumentation("my-app/module-name")` for module-scoped logging.
   *
   * @see {@link getInstrumentation} for scoped instrumentation (recommended)
   *
   * @public
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * // Basic logging (service-level)
   * client.logs.info("User logged in", { userId: "123" });
   * client.logs.warn("Rate limit approaching", { remaining: 10 });
   * client.logs.error("Database connection failed", error, { retries: 3 });
   *
   * // Module-scoped logging (recommended for larger apps)
   * const userModule = client.getInstrumentation("my-app/users");
   * userModule.logs.info("User created", { userId: "123" });
   * ```
   */
  readonly logs = {
    /**
     * Log an info message
     */
    info: (message: string, attributes?: LogAttributes) =>
      this.getServiceInstrumentation().logs.info(message, attributes),

    /**
     * Log a warning message
     */
    warn: (message: string, attributes?: LogAttributes) =>
      this.getServiceInstrumentation().logs.warn(message, attributes),

    /**
     * Log a debug message (development-focused)
     */
    debug: (message: string, attributes?: LogAttributes) =>
      this.getServiceInstrumentation().logs.debug(message, attributes),

    /**
     * Log an error message
     */
    error: (message: string, error?: Error, attributes?: LogAttributes) =>
      this.getServiceInstrumentation().logs.error(message, error, attributes),

    /**
     * Create a scoped error reporter for structured error handling
     *
     * Returns an error reporter helper with `report()` and `reportResult()` methods,
     * not a standard OpenTelemetry Logger. For raw log output, use `info()`, `warn()`,
     * `error()`, or `debug()` methods above.
     *
     * M7 fix: Renamed from `createLogger` to accurately reflect the returned type.
     *
     * @param scope - Logical scope name for error attribution
     * @returns Error reporter with pre-configured scope context
     *
     * @example
     * ```typescript
     * const userErrors = client.logs.createErrorReporter("user-service");
     * userErrors.report(error, { userId: "123" });
     * ```
     */
    createErrorReporter: (scope: string) =>
      createErrorReporter({ defaultContext: { scope } }),
    // [H1] Removed deprecated createLogger() - use createErrorReporter() instead
  };

  /**
   * Error handling API
   * Convenience proxy to the service-scoped instrumentation errors
   *
   * Provides comprehensive error capture, reporting, and correlation with automatic
   * trace context, PII sanitization, and Result type support. Includes retry logic,
   * error categorization, and circuit breaker patterns.
   *
   * @public
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * // Capture errors with context
   * client.errors.capture(error, { userId: "123", action: "login" });
   *
   * // Record Result type errors
   * client.errors.recordResult(result, { operation: "user.create" });
   *
   * // Wrap functions with automatic error capture
   * const safeFunction = client.errors.wrap(riskyFunction, "api.call");
   *
   * // Error boundary with fallback
   * const result = await client.errors.boundary(
   *   () => callExternalAPI(),
   *   (error) => "fallback-value"
   * );
   * ```
   */
  readonly errors = {
    /**
     * Capture/record an error with context
     */
    capture: (error: Error, context?: Record<string, unknown>) =>
      this.getServiceInstrumentation().errors.capture(error, context),

    /**
     * Record an error with context (alias for capture)
     */
    record: (error: Error, context?: Record<string, unknown>) =>
      this.getServiceInstrumentation().errors.record(error, context),

    /**
     * Record a Result type
     */
    recordResult: (result: unknown, context?: Record<string, unknown>) =>
      this.getServiceInstrumentation().errors.recordResult(result, context),

    /**
     * Wrap a function with automatic error capture
     */
    wrap: <T extends (...args: unknown[]) => unknown>(
      fn: T,
      name?: string,
    ): T => this.getServiceInstrumentation().errors.wrap(fn, { name }),

    /**
     * Create an error boundary with fallback
     */
    boundary: async <T,>(
      fn: () => T | Promise<T>,
      fallback: (error: Error) => T | Promise<T>,
    ): Promise<T> =>
      this.getServiceInstrumentation().errors.boundary(fn, fallback),

    /**
     * Wrap a function with error handling (legacy)
     */
    withHandling: withErrorReporting,

    /**
     * Categorize an error
     */
    categorize: categorizeErrorForObservability,
  };

  /**
   * Context API
   *
   * Provides rich application context management with automatic propagation across
   * async boundaries, breadcrumb tracking, user identification, and OpenTelemetry
   * trace context integration. Separated into business and trace concerns for clarity.
   *
   * @public
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * // Business context - application-level data
   * client.context.business.setUser("user-123", {
   *   email: "user@example.com",
   *   tier: "premium"
   * });
   * client.context.business.addBreadcrumb("User clicked login button");
   * await client.context.business.run({ feature: "checkout" }, async () => {
   *   return processPayment();
   * });
   *
   * // Trace context - OpenTelemetry distributed tracing
   * const traceId = client.context.trace.getTraceId();
   * const spanId = client.context.trace.getSpanId();
   *
   * // Convenience: Get all context merged
   * const allContext = client.context.getAll();
   * ```
   */
  readonly context = {
    /**
     * Business Context API
     *
     * Manages application-level context data including user information, breadcrumbs,
     * tags, and custom context values. This context propagates through AsyncLocalStorage
     * (Node.js) or Zone.js (browser) and is included in telemetry data.
     */
    business: {
      /**
       * Run code with specific business context
       * Merges new context with existing context (immutable pattern)
       */
      run: <T,>(
        ctx: SmartContext,
        fn: () => T | Promise<T>,
      ): T | Promise<T> => {
        const currentContext = getBusinessContext();
        const mergedContext = { ...currentContext, ...ctx };
        return runWithBusinessContext(mergedContext, fn);
      },

      /**
       * Set the current user information
       */
      setUser: (
        userId: string | { id: string; email?: string; username?: string },
        attributes?: Record<string, unknown>,
      ) => {
        const sanitized =
          this.config.sanitize !== false && attributes
            ? sanitize(attributes)
            : attributes;

        // ensure sanitized is an object before spreading
        const safeAttributes =
          sanitized &&
          typeof sanitized === "object" &&
          !Array.isArray(sanitized)
            ? sanitized
            : {};

        if (typeof userId === "string") {
          setUser({
            id: userId,
            ...safeAttributes,
          });
        } else {
          setUser({
            ...userId,
            ...safeAttributes,
          });
        }
      },

      /**
       * Add a breadcrumb for navigation/action tracking
       */
      addBreadcrumb: (message: string, data?: Record<string, unknown>) => {
        const sanitized =
          this.config.sanitize !== false ? sanitize(data) : data;

        // ensure sanitized data is a valid Record or undefined
        const safeData =
          sanitized &&
          typeof sanitized === "object" &&
          !Array.isArray(sanitized)
            ? sanitized
            : undefined;

        addBreadcrumb({
          category: "info",
          message,
          level: "info",
          data: safeData,
        });
      },

      /**
       * Add a tag (key-value pair)
       */
      addTag: (key: string, value: string | number | boolean) => {
        addTag(key, String(value));
      },

      /**
       * Get the current business context
       */
      get: getBusinessContext,

      /**
       * Get enriched context (includes breadcrumbs and business context)
       */
      getEnriched: (): Record<string, unknown> => {
        // Get enriched context (includes breadcrumbs) from instance context enricher
        const enrichedContext = this.contextEnricher.getContext();
        // Get business context
        const businessContext = getBusinessContext();
        // Merge both contexts, with business context taking precedence
        const merged = {
          ...enrichedContext,
          ...businessContext,
        } as Record<string, unknown>;

        // For business-context view, do not expose global sessionId unless explicitly set
        if (businessContext && businessContext.sessionId === undefined) {
          delete merged.sessionId;
        }

        return merged;
      },

      /**
       * Create a nested context with additional values
       * Note: This creates a new scope - use within a callback
       */
      withAdditional: <T,>(
        additionalContext: Record<string, unknown>,
        fn: () => T | Promise<T>,
      ): T | Promise<T> => {
        const currentContext = getBusinessContext();
        const merged = { ...currentContext, ...additionalContext };
        return runWithBusinessContext(merged, fn);
      },

      /**
       * Get breadcrumbs from context
       */
      getBreadcrumbs: () => {
        const ctx = this.contextEnricher.getContext();
        return Array.isArray(ctx.breadcrumbs) ? ctx.breadcrumbs : [];
      },

      /**
       * Clear all business context
       */
      clear: clearContext,
    },

    /**
     * Trace Context API
     *
     * Provides access to OpenTelemetry distributed tracing context including trace IDs
     * and span IDs from the currently active span. This context is managed by OpenTelemetry
     * and propagates according to W3C Trace Context specification.
     */
    trace: {
      /**
       * Get the current trace ID from the active span
       * @returns Trace ID in hexadecimal format, or undefined if no active span
       */
      getTraceId: (): string | undefined => {
        const active = trace.getActiveSpan();
        return active?.spanContext().traceId;
      },

      /**
       * Get the current span ID from the active span
       * @returns Span ID in hexadecimal format, or undefined if no active span
       */
      getSpanId: (): string | undefined => {
        const active = trace.getActiveSpan();
        return active?.spanContext().spanId;
      },

      /**
       * Get the active span context
       * @returns The span context object, or undefined if no active span
       */
      getSpanContext: () => {
        const active = trace.getActiveSpan();
        return active?.spanContext();
      },

      /**
       * Check if there is an active span
       * @returns true if there is an active span, false otherwise
       */
      hasActiveSpan: (): boolean => {
        return trace.getActiveSpan() !== undefined;
      },
    },

    /**
     * Get all context merged together (convenience method)
     * Combines business context and trace context into a single object
     *
     * @returns Merged context with both business and trace data
     */
    getAll: (): Record<string, unknown> => {
      const businessCtx = getBusinessContext();
      const enrichedCtx = this.contextEnricher.getContext();
      const traceId = this.context.trace.getTraceId();
      const spanId = this.context.trace.getSpanId();

      return {
        ...enrichedCtx,
        ...businessCtx,
        ...(traceId ? { traceId } : {}),
        ...(spanId ? { spanId } : {}),
      };
    },
  };

  /**
   * Get the raw OpenTelemetry APIs if needed
   *
   * Provides direct access to the underlying OpenTelemetry APIs for advanced use cases
   * that require functionality not exposed through the unified client interface.
   *
   * @returns Object containing raw OpenTelemetry meter, tracer, and logger instances
   *
   * @public
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * const { tracer, meter, logger } = client.raw;
   *
   * // Use raw OTel APIs directly
   * const span = tracer.startSpan("custom.operation");
   * const counter = meter.createCounter("custom.counter");
   * ```
   *
   * @remarks
   * Use this sparingly as it bypasses the enhanced features provided by the unified client.
   * Consider requesting new features instead of using raw APIs extensively.
   */
  /**
   * Convenience trace method
   *
   * Provides a simple way to trace async operations with automatic span lifecycle management.
   * Creates a new span, executes the function within that span's context, and automatically
   * handles success/error status and span cleanup.
   *
   * @param name - The name for the span
   * @param fn - The function to execute within the span
   * @param options - Optional span options
   * @returns The result of the function
   *
   * @public
   * @since 2.0.0
   */
  async trace<T>(
    name: string,
    fn: () => T | Promise<T>,
    options?: SpanOptions,
  ): Promise<T> {
    return this.getTracer().startActiveSpan(
      name,
      options ?? {},
      async (span) => {
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
      },
    );
  }

  /**
   * Get the sanitizer manager instance for this client
   * Allows access to tenant-aware sanitization functionality
   *
   * @returns The sanitizer manager instance
   * @public
   * @since 2.0.0
   */
  getSanitizerManager(): SanitizerManager {
    return this.sanitizerManager;
  }

  /**
   * Get the context enricher instance for this client
   * Allows access to application context enrichment functionality
   *
   * @returns The context enricher instance
   * @public
   * @since 2.0.0
   */
  getContextEnricher(): ContextEnricher {
    return this.contextEnricher;
  }

  get raw() {
    return {
      meter: this.getMeter(),
      tracer: this.getTracer(),
      logger: this.getLogger(),
    };
  }

  // ===== Instance Lifecycle Management (API Boundary Fix - Issue #4) =====

  private _isDestroyed = false;

  /**
   * Check if this client instance has been destroyed
   *
   * @returns True if destroy() has been called on this instance
   * @public
   * @since 2.0.0
   */
  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Destroy this client instance and clean up its resources
   *
   * This method performs instance-level cleanup without affecting the global
   * OpenTelemetry SDK or other client instances. Use this when:
   * - A micro-frontend is being unmounted
   * - A test is completing
   * - A tenant context is ending
   *
   * **What gets cleaned up:**
   * - Instance's instrument cache (counters, gauges, histograms)
   * - Instance's scoped client cache
   * - Instance's registration in the global instance registry
   *
   * **What remains shared (OpenTelemetry architectural limitation):**
   * - The underlying OTel TracerProvider and MeterProvider
   * - Global trace context propagation
   * - Resource attributes (service.name) from first initialization
   * - Other client instances continue to function
   *
   * @example
   * ```typescript
   * const client = await SmartClient.create({ serviceName: 'my-mfe', environment: 'browser' });
   *
   * // Use the client...
   *
   * // When the micro-frontend unmounts:
   * await client.destroy();
   * ```
   *
   * @remarks
   * After calling destroy(), this client instance should not be used.
   * All methods will continue to work but may produce warnings.
   * Create a new instance if you need to reinitialize.
   *
   * @public
   * @since 2.0.0
   */
  destroy(): void {
    if (this._isDestroyed) {
      console.warn("[Observability SDK] Client instance already destroyed");
      return;
    }

    // set flag immediately to block concurrent destroy() calls (race condition fix)
    this._isDestroyed = true;

    // clear instance-level caches
    this.scopedClients.clear();
    this.instrumentCache.clear();

    // Doc 4 M3 Fix: unregister from global instance registry
    // using static import (no circular dependency since client-instance.mts only has type-only imports)
    unregisterInstance(this);

    console.debug(
      `[Observability SDK] Client instance for '${this.config.serviceName}' destroyed`,
    );
  }
}

// Factory function removed - use the one from index.mts which properly handles SDK init

// Export types and configuration functions
export {
  ErrorCategory,
  type ErrorSanitizerPreset,
  configureErrorSanitizer,
  resetErrorSanitizer,
} from "./smart-errors.mjs";
export type { Result } from "@satoshibits/functional-errors";

// Re-export config types and ScopedInstrument from extracted modules
export {
  type SmartClientConfig,
  type SmartClientAPI,
  type BaseClientConfig,
  type NodeClientConfig,
  type BrowserClientConfig,
} from "./config/client-config.mjs";
export { ScopedInstrument } from "./internal/scoped-instrument.mjs";
