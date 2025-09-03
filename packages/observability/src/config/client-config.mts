/**
 * Configuration interfaces for the Unified Observability Client
 *
 * Provides type-safe configuration options for Node.js and browser environments
 * with discriminated unions for proper TypeScript inference.
 *
 * @module config/client-config
 * @internal
 */

import type { MetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SanitizerOptions } from "../enrichment/sanitizer.mjs";
import type { SmartSamplerConfig } from "../sampling.mjs";
import type { UnifiedObservabilityClient } from "../unified-smart-client.mjs";

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

  /**
   * Provider function for tenant-specific sanitizer configuration.
   * Enables multi-tenant applications to apply different PII rules per tenant and region.
   * @param context - The sanitization context containing tenantId and region
   * @returns Sanitizer options for the given tenant/region, or undefined to use defaults
   */
  tenantSanitizerConfigProvider?: (context: { tenantId?: string; region?: string }) => SanitizerOptions | undefined;

  /** Maximum number of tenant-specific sanitizers to cache (default: 100) */
  maxTenantSanitizers?: number;

  /** Maximum number of cached instruments per client instance (default: 2000) */
  maxCachedInstruments?: number;

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

  // auto-instrumentation options
  captureErrors?: boolean; // capture window.onerror, unhandledrejection
  captureNavigation?: boolean; // capture SPA navigation
  captureConsoleErrors?: boolean; // intercept console.error
  captureWebVitals?: boolean; // capture Core Web Vitals metrics

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
}

/**
 * SmartClientConfig as discriminated union provides type safety by ensuring
 * only valid environment-specific configurations can be used together.
 */
export type SmartClientConfig = NodeClientConfig | BrowserClientConfig;
