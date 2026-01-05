/**
 * Configuration interfaces for the Unified Observability Client
 *
 * Provides type-safe configuration options for Node.js and browser environments
 * with discriminated unions for proper TypeScript inference.
 *
 * @module config/client-config
 * @internal
 */

import type { MeterProvider, TracerProvider } from "@opentelemetry/api";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { MetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SanitizationContext, SanitizerOptions } from "../enrichment/sanitizer.mjs";
import type { SmartSamplerConfig } from "../sampling.mjs";
import type { UnifiedObservabilityClient } from "../unified-smart-client.mjs";

/**
 * Factory function type for creating instrumentations dynamically
 * Receives the client config to allow conditional instrumentation setup
 */
export type InstrumentationFactory<T extends BaseClientConfig = BaseClientConfig> =
  (config: T) => Instrumentation | Instrumentation[];

/**
 * Scope name validation mode for getInstrumentation().
 * Controls how the SDK handles potentially high-cardinality scope names.
 */
export type ScopeNameValidationMode = "strict" | "warn" | "disabled";

export interface BaseClientConfig {
  /** Human-readable service name (required) */
  serviceName: string;

  /** Optional semantic/service version */
  serviceVersion?: string;

  /**
   * Sampling rate for tracing (0.0 - 1.0).
   * Optional because some runtimes or instrumentations may ignore it.
   */
  samplingRate?: number;

  /**
   * Scope name validation behavior for getInstrumentation().
   *
   * High-cardinality scope names (containing user IDs, UUIDs, timestamps, etc.)
   * can cause performance issues and metric explosion. This setting controls
   * how the SDK handles such patterns:
   *
   * - `'strict'`: Throw an error when high-cardinality patterns are detected (legacy behavior)
   * - `'warn'`: Log a warning but allow the scope name (default, API boundary compliant)
   * - `'disabled'`: Skip validation entirely (for advanced use cases)
   *
   * @default 'warn'
   */
  scopeNameValidation?: ScopeNameValidationMode;

  /**
   * Smart sampling configuration for intelligent sampling decisions
   * Based on business rules, error conditions, and customer importance
   */
  sampling?: SmartSamplerConfig;

  /** Whether automatic instrumentation should be enabled (where supported).
   * Browser and Node instrumentations may choose to honor this flag.
   */
  autoInstrument?: boolean;

  /**
   * Whether the client should enrich business/context metadata automatically.
   * Kept here because both browser and node SDKs can opt into this behavior.
   */
  enrichContext?: boolean;

  /** Whether to sanitize attributes and errors before sending them to exporters.
   * Accepts boolean (legacy) or an options object for future/sanitizer configuration.
   */
  sanitize?: boolean | Record<string, unknown>;

  // ===== Error Sanitizer Configuration (API Boundary Fix) =====

  /**
   * Preset for error sanitizer configuration.
   *
   * The error sanitizer is used to redact sensitive data from error messages,
   * stack traces, and error details before sending to telemetry backends.
   *
   * - `'strict'` (default): GDPR-compliant with API key, password, and PII detection
   * - `'minimal'`: Only redacts obvious secrets (passwords, API keys, connection strings)
   * - `'none'`: Disables preset-based sanitization. Note: The underlying DataSanitizer
   *   always applies a minimal set of hardcoded patterns for obvious secrets (credit cards,
   *   SSNs, JWTs) regardless of this setting. Use with caution.
   *
   * **Note:** The error sanitizer is currently a global singleton. In multi-client scenarios,
   * the last client to initialize determines the sanitization behavior for all clients.
   * Full per-client isolation will be addressed in a future update.
   *
   * @default 'strict'
   */
  errorSanitizerPreset?: "strict" | "minimal" | "none";

  /**
   * Custom options for error sanitizer.
   * Merged with preset options when provided.
   *
   * Use this to add custom patterns (e.g., vendor-specific API keys)
   * or override preset defaults.
   *
   * @example
   * ```typescript
   * errorSanitizerOptions: {
   *   customPatterns: [
   *     { pattern: /my-secret-\w+/gi, replacement: '[MY_SECRET]' }
   *   ]
   * }
   * ```
   */
  errorSanitizerOptions?: SanitizerOptions;

  /**
   * Provider function for tenant-specific sanitizer configuration.
   * Enables multi-tenant applications to apply different PII rules per tenant and region.
   * @param context - The sanitization context containing tenantId and region
   * @returns Sanitizer options for the given tenant/region, or undefined to use defaults
   */
  tenantSanitizerConfigProvider?: (context: SanitizationContext) => SanitizerOptions | undefined;

  /** Maximum number of tenant-specific sanitizers to cache (default: 100) */
  maxTenantSanitizers?: number;

  /** Maximum number of cached instruments per client instance (default: 2000) */
  maxCachedInstruments?: number;

  // ===== Cache Configuration (API Boundary Fix - Issue #10) =====

  /**
   * Maximum number of scoped instrument clients to cache (default: 100).
   * Each call to `getInstrumentation(name, version)` creates a scoped client
   * with its own tracer, meter, and logger.
   *
   * Increase this if your application has many distinct instrumentation scopes.
   */
  maxScopedClients?: number;

  /**
   * TTL (time-to-live) for cached instruments in milliseconds (default: 3600000 = 1 hour).
   * Instruments not used within this time will be evicted from the cache.
   *
   * Set to 0 to disable TTL (instruments will only be evicted when cache is full).
   */
  instrumentCacheTtlMs?: number;

  // ===== Bring Your Own Provider API (API Boundary Fix - Issue #5) =====

  /**
   * Skip internal SDK initialization (TracerProvider, MeterProvider setup).
   *
   * Use this when integrating with frameworks that already configure OpenTelemetry
   * (e.g., Next.js, NestJS, Vercel OTel). The SDK will use the globally registered
   * providers via `@opentelemetry/api` instead of creating new ones.
   *
   * When enabled:
   * - No TracerProvider or MeterProvider is created by this SDK
   * - The SDK uses `trace.getTracerProvider()` and `metrics.getMeterProvider()` from the API
   * - All instrumentation registration is skipped
   * - Resource attributes and exporters are NOT configured by this SDK
   *
   * This gives consumers full control over OTel configuration while still using
   * the SmartClient API for logging, metrics helpers, and error enrichment.
   *
   * @default false
   */
  skipSdkInitialization?: boolean;

  /**
   * Provide an existing TracerProvider instead of having the SDK create one.
   *
   * This allows integration with frameworks that have already configured tracing
   * (Next.js, Vercel OTel, OpenTelemetry Operator-injected SDKs, etc.)
   *
   * When provided:
   * - Tracers are obtained from this provider for all span creation
   * - If BOTH `existingTracerProvider` AND `existingMeterProvider` are set,
   *   the SDK will skip internal initialization entirely (same as skipSdkInitialization)
   * - The SDK will NOT register this provider globally (caller's responsibility)
   *
   * **Recommended usage patterns:**
   *
   * 1. **Full BYOP mode** - Set both providers to skip all internal setup:
   *    ```typescript
   *    const client = await SmartClient.initialize({
   *      serviceName: 'my-service',
   *      environment: 'node',
   *      existingTracerProvider: myTracerProvider,
   *      existingMeterProvider: myMeterProvider,
   *    });
   *    ```
   *
   * 2. **Skip init, use global providers** - For frameworks that auto-register:
   *    ```typescript
   *    // Framework already called tracerProvider.register()
   *    const client = await SmartClient.initialize({
   *      serviceName: 'my-service',
   *      environment: 'node',
   *      skipSdkInitialization: true, // uses globally registered providers
   *    });
   *    ```
   */
  existingTracerProvider?: TracerProvider;

  /**
   * Provide an existing MeterProvider instead of having the SDK create one.
   *
   * This allows integration with frameworks that have already configured metrics
   * (e.g., OpenTelemetry Collector sidecar, custom metric pipelines).
   *
   * When provided:
   * - Meters are obtained from this provider for all metric recording
   * - If BOTH `existingTracerProvider` AND `existingMeterProvider` are set,
   *   the SDK will skip internal initialization entirely (same as skipSdkInitialization)
   * - The SDK will NOT register this provider globally (caller's responsibility)
   */
  existingMeterProvider?: MeterProvider;

  /** Optional instance id for the running service (useful in multi-instance setups). */
  instanceId?: string;
}

export interface SmartClientAPI {
  /** Initialize the Wrapped OTel SDK then return the client  */
  initialize: (
    config: SmartClientConfig,
  ) => UnifiedObservabilityClient | Promise<UnifiedObservabilityClient>;
  /**
   * Create a client without singleton behavior
   * Useful for testing or multiple instances
   */
  create: (
    config: SmartClientConfig,
  ) => UnifiedObservabilityClient | Promise<UnifiedObservabilityClient>;
  /**
   * Shutdown the SDK gracefully
   */
  shutdown: () => void | Promise<void>;
}

/**
 * Options for process handler behavior when enabled.
 * Allows consumers to customize shutdown behavior while keeping telemetry flushing.
 */
export interface ProcessHandlerOptions {
  /**
   * Timeout (ms) for graceful shutdown on SIGTERM.
   * After this timeout, the onShutdownComplete callback is called regardless.
   * @default 5000
   */
  shutdownTimeoutMs?: number;

  /**
   * Timeout (ms) for flushing telemetry on uncaught exceptions.
   * Shorter than shutdown timeout since process is unstable.
   * @default 2000
   */
  exceptionFlushTimeoutMs?: number;

  /**
   * Callback invoked after SIGTERM shutdown completes (or times out).
   * Consumer controls what happens next (e.g., process.exit, cleanup, restart).
   * If not provided, process continues running - consumer must handle termination.
   */
  onShutdownComplete?: (error?: Error) => void;

  /**
   * Callback invoked after uncaught exception telemetry is flushed.
   * Consumer controls what happens next (e.g., process.exit(1), restart).
   * If not provided, the exception is re-thrown to let Node.js handle it.
   *
   * IMPORTANT: After an uncaught exception, the process is in an unstable state.
   * Most applications should exit. This callback lets you control how.
   */
  onUncaughtException?: (error: Error) => void;

  /**
   * Hook called before shutdown begins, allowing consumer cleanup.
   * Runs before telemetry flush.
   */
  onBeforeShutdown?: () => void | Promise<void>;
}

/**
 * Node-specific config. Extends BaseClientConfig to include NodeSDK options.
 * Keep NodeSDKConfiguration-compatible shapes here when possible.
 */
export interface NodeClientConfig extends BaseClientConfig {
  /** Environment discriminator for type safety */
  environment: "node";

  // Node exporter options (per-signal HTTP paths are common)
  endpoint?: string;
  headers?: Record<string, string>;

  // Prometheus scraping (node-only)
  enablePrometheus?: boolean;
  prometheusPort?: number;

  // PII/PII protection options
  sanitizerOptions?: SanitizerOptions;

  // Testing support - inject custom exporters/processors
  testSpanProcessor?: SpanProcessor;
  testMetricReader?: MetricReader;
  disableInstrumentation?: boolean;

  // ===== Process Handler Options (API Boundary Fix) =====

  /**
   * Enable automatic process signal handlers (SIGTERM, uncaughtException, unhandledRejection).
   *
   * When enabled, the SDK will:
   * - Register a SIGTERM handler that flushes telemetry
   * - Register an uncaughtException handler that records and flushes errors
   * - Register an unhandledRejection handler that records promise rejections
   *
   * IMPORTANT: The SDK will NOT call process.exit(). Consumer controls process termination
   * via the processHandlerOptions callbacks.
   *
   * @default false (opt-in for API boundary compliance)
   */
  enableProcessHandlers?: boolean;

  /**
   * Options for process handler behavior when enableProcessHandlers is true.
   * Allows customizing timeouts and providing callbacks for shutdown/error handling.
   */
  processHandlerOptions?: ProcessHandlerOptions;
}

/**
 * Browser-specific config. Contains browser-safe options only.
 */
export interface BrowserClientConfig extends BaseClientConfig {
  /** Environment discriminator for type safety */
  environment: "browser";

  // Browser must use HTTP/Fetch-compatible endpoints
  endpoint?: string; // typically '/v1/traces' or fully-qualified URL with CORS allowed
  headers?: Record<string, string>;

  // Instrumentation toggles
  /** List of URLs or patterns to which the trace context should be propagated */
  propagateTraceHeaderCorsUrls?: (string | RegExp)[];

  // Debugging/testing
  useConsoleExporter?: boolean;

  // PII/PII protection options
  sanitizerOptions?: SanitizerOptions;

  // ===== Browser Auto-Instrumentation Options (API Boundary Fix - Issue #6) =====
  // All options below are opt-in (default: false) to avoid patching globals without consent.
  // Use RECOMMENDED_BROWSER_INSTRUMENTATION or FULL_BROWSER_INSTRUMENTATION presets
  // to enable commonly-used instrumentations with a single spread.

  /**
   * Capture window.onerror and unhandledrejection events.
   * Patches global error handlers.
   * @default false (opt-in)
   */
  captureErrors?: boolean;

  /**
   * Capture SPA navigation via history.pushState/replaceState.
   * Patches History API methods.
   * @default false (opt-in)
   */
  captureNavigation?: boolean;

  /**
   * Intercept console.error calls as error events.
   * Patches console.error method.
   * @default false (opt-in)
   */
  captureConsoleErrors?: boolean;

  /**
   * Capture Core Web Vitals metrics (LCP, FID, CLS, TTFB, INP).
   * Uses Performance Observer API.
   * @default false (opt-in)
   */
  captureWebVitals?: boolean;

  // ===== Interaction Breadcrumb Options (opt-in) =====

  /**
   * Enable all interaction breadcrumb tracking (clicks, forms, rage clicks).
   * Convenience alias that sets captureClickBreadcrumbs, captureFormBreadcrumbs,
   * and detectRageClicks to true. Individual flags can still override.
   * @default false
   */
  captureInteractions?: boolean;

  /**
   * Capture button/link clicks as breadcrumbs.
   * Useful for understanding user flow before errors.
   * @default false
   */
  captureClickBreadcrumbs?: boolean;

  /**
   * Capture form submissions as breadcrumbs.
   * Captures metadata only (method, action, field count) - never input values.
   * @default false
   */
  captureFormBreadcrumbs?: boolean;

  /**
   * Detect "rage clicks" - rapid repeated clicks on the same element.
   * High-signal indicator of broken UI or slow responses.
   * @default false
   */
  detectRageClicks?: boolean;

  /**
   * Number of clicks within window to trigger rage click detection.
   * @default 3
   */
  rageClickThreshold?: number;

  /**
   * Time window (ms) for counting clicks toward rage detection.
   * @default 800
   */
  rageClickWindowMs?: number;

  /**
   * Cooldown (ms) before emitting another rage click for same element.
   * Prevents flooding telemetry with continuous rage clicks.
   * @default 2000
   */
  rageClickCooldownMs?: number;

  /**
   * Sample rate for click breadcrumbs (0.0 to 1.0).
   * Useful for high-traffic UIs to reduce telemetry volume.
   * @default 1.0 (capture all clicks)
   */
  clickBreadcrumbSampleRate?: number;

  /**
   * Selectors/patterns to block from breadcrumb capture.
   * Elements matching these patterns will be ignored.
   *
   * **Important:** Patterns are matched against the *sanitized* selector (after PII removal).
   * For example, an element with id="user-12345" becomes "tag#[id]" after sanitization.
   *
   * For reliable blocking, use `data-observability-block` attribute on elements.
   *
   * @example [".private-data", /payment/i, "#[uuid]"]
   */
  blockedSelectors?: (string | RegExp)[];

  // custom handlers for testing
  errorHandler?: (error: Error, context?: Record<string, unknown>) => void;
  interactionHandler?: (type: string, data?: Record<string, unknown>) => void;
  metricsHandler?: (
    name: string,
    value: number,
    attributes?: Record<string, unknown>,
  ) => void;

  // Performance options
  clickThrottleMs?: number; // Throttle clicks (default: 500ms)

  /**
   * Interval (ms) for exporting browser metrics.
   * @default 30000 (30 seconds)
   */
  metricExportIntervalMs?: number;

  // ===== Batch Processor Configuration (API Boundary Fix - Issue #10) =====

  /**
   * Options for the span batch processor.
   * Controls how spans are batched before export to reduce network overhead.
   */
  batchProcessorOptions?: {
    /**
     * Maximum queue size for pending spans.
     * Spans exceeding this limit will be dropped.
     * @default 100
     */
    maxQueueSize?: number;

    /**
     * Maximum number of spans to include in a single export batch.
     * Larger batches reduce network overhead but increase latency.
     * @default 50
     */
    maxExportBatchSize?: number;

    /**
     * Scheduled delay (ms) between batch exports.
     * Lower values provide more real-time data but increase network traffic.
     * @default 500
     */
    scheduledDelayMillis?: number;
  };

  // ===== Bundle Size Optimization (M4 fix) =====

  /**
   * Controls which web instrumentations are included from OpenTelemetry.
   *
   * - `'full'` (default): Uses `@opentelemetry/auto-instrumentations-web` meta-package.
   *   Includes all available web instrumentations (~50KB additional bundle size).
   *
   * - `'minimal'`: Uses only core instrumentations directly:
   *   - `@opentelemetry/instrumentation-fetch` (fetch API tracing)
   *   - `@opentelemetry/instrumentation-xml-http-request` (XHR tracing)
   *   - Document load timing (via Performance API, no extra package needed)
   *   This reduces bundle size significantly for applications that don't need
   *   the full instrumentation suite.
   *
   * Note: Custom instrumentations via `instrumentations` or `customInstrumentationFactory`
   * are always included regardless of this setting.
   *
   * @default 'full'
   */
  webInstrumentationMode?: "full" | "minimal";

  // ===== Extension/Plugin Architecture (H1 fix) =====

  /**
   * User-provided instrumentations to add alongside built-in ones.
   * These are registered in addition to auto/custom instrumentations.
   * @example
   * instrumentations: [
   *   new MyCustomInstrumentation(),
   *   (config) => new AnotherInstrumentation({ serviceName: config.serviceName }),
   * ]
   */
  instrumentations?: (Instrumentation | InstrumentationFactory<BrowserClientConfig>)[];

  /**
   * Complete override of instrumentation creation.
   * When provided, built-in instrumentations are NOT created - you control everything.
   * Use this for advanced use cases where you need full control over instrumentation setup.
   * @example
   * customInstrumentationFactory: (config) => [
   *   new MyOnlyInstrumentation(),
   * ]
   */
  customInstrumentationFactory?: (config: BrowserClientConfig) => Instrumentation[];
}

/**
 * SmartClientConfig as discriminated union provides type safety by ensuring
 * only valid environment-specific configurations can be used together.
 */
export type SmartClientConfig = NodeClientConfig | BrowserClientConfig;

// ===== Entry-point-specific configs (H3 fix) =====
// These types don't require the `environment` field since it's inferred from the import path

/**
 * Browser config type for users importing from `@satoshibits/observability/browser`.
 * Environment is automatically injected - users don't need to specify it.
 */
export type BrowserClientUserConfig = Omit<BrowserClientConfig, "environment">;

/**
 * Node config type for users importing from `@satoshibits/observability` or `/node`.
 * Environment is automatically injected - users don't need to specify it.
 */
export type NodeClientUserConfig = Omit<NodeClientConfig, "environment">;

// ===== Browser Instrumentation Presets (API Boundary Fix - Issue #6) =====

/**
 * Recommended browser instrumentation configuration.
 *
 * After API Boundary Fix Issue #6, all browser instrumentations that patch globals
 * are opt-in by default. This preset provides a convenient way to enable all
 * recommended instrumentations at once.
 *
 * @example
 * ```typescript
 * import { SmartClient, RECOMMENDED_BROWSER_INSTRUMENTATION } from '@satoshibits/observability/browser';
 *
 * const client = await SmartClient.initialize({
 *   serviceName: 'my-app',
 *   ...RECOMMENDED_BROWSER_INSTRUMENTATION,
 * });
 * ```
 */
export const RECOMMENDED_BROWSER_INSTRUMENTATION = {
  /** Capture window.onerror and unhandledrejection events */
  captureErrors: true,
  /** Capture console.error calls */
  captureConsoleErrors: true,
  /** Capture SPA navigation (history.pushState/replaceState) */
  captureNavigation: true,
  /** Capture Core Web Vitals metrics (LCP, FID, CLS, etc.) */
  captureWebVitals: true,
} as const satisfies Partial<BrowserClientConfig>;

/**
 * Full browser instrumentation configuration including interaction tracking.
 *
 * Extends RECOMMENDED_BROWSER_INSTRUMENTATION with click breadcrumbs, form tracking,
 * and rage click detection for comprehensive user interaction visibility.
 *
 * @example
 * ```typescript
 * import { SmartClient, FULL_BROWSER_INSTRUMENTATION } from '@satoshibits/observability/browser';
 *
 * const client = await SmartClient.initialize({
 *   serviceName: 'my-app',
 *   ...FULL_BROWSER_INSTRUMENTATION,
 * });
 * ```
 */
export const FULL_BROWSER_INSTRUMENTATION = {
  ...RECOMMENDED_BROWSER_INSTRUMENTATION,
  /** Capture all interaction breadcrumbs (clicks, forms, rage clicks) */
  captureInteractions: true,
} as const satisfies Partial<BrowserClientConfig>;
