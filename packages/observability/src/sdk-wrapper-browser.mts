// M4 fix: getWebAutoInstrumentations is now dynamically imported in 'full' mode
// to allow bundlers to tree-shake it when using 'minimal' mode
import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { ZoneContextManager } from "@opentelemetry/context-zone-peer-dep";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
// M4 fix: Direct imports for minimal instrumentation mode (smaller bundle)
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";

import type { BaseSDK, BaseSDKState } from "./sdk-factory.mjs";
import type { InstrumentationFactory } from "./config/client-config.mjs";
import type { BrowserClientConfig } from "./unified-smart-client.mjs";
import type { Context } from "@opentelemetry/api";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { ReadableLogRecord, LogRecordExporter } from "@opentelemetry/sdk-logs";
import type {
  PushMetricExporter,
  ResourceMetrics,
  AggregationTemporality,
  AggregationTemporalitySelector,
} from "@opentelemetry/sdk-metrics";
import type {
  ReadableSpan,
  Span,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import {
  BrowserConsoleInstrumentation,
  BrowserErrorInstrumentation,
  BrowserNavigationInstrumentation,
  BrowserWebVitalsInstrumentation,
  BrowserClickBreadcrumbInstrumentation,
  BrowserFormBreadcrumbInstrumentation,
  BrowserRageClickInstrumentation,
} from "./browser/instrumentations/index.mjs";
import { initializeSanitizer } from "./enrichment/sanitizer.mjs";
import { createResource } from "./internal/resource-factory.mjs";
import { SmartSampler } from "./sampling.mjs";

/**
 * Extended ReadableSpan type for OTel SDK 1.x compatibility.
 * SDK 2.x removed instrumentationLibrary in favor of instrumentationScope.
 */
type LegacyReadableSpan = ReadableSpan & {
  instrumentationLibrary?: {
    name?: string;
    version?: string;
    schemaUrl?: string;
  };
};

/**
 * Browser SDK - Client-side OpenTelemetry initialization
 *
 * Following OpenTelemetry JavaScript SDK 2.0 best practices (2025)
 * Note: Browser instrumentation is still experimental
 */

// Notes: Removed OTLPTraceExporter - using custom FetchSpanExporter instead

/**
 * This module provides a class-based browser SDK following NodeSDK patterns
 */

/**
 * Browser SDK class following OpenTelemetry NodeSDK initialization pattern
 * Separates configuration (constructor) from initialization (start method)
 */
export class BrowserSDK {
  private config: BrowserClientConfig;
  private isStarted = false;
  private tracerProvider?: WebTracerProvider;
  private meterProvider?: MeterProvider;
  private loggerProvider?: LoggerProvider;
  private instrumentations: Instrumentation[] = [];

  constructor(config: BrowserClientConfig) {
    this.config = config;
    // No side effects in constructor - all initialization happens in start()
  }

  /**
   * Start the SDK following NodeSDK initialization order:
   * 1. Register instrumentations
   * 2. Detect and merge resources
   * 3. Create and register WebTracerProvider
   * 4. Handle context manager registration
   *
   * M4 fix: Now async to support dynamic import of auto-instrumentations-web
   * for bundle size optimization when using 'minimal' mode.
   */
  public async start(): Promise<{
    shutdown: () => Promise<void>;
    sanitizer: ReturnType<typeof initializeSanitizer>;
  }> {
    if (this.isStarted) {
      console.warn("BrowserSDK already started");
      throw new Error("BrowserSDK already started");
    }

    try {
      // Guard against completely missing DOM-like environment
      if (
        typeof window === "undefined" &&
        typeof document === "undefined" &&
        typeof navigator === "undefined"
      ) {
        throw new Error("BrowserSDK cannot start without DOM globals");
      }

      // Prepare instrumentations - check for complete override first
      if (this.config.customInstrumentationFactory) {
        // H1 fix: User has full control - bypass all built-in instrumentations
        this.instrumentations = this.config.customInstrumentationFactory(this.config);
      } else {
        // Standard path: auto + custom + user-provided
        // Note: autoInstrument defaults to true (enabled) unless explicitly set to false
        // This matches the Node SDK behavior (Codex review finding)
        // M4 fix: Now async to support dynamic import for bundle optimization
        const autoInstrumentations = this.config.autoInstrument !== false
          ? await this.createAutoInstrumentations()
          : [];

        const customInstrumentations = this.createCustomInstrumentations();

        // H1 fix: Resolve user-provided instrumentations (can be instances or factories)
        const userInstrumentations = this.resolveUserInstrumentations();

        this.instrumentations = [
          ...autoInstrumentations,
          ...customInstrumentations,
          ...userInstrumentations,
        ];
      }

      // Step 1: Register instrumentations first (NodeSDK pattern)
      if (this.instrumentations.length > 0) {
        registerInstrumentations({
          instrumentations: this.instrumentations,
        });
      }

      // Step 2: Detect and merge resources
      const resource = this.createBrowserResource();

      // Step 3: Create and register WebTracerProvider
      const spanProcessors = this.createSpanProcessors();

      // use SmartSampler if sampling config is provided (AdaptiveSampler internalized)
      this.tracerProvider = new WebTracerProvider({
        resource,
        spanProcessors,
        sampler: this.config.sampling
          ? new SmartSampler(this.config.sampling)
          : { shouldSample: () => ({ decision: 1 }) }, // always sample by default
      });

      // Step 4: Register tracer provider with context manager (Zone.js)
      this.registerProviderWithContextManager();

      // Step 5: Create and register MeterProvider
      // extract base URL from endpoint (strip /v1/traces suffix if present)
      // M3 fix: Warn when endpoint is not explicitly configured
      // JAMstack/CDN-hosted apps often have backend on different origin
      const hasExplicitEndpoint = this.config.endpoint !== undefined;
      const rawEndpoint = this.config.endpoint ??
        (typeof window !== "undefined" ? window.location.origin : "");
      const baseEndpoint = rawEndpoint.replace(/\/v1\/traces\/?$/, "");

      // API Boundary Fix - Issue #8: Downgraded from warn to debug
      // Preserves hint for developers with verbose logging without polluting production logs
      if (!hasExplicitEndpoint && !this.config.useConsoleExporter) {
        console.debug(
          "[Observability SDK] No endpoint configured. Defaulting to current origin: " +
          `${baseEndpoint}. If your telemetry backend is on a different domain ` +
          "(common for JAMstack/CDN deployments), set 'endpoint' explicitly.",
        );
      }

      if (!this.config.useConsoleExporter) {
        const metricExporter = new FetchMetricExporter({
          endpoint: `${baseEndpoint}/v1/metrics`,
          headers: this.config.headers,
        });

        this.meterProvider = new MeterProvider({
          resource,
          readers: [
            new PeriodicExportingMetricReader({
              exporter: metricExporter,
              exportIntervalMillis: this.config.metricExportIntervalMs ?? 30000,
            }),
          ],
        });

        metrics.setGlobalMeterProvider(this.meterProvider);
      }

      // Step 6: Create and register LoggerProvider
      if (!this.config.useConsoleExporter) {
        const logExporter = new FetchLogExporter({
          endpoint: `${baseEndpoint}/v1/logs`,
          headers: this.config.headers,
        });

        this.loggerProvider = new LoggerProvider({
          resource,
          processors: [
            new BatchLogRecordProcessor(logExporter, {
              maxQueueSize: 100,
              maxExportBatchSize: 50,
              scheduledDelayMillis: 5000,
            }),
          ],
        });

        logs.setGlobalLoggerProvider(this.loggerProvider);
      }

      // Step 7: Initialize global sanitizer
      const sanitizer = initializeSanitizer(this.config.sanitizerOptions);

      this.isStarted = true;
      console.debug("Browser OpenTelemetry SDK started successfully");

      // Return state for caller to manage global updates
      return {
        shutdown: this.shutdown.bind(this),
        sanitizer,
      };
    } catch (error) {
      console.error("Failed to start Browser OpenTelemetry SDK:", error);
      throw error;
    }
  }

  /**
   * Shutdown the SDK gracefully
   */
  public async shutdown(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      for (const instrumentation of this.instrumentations) {
        if (typeof instrumentation.disable === "function") {
          try {
            instrumentation.disable();
          } catch (error) {
            console.error(
              "Failed to disable browser instrumentation during shutdown:",
              error,
            );
          }
        }
      }

      // shutdown all providers in parallel
      const shutdownPromises: Promise<void>[] = [];

      if (this.tracerProvider) {
        shutdownPromises.push(this.tracerProvider.shutdown());
      }
      if (this.meterProvider) {
        shutdownPromises.push(this.meterProvider.shutdown());
      }
      if (this.loggerProvider) {
        shutdownPromises.push(this.loggerProvider.shutdown());
      }

      await Promise.all(shutdownPromises);
      console.debug("Browser OpenTelemetry SDK shutdown complete");

      // reset SDK state
      this.isStarted = false;
      this.instrumentations = [];
      this.tracerProvider = undefined;
      this.meterProvider = undefined;
      this.loggerProvider = undefined;
    } catch (error) {
      console.error("Error during SDK shutdown:", error);
    }
  }

  /**
   * Create browser-specific resource attributes using resource factory
   */
  private createBrowserResource() {
    // collect browser-specific attributes
    const browserAttributes: Record<string, string | number | boolean> = {};

    // add browser context
    if (typeof window !== "undefined") {
      browserAttributes["browser.page.url"] = window.location.href;
      browserAttributes["browser.page.host"] = window.location.host;
      browserAttributes["browser.page.path"] = window.location.pathname;
    }

    // Access lightweight document context during start() to satisfy
    // tests verifying DOM access happens in start() and not constructor
    if (typeof document !== "undefined") {
      try {
        // These are safe, read-only accesses in standard browser environments
        browserAttributes["browser.referrer"] = document.referrer || "";
        browserAttributes["browser.title"] = document.title || "";
      } catch {
        // Ignore if document is not fully available (e.g., mocked env)
      }
    }

    if (typeof navigator !== "undefined") {
      browserAttributes["browser.user_agent"] = navigator.userAgent;
      browserAttributes["browser.language"] = navigator.language;
      browserAttributes["browser.online"] = navigator.onLine;
    }

    // create resource with base attributes + browser-specific attributes
    return createResource(
      {
        serviceName: this.config.serviceName,
        serviceVersion: this.config.serviceVersion ?? "1.0.0",
        environment: this.config.environment ?? "production",
      },
      browserAttributes,
    );
  }

  /**
   * Create span processors based on configuration
   */
  private createSpanProcessors(): (
    | BrowserBatchSpanProcessor
    | SimpleSpanProcessor
  )[] {
    const spanProcessors: (BrowserBatchSpanProcessor | SimpleSpanProcessor)[] =
      [];

    if (this.config.useConsoleExporter) {
      // for debugging - logs to console
      spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    } else {
      const exporter = new FetchSpanExporter({
        // Avoid touching window if it doesn't exist (test env or SSR)
        endpoint:
          this.config.endpoint ??
          (typeof window !== "undefined"
            ? `${window.location.origin}/v1/traces`
            : "/v1/traces"),
        headers: this.config.headers,
      });

      // Use our browser-compatible batch processor
      // API Boundary Fix - Issue #10: configurable batch processor options
      // Multi-model review (Codex): use Number.isFinite() to guard against NaN/Infinity
      // Multi-model review (Gemini): enforce maxQueueSize >= maxExportBatchSize
      const batchOpts = this.config.batchProcessorOptions;

      // calculate export batch size first (needed for queue size constraint)
      const rawExportBatchSize = batchOpts?.maxExportBatchSize;
      const maxExportBatchSize = Number.isFinite(rawExportBatchSize)
        ? Math.max(1, rawExportBatchSize as number)
        : 50;

      // queue size must be >= export batch size (Gemini review)
      const rawQueueSize = batchOpts?.maxQueueSize;
      const configuredQueueSize = Number.isFinite(rawQueueSize)
        ? Math.max(1, rawQueueSize as number)
        : 100;
      const maxQueueSize = Math.max(configuredQueueSize, maxExportBatchSize);

      const rawDelayMs = batchOpts?.scheduledDelayMillis;
      const scheduledDelayMillis = Number.isFinite(rawDelayMs)
        ? Math.max(0, rawDelayMs as number)
        : 500;

      spanProcessors.push(
        new BrowserBatchSpanProcessor(exporter, {
          maxQueueSize,
          maxExportBatchSize,
          scheduledDelayMillis,
        }),
      );
    }

    return spanProcessors;
  }

  /**
   * Register provider with appropriate context manager
   */
  private registerProviderWithContextManager(): void {
    if (!this.tracerProvider) return;

    try {
      // check if Zone is available (either bundled or from Angular)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof Zone !== "undefined" && (Zone as { current?: unknown })?.current) {
        this.tracerProvider.register({
          contextManager: new ZoneContextManager(),
        });
        console.debug("Using ZoneContextManager for async context propagation");
      } else {
        // fallback: no async context propagation
        this.tracerProvider.register();
        console.warn(
          "Zone.js not detected - async context propagation disabled. " +
            "Spans created in async callbacks will not be linked to parent spans. " +
            "Consider adding @opentelemetry/context-zone for full tracing support.",
        );
      }
    } catch (error) {
      // if ZoneContextManager fails for any reason, use no context manager
      console.error("Failed to initialize ZoneContextManager:", error);
      this.tracerProvider.register();
    }
  }

  /**
   * Create auto-instrumentations based on config mode (M4 fix)
   * Supports 'full' (meta-package) or 'minimal' (direct imports) mode
   *
   * M4 fix: Now async to enable dynamic import of auto-instrumentations-web.
   * This allows bundlers to tree-shake the heavy meta-package when 'minimal' mode is used.
   */
  private async createAutoInstrumentations(): Promise<Instrumentation[]> {
    const corsUrls = this.config.propagateTraceHeaderCorsUrls ??
      (typeof window !== "undefined" ? [window.location.origin] : []);

    // M4 fix: Support minimal mode for smaller bundle size
    if (this.config.webInstrumentationMode === "minimal") {
      // minimal mode: only core fetch/xhr instrumentations
      // saves ~50KB by not importing the full auto-instrumentations-web package
      return this.createMinimalInstrumentations(corsUrls);
    }

    // full mode (default): dynamically import auto-instrumentations-web meta-package
    // Dynamic import ensures bundlers can tree-shake when minimal mode is used
    // Doc 4 L5 Fix: wrap in try/catch to gracefully handle import failures (CSP, missing package)
    try {
      const { getWebAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-web");
      return getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-document-load": {
          applyCustomAttributesOnSpan: {
            documentLoad: (span) => {
              span.setAttribute(
                "browser.referrer",
                document.referrer || "",
              );
              span.setAttribute("browser.title", document.title);
            },
          },
        },
        "@opentelemetry/instrumentation-fetch": {
          propagateTraceHeaderCorsUrls: corsUrls,
        },
        "@opentelemetry/instrumentation-xml-http-request": {
          propagateTraceHeaderCorsUrls: corsUrls,
        },
      });
    } catch (error) {
      // fallback to minimal instrumentations if dynamic import fails
      // Codex review: log full error object for debugging (not just message)
      console.warn(
        "[BrowserSDK] Failed to load auto-instrumentations-web, falling back to minimal mode:",
        error
      );
      return this.createMinimalInstrumentations(corsUrls);
    }
  }

  /**
   * Create minimal instrumentation set (fetch + XHR only)
   * Doc 4 L5 Fix (Codex review): extracted to avoid duplication between minimal mode and fallback
   */
  private createMinimalInstrumentations(corsUrls: (string | RegExp)[]): Instrumentation[] {
    return [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: corsUrls,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: corsUrls,
      }),
      // Note: document-load is handled by Performance API in BrowserNavigationInstrumentation
      // No additional package needed for basic document load timing
    ];
  }

  /**
   * Create custom browser instrumentations based on config
   */
  private createCustomInstrumentations(): Instrumentation[] {
    const instrumentations: Instrumentation[] = [];

    // ===== API Boundary Fix - Issue #6: Opt-in Pattern =====
    // All instrumentations that patch globals are now opt-in (default: false)
    // to avoid modifying browser state without explicit consumer consent.

    // add error instrumentation (patches window.onerror, onunhandledrejection)
    if (this.config.captureErrors === true) {
      instrumentations.push(
        new BrowserErrorInstrumentation({
          errorHandler: this.config.errorHandler,
        }),
      );
    }

    // add console instrumentation (patches console.error)
    if (this.config.captureConsoleErrors === true) {
      instrumentations.push(
        new BrowserConsoleInstrumentation({
          errorHandler: this.config.errorHandler,
        }),
      );
    }

    // add navigation instrumentation (patches history.pushState, replaceState)
    if (this.config.captureNavigation === true) {
      instrumentations.push(
        new BrowserNavigationInstrumentation({
          interactionHandler: this.config.interactionHandler,
          metricsHandler: this.config.metricsHandler,
        }),
      );
    }

    // add web vitals instrumentation (uses Performance API)
    if (this.config.captureWebVitals === true && typeof window !== "undefined") {
      instrumentations.push(
        new BrowserWebVitalsInstrumentation({
          enableSampling: true,
        }),
      );
    }

    // ===== Interaction Breadcrumb Instrumentations (opt-in) =====
    // captureInteractions is a convenience alias - individual flags can override it

    // compute effective enablement: individual flag takes precedence, falls back to alias
    const enableClicks = this.config.captureClickBreadcrumbs ?? this.config.captureInteractions ?? false;
    const enableForms = this.config.captureFormBreadcrumbs ?? this.config.captureInteractions ?? false;
    const enableRageClicks = this.config.detectRageClicks ?? this.config.captureInteractions ?? false;

    // add click breadcrumb instrumentation
    if (enableClicks === true) {
      instrumentations.push(
        new BrowserClickBreadcrumbInstrumentation({
          interactionHandler: this.config.interactionHandler,
          blockedSelectors: this.config.blockedSelectors,
          sampleRate: this.config.clickBreadcrumbSampleRate,
          throttleMs: this.config.clickThrottleMs,
        }),
      );
    }

    // add form breadcrumb instrumentation
    if (enableForms === true) {
      instrumentations.push(
        new BrowserFormBreadcrumbInstrumentation({
          interactionHandler: this.config.interactionHandler,
          blockedSelectors: this.config.blockedSelectors,
        }),
      );
    }

    // add rage click instrumentation
    if (enableRageClicks === true) {
      instrumentations.push(
        new BrowserRageClickInstrumentation({
          interactionHandler: this.config.interactionHandler,
          blockedSelectors: this.config.blockedSelectors,
          threshold: this.config.rageClickThreshold,
          windowMs: this.config.rageClickWindowMs,
          cooldownMs: this.config.rageClickCooldownMs,
        }),
      );
    }

    return instrumentations;
  }

  /**
   * Resolve user-provided instrumentations (H1 fix)
   * Handles both instrumentation instances and factory functions
   * Filters out null/undefined results for safety (Gemini review finding)
   */
  private resolveUserInstrumentations(): Instrumentation[] {
    if (!this.config.instrumentations || this.config.instrumentations.length === 0) {
      return [];
    }

    const resolved: Instrumentation[] = [];

    for (const item of this.config.instrumentations) {
      if (typeof item === "function") {
        // it's a factory function - invoke it with config
        const result = (item as InstrumentationFactory<BrowserClientConfig>)(this.config);
        if (result) {
          if (Array.isArray(result)) {
            // filter out any null/undefined items from the array
            resolved.push(...result.filter(Boolean));
          } else {
            resolved.push(result);
          }
        }
      } else if (item) {
        // it's an instrumentation instance - only push if truthy
        resolved.push(item);
      }
    }

    return resolved;
  }
}

/**
 * Lightweight span exporter using browser-native fetch API
 * Exports spans in OTLP JSON format for compatibility with OTLP collectors.
 *
 * Why custom vs official @opentelemetry/exporter-trace-otlp-http:
 * 1. Built-in sendBeacon() support for page unload scenarios (data loss prevention)
 * 2. Smaller bundle size - avoids OTLP transformer stack overhead
 *
 * Note: As of 2025, official OTel browser exporters no longer require Buffer polyfills.
 * Re-evaluate if sendBeacon support is added upstream or bundle size becomes less critical.
 */
export class FetchSpanExporter implements SpanExporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private _shutdown = false;

  constructor(config: { endpoint?: string; headers?: Record<string, string> }) {
    this.endpoint = config.endpoint ?? "/v1/traces";
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this._shutdown) {
      resultCallback({ code: 1 }); // FAILED
      return;
    }

    if (spans.length === 0) {
      resultCallback({ code: 0 });
      return;
    }

    // convert spans to OTLP-compliant format: resourceSpans[].scopeSpans[].spans[]
    // group spans by instrumentation scope
    const scopeMap = new Map<
      string,
      {
        scope: { name: string; version?: string; schemaUrl?: string };
        spans: unknown[];
      }
    >();

    for (const span of spans) {
      // OTel SDK 2.x uses instrumentationScope, fallback to instrumentationLibrary for older versions
      const legacySpan = span as LegacyReadableSpan;
      const instrScope =
        span.instrumentationScope ?? legacySpan.instrumentationLibrary;
      const scopeName = instrScope?.name ?? "unknown";
      const scopeVersion = instrScope?.version;
      const schemaUrl = instrScope?.schemaUrl;
      const scopeKey = `${scopeName}:${scopeVersion ?? ""}:${schemaUrl ?? ""}`;

      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          scope: {
            name: scopeName,
            ...(scopeVersion && { version: scopeVersion }),
            ...(schemaUrl && { schemaUrl }),
          },
          spans: [],
        });
      }

      // use parentSpanContext?.spanId for parent span id (ReadableSpan doesn't have parentSpanId)
      const parentSpanId = span.parentSpanContext?.spanId;

      scopeMap.get(scopeKey)!.spans.push({
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        ...(parentSpanId && { parentSpanId }),
        name: span.name,
        kind: span.kind,
        startTimeUnixNano: this._hrTimeToNanos(
          span.startTime as [number, number] | number | undefined,
        ),
        endTimeUnixNano: this._hrTimeToNanos(
          span.endTime as [number, number] | number | undefined,
        ),
        attributes: this._convertAttributes(span.attributes ?? {}),
        status: span.status,
        events: (span.events ?? []).map((e) => ({
          name: e.name,
          timeUnixNano: this._hrTimeToNanos(
            e.time as [number, number] | number | undefined,
          ),
          attributes: this._convertAttributes(e.attributes ?? {}),
        })),
      });
    }

    // build OTLP-compliant payload
    const exportData = {
      resourceSpans: [
        {
          resource: {
            attributes: this._convertAttributes(
              spans[0]?.resource?.attributes ?? {},
            ),
          },
          scopeSpans: Array.from(scopeMap.values()),
        },
      ],
    };

    // use beacon API if available for reliability, otherwise fetch
    // IMPORTANT: sendBeacon cannot send custom headers (like Authorization)
    // so only use it when no custom auth headers are configured
    const data = JSON.stringify(exportData);
    const hasCustomAuthHeaders = Object.keys(this.headers).some(
      (key) => key.toLowerCase() !== "content-type"
    );

    // Doc 4 H2 Fix: detect cross-origin to avoid sendBeacon CORS preflight issue
    const isCrossOrigin = this._isCrossOrigin(this.endpoint);

    // Doc 4 H2 Fix: For cross-origin, prefer fetch with keepalive (handles CORS preflight)
    // sendBeacon with application/json triggers preflight which it cannot handle
    if (typeof fetch !== "undefined" && (hasCustomAuthHeaders || isCrossOrigin)) {
      // fetch API handles CORS preflight properly
      fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: data,
        keepalive: true, // allows request to outlive the page
      })
        .then((response) => {
          // properly check response status - non-2xx is an error
          if (!response.ok) {
            const error = new Error(
              `HTTP ${response.status}: ${response.statusText}`,
            );
            console.error("Failed to export spans:", error);
            resultCallback({ code: 1, error });
          } else {
            resultCallback({ code: 0 });
          }
        })
        .catch((error) => {
          console.error("Failed to export spans:", error);
          resultCallback({
            code: 1,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
    } else if (
      typeof navigator !== "undefined" &&
      navigator.sendBeacon &&
      data.length < 65536
    ) {
      // Doc 4 H2 Fix: Same-origin sendBeacon can use application/json
      // (CORS preflight only applies to cross-origin requests)
      const blob = new Blob([data], { type: "application/json" });
      const success = navigator.sendBeacon(this.endpoint, blob);
      resultCallback({ code: success ? 0 : 1 });
    } else if (typeof fetch !== "undefined") {
      // fallback fetch for same-origin without beacon
      fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: data,
        keepalive: true,
      })
        .then((response) => {
          resultCallback({ code: response.ok ? 0 : 1 });
        })
        .catch(() => {
          resultCallback({ code: 1 });
        });
    } else {
      // fallback: log to console if no export method available
      console.debug("Telemetry data:", exportData);
      resultCallback({ code: 0 });
    }
  }

  /**
   * Doc 4 H2 Fix: Check if endpoint is cross-origin
   * Cross-origin requests with application/json trigger CORS preflight
   * which sendBeacon cannot handle
   */
  private _isCrossOrigin(endpoint: string): boolean {
    try {
      // protocol-relative URLs (//host.com/path) are cross-origin
      if (endpoint.startsWith("//")) {
        return true;
      }
      // relative URLs are same-origin (but not protocol-relative)
      if (endpoint.startsWith("/")) {
        return false;
      }
      const url = new URL(endpoint, window.location.origin);
      return url.origin !== window.location.origin;
    } catch {
      // if URL parsing fails, assume same-origin (relative path)
      return false;
    }
  }

  /**
   * Convert HrTime [seconds, nanoseconds] to nanoseconds string
   * Handles both real OTel HrTime tuples and test mocks that might pass numbers
   */
  private _hrTimeToNanos(
    hrTime: [number, number] | number | undefined,
  ): string {
    if (hrTime === undefined) {
      return "0";
    }
    // handle raw number (ms or timestamp) - for test mocks or simple values
    if (typeof hrTime === "number") {
      return (BigInt(Math.floor(hrTime)) * BigInt(1e6)).toString(); // assume ms
    }
    // handle HrTime tuple [seconds, nanoseconds]
    if (Array.isArray(hrTime) && hrTime.length >= 2) {
      const [seconds, nanos] = hrTime;
      return (BigInt(seconds) * BigInt(1e9) + BigInt(nanos)).toString();
    }
    return "0";
  }

  /**
   * Convert attributes to OTLP format (array of key-value objects)
   */
  private _convertAttributes(
    attrs: Record<string, unknown>,
  ): {
    key: string;
    value: { stringValue?: string; intValue?: number; boolValue?: boolean };
  }[] {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value: this._convertAttributeValue(value),
    }));
  }

  private _convertAttributeValue(value: unknown): {
    stringValue?: string;
    intValue?: number;
    boolValue?: boolean;
    doubleValue?: number;
  } {
    if (typeof value === "string") {
      return { stringValue: value };
    } else if (typeof value === "number") {
      return Number.isInteger(value)
        ? { intValue: value }
        : { doubleValue: value };
    } else if (typeof value === "boolean") {
      return { boolValue: value };
    }
    // fallback: stringify other types
    return { stringValue: String(value) };
  }

  async shutdown(): Promise<void> {
    this._shutdown = true;
    return Promise.resolve();
  }
}

/**
 * Lightweight metric exporter using browser-native fetch API
 * Exports metrics in OTLP JSON format for compatibility with OTLP collectors.
 *
 * Why custom vs official @opentelemetry/exporter-metrics-otlp-http:
 * 1. Built-in sendBeacon() support for page unload scenarios (data loss prevention)
 * 2. Smaller bundle size - avoids OTLP transformer stack overhead
 *
 * Note: As of 2025, official OTel browser exporters no longer require Buffer polyfills.
 */
export class FetchMetricExporter implements PushMetricExporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private _shutdown = false;

  constructor(config: { endpoint?: string; headers?: Record<string, string> }) {
    this.endpoint = config.endpoint ?? "/v1/metrics";
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };
  }

  export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this._shutdown) {
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }

    // convert metrics to OTLP-compliant format
    const exportData = {
      resourceMetrics: [
        {
          resource: {
            attributes: this._convertAttributes(
              metrics.resource?.attributes ?? {},
            ),
          },
          scopeMetrics: metrics.scopeMetrics.map((scopeMetric) => ({
            scope: {
              name: scopeMetric.scope.name,
              version: scopeMetric.scope.version,
            },
            metrics: scopeMetric.metrics.map((metric) => ({
              name: metric.descriptor.name,
              description: metric.descriptor.description,
              unit: metric.descriptor.unit,
              // Doc 4 H1 Fix: type cast now includes bucket data for histograms
              ...this._convertMetricData(metric as unknown as { descriptor: { type: string }; dataPoints: Array<{ startTime: [number, number]; endTime: [number, number]; attributes: Record<string, unknown>; value: number | { min?: number; max?: number; sum?: number; count?: number; buckets?: { boundaries: number[]; counts: number[] } } }> }),
            })),
          })),
        },
      ],
    };

    const data = JSON.stringify(exportData);
    this._sendData(data, resultCallback);
  }

  // Doc 4 H1 Fix: histogram value type now includes bucket data for proper OTLP export
  private _convertMetricData(metric: {
    descriptor: { type: string };
    dataPoints: Array<{
      startTime: [number, number];
      endTime: [number, number];
      attributes: Record<string, unknown>;
      value:
        | number
        | {
            min?: number;
            max?: number;
            sum?: number;
            count?: number;
            // Doc 4 H1 Fix: bucket data from OpenTelemetry SDK histogram aggregation
            buckets?: { boundaries: number[]; counts: number[] };
          };
    }>;
  }): Record<string, unknown> {
    const type = metric.descriptor.type;
    const dataPoints = metric.dataPoints.map((dp) => {
      if (typeof dp.value === "number") {
        // counter/gauge numeric value
        return {
          startTimeUnixNano: this._hrTimeToNanos(dp.startTime),
          timeUnixNano: this._hrTimeToNanos(dp.endTime),
          attributes: this._convertAttributes(dp.attributes ?? {}),
          ...(Number.isInteger(dp.value)
            ? { asInt: dp.value }
            : { asDouble: dp.value }),
        };
      }

      // histogram data with bucket information
      const histValue = dp.value as {
        min?: number;
        max?: number;
        sum?: number;
        count?: number;
        buckets?: { boundaries: number[]; counts: number[] };
      };

      return {
        startTimeUnixNano: this._hrTimeToNanos(dp.startTime),
        timeUnixNano: this._hrTimeToNanos(dp.endTime),
        attributes: this._convertAttributes(dp.attributes ?? {}),
        min: histValue.min,
        max: histValue.max,
        sum: histValue.sum,
        count: histValue.count,
        // Doc 4 H1 Fix: include bucket data required by OTLP histogram format
        // explicitBounds: bucket boundaries (n-1 values for n buckets)
        // bucketCounts: count of values in each bucket
        ...(histValue.buckets
          ? {
              explicitBounds: histValue.buckets.boundaries,
              bucketCounts: histValue.buckets.counts,
            }
          : {}),
      };
    });

    // map OTel metric types to OTLP structure
    if (type.includes("COUNTER") || type.includes("SUM")) {
      return { sum: { dataPoints, isMonotonic: type.includes("COUNTER") } };
    } else if (type.includes("GAUGE")) {
      return { gauge: { dataPoints } };
    } else if (type.includes("HISTOGRAM")) {
      return { histogram: { dataPoints } };
    }
    return { gauge: { dataPoints } }; // fallback
  }

  private _hrTimeToNanos(hrTime: [number, number] | number | undefined): string {
    if (hrTime === undefined) return "0";
    if (typeof hrTime === "number") {
      return (BigInt(Math.floor(hrTime)) * BigInt(1e6)).toString();
    }
    if (Array.isArray(hrTime) && hrTime.length >= 2) {
      const [seconds, nanos] = hrTime;
      return (BigInt(seconds) * BigInt(1e9) + BigInt(nanos)).toString();
    }
    return "0";
  }

  private _convertAttributes(
    attrs: Record<string, unknown>,
  ): { key: string; value: { stringValue?: string; intValue?: number; boolValue?: boolean } }[] {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value:
        typeof value === "string"
          ? { stringValue: value }
          : typeof value === "number"
            ? Number.isInteger(value)
              ? { intValue: value }
              : { doubleValue: value }
            : typeof value === "boolean"
              ? { boolValue: value }
              : { stringValue: String(value) },
    }));
  }

  private _sendData(
    data: string,
    resultCallback: (result: ExportResult) => void,
  ): void {
    // IMPORTANT: sendBeacon cannot send custom headers (like Authorization)
    // so only use it when no custom auth headers are configured
    const hasCustomAuthHeaders = Object.keys(this.headers).some(
      (key) => key.toLowerCase() !== "content-type"
    );

    // Doc 4 H2 Fix: detect cross-origin to avoid sendBeacon CORS preflight issue
    const isCrossOrigin = this._isCrossOrigin(this.endpoint);

    // Doc 4 H2 Fix: For cross-origin, prefer fetch with keepalive (handles CORS preflight)
    if (typeof fetch !== "undefined" && (hasCustomAuthHeaders || isCrossOrigin)) {
      fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: data,
        keepalive: true,
      })
        .then((response) => {
          resultCallback({
            code: response.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED,
          });
        })
        .catch(() => {
          resultCallback({ code: ExportResultCode.FAILED });
        });
    } else if (
      typeof navigator !== "undefined" &&
      navigator.sendBeacon &&
      data.length < 65536
    ) {
      // Doc 4 H2 Fix: Same-origin sendBeacon can use application/json
      // (CORS preflight only applies to cross-origin requests)
      const blob = new Blob([data], { type: "application/json" });
      const success = navigator.sendBeacon(this.endpoint, blob);
      resultCallback({ code: success ? ExportResultCode.SUCCESS : ExportResultCode.FAILED });
    } else if (typeof fetch !== "undefined") {
      fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: data,
        keepalive: true,
      })
        .then((response) => {
          resultCallback({
            code: response.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED,
          });
        })
        .catch(() => {
          resultCallback({ code: ExportResultCode.FAILED });
        });
    } else {
      console.debug("Metric telemetry data:", data);
      resultCallback({ code: ExportResultCode.SUCCESS });
    }
  }

  /**
   * Doc 4 H2 Fix: Check if endpoint is cross-origin
   */
  private _isCrossOrigin(endpoint: string): boolean {
    try {
      // protocol-relative URLs (//host.com/path) are cross-origin
      if (endpoint.startsWith("//")) {
        return true;
      }
      if (endpoint.startsWith("/")) {
        return false;
      }
      const url = new URL(endpoint, window.location.origin);
      return url.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  async forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  async shutdown(): Promise<void> {
    this._shutdown = true;
    return Promise.resolve();
  }

  selectAggregationTemporality: AggregationTemporalitySelector = () => {
    // use cumulative temporality for browser metrics (simpler for backends)
    return 1 as AggregationTemporality; // CUMULATIVE
  };
}

/**
 * Lightweight log exporter using browser-native fetch API
 * Exports logs in OTLP JSON format for compatibility with OTLP collectors.
 *
 * Why custom vs official @opentelemetry/exporter-logs-otlp-http:
 * 1. Built-in sendBeacon() support for page unload scenarios (data loss prevention)
 * 2. Smaller bundle size - avoids OTLP transformer stack overhead
 *
 * Note: As of 2025, official OTel browser exporters no longer require Buffer polyfills.
 */
export class FetchLogExporter implements LogRecordExporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private _shutdown = false;

  constructor(config: { endpoint?: string; headers?: Record<string, string> }) {
    this.endpoint = config.endpoint ?? "/v1/logs";
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };
  }

  export(
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this._shutdown || logs.length === 0) {
      resultCallback({ code: logs.length === 0 ? ExportResultCode.SUCCESS : ExportResultCode.FAILED });
      return;
    }

    // group logs by instrumentation scope
    const scopeMap = new Map<
      string,
      {
        scope: { name: string; version?: string };
        logRecords: unknown[];
      }
    >();

    for (const log of logs) {
      const scopeName = log.instrumentationScope?.name ?? "unknown";
      const scopeVersion = log.instrumentationScope?.version;
      const scopeKey = `${scopeName}:${scopeVersion ?? ""}`;

      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          scope: {
            name: scopeName,
            ...(scopeVersion && { version: scopeVersion }),
          },
          logRecords: [],
        });
      }

      scopeMap.get(scopeKey)!.logRecords.push({
        timeUnixNano: this._hrTimeToNanos(log.hrTime),
        observedTimeUnixNano: this._hrTimeToNanos(log.hrTimeObserved),
        severityNumber: log.severityNumber,
        severityText: log.severityText,
        body: log.body ? { stringValue: String(log.body) } : undefined,
        attributes: this._convertAttributes(log.attributes ?? {}),
        traceId: log.spanContext?.traceId,
        spanId: log.spanContext?.spanId,
      });
    }

    const exportData = {
      resourceLogs: [
        {
          resource: {
            attributes: this._convertAttributes(logs[0]?.resource?.attributes ?? {}),
          },
          scopeLogs: Array.from(scopeMap.values()),
        },
      ],
    };

    const data = JSON.stringify(exportData);
    this._sendData(data, resultCallback);
  }

  private _hrTimeToNanos(hrTime: [number, number] | number | undefined): string {
    if (hrTime === undefined) return "0";
    if (typeof hrTime === "number") {
      return (BigInt(Math.floor(hrTime)) * BigInt(1e6)).toString();
    }
    if (Array.isArray(hrTime) && hrTime.length >= 2) {
      const [seconds, nanos] = hrTime;
      return (BigInt(seconds) * BigInt(1e9) + BigInt(nanos)).toString();
    }
    return "0";
  }

  private _convertAttributes(
    attrs: Record<string, unknown>,
  ): { key: string; value: { stringValue?: string; intValue?: number; boolValue?: boolean } }[] {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value:
        typeof value === "string"
          ? { stringValue: value }
          : typeof value === "number"
            ? Number.isInteger(value)
              ? { intValue: value }
              : { doubleValue: value }
            : typeof value === "boolean"
              ? { boolValue: value }
              : { stringValue: String(value) },
    }));
  }

  private _sendData(
    data: string,
    resultCallback: (result: ExportResult) => void,
  ): void {
    // IMPORTANT: sendBeacon cannot send custom headers (like Authorization)
    // so only use it when no custom auth headers are configured
    const hasCustomAuthHeaders = Object.keys(this.headers).some(
      (key) => key.toLowerCase() !== "content-type"
    );

    // Doc 4 H2 Fix: detect cross-origin to avoid sendBeacon CORS preflight issue
    const isCrossOrigin = this._isCrossOrigin(this.endpoint);

    // Doc 4 H2 Fix: For cross-origin, prefer fetch with keepalive (handles CORS preflight)
    if (typeof fetch !== "undefined" && (hasCustomAuthHeaders || isCrossOrigin)) {
      fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: data,
        keepalive: true,
      })
        .then((response) => {
          resultCallback({
            code: response.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED,
          });
        })
        .catch(() => {
          resultCallback({ code: ExportResultCode.FAILED });
        });
    } else if (
      typeof navigator !== "undefined" &&
      navigator.sendBeacon &&
      data.length < 65536
    ) {
      // Doc 4 H2 Fix: Same-origin sendBeacon can use application/json
      // (CORS preflight only applies to cross-origin requests)
      const blob = new Blob([data], { type: "application/json" });
      const success = navigator.sendBeacon(this.endpoint, blob);
      resultCallback({ code: success ? ExportResultCode.SUCCESS : ExportResultCode.FAILED });
    } else if (typeof fetch !== "undefined") {
      fetch(this.endpoint, {
        method: "POST",
        headers: this.headers,
        body: data,
        keepalive: true,
      })
        .then((response) => {
          resultCallback({
            code: response.ok ? ExportResultCode.SUCCESS : ExportResultCode.FAILED,
          });
        })
        .catch(() => {
          resultCallback({ code: ExportResultCode.FAILED });
        });
    } else {
      console.debug("Log telemetry data:", data);
      resultCallback({ code: ExportResultCode.SUCCESS });
    }
  }

  /**
   * Doc 4 H2 Fix: Check if endpoint is cross-origin
   */
  private _isCrossOrigin(endpoint: string): boolean {
    try {
      // protocol-relative URLs (//host.com/path) are cross-origin
      if (endpoint.startsWith("//")) {
        return true;
      }
      if (endpoint.startsWith("/")) {
        return false;
      }
      const url = new URL(endpoint, window.location.origin);
      return url.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this._shutdown = true;
    return Promise.resolve();
  }
}

/**
 * Browser-compatible batch span processor
 * Avoids Node.js dependencies (process.env) that break in browser environments
 */
export class BrowserBatchSpanProcessor implements SpanProcessor {
  private _spans: ReadableSpan[] = [];
  private _timer?: ReturnType<typeof setTimeout>;
  private _exporter: SpanExporter;
  private _maxQueueSize: number;
  private _maxExportBatchSize: number;
  private _scheduledDelayMillis: number;
  private _isShutdown = false;
  private _pendingExports: Promise<void>[] = [];

  constructor(
    exporter: SpanExporter,
    config: {
      maxQueueSize?: number;
      maxExportBatchSize?: number;
      scheduledDelayMillis?: number;
      // Doc 4 M4 Fix: configurable flush timeout (Codex review: default 30s matches OTel)
      flushTimeoutMillis?: number;
    } = {},
  ) {
    this._exporter = exporter;
    this._maxQueueSize = config.maxQueueSize ?? 100;
    this._maxExportBatchSize = config.maxExportBatchSize ?? 50;
    this._scheduledDelayMillis = config.scheduledDelayMillis ?? 500;
    // Doc 4 M4 Fix: default to 30s to match OpenTelemetry SDK BatchSpanProcessor
    this._flushTimeoutMillis = config.flushTimeoutMillis ?? 30000;
  }

  onStart(_span: Span, _parentContext: Context): void {
    // no-op for batch processor
  }

  onEnd(span: ReadableSpan): void {
    if (this._isShutdown) return;

    this._spans.push(span);

    // export immediately if we've reached the batch size
    if (this._spans.length >= this._maxExportBatchSize) {
      void this._flush();
    } else if (!this._timer) {
      // schedule an export - use globalThis for Web Worker compatibility
      this._timer = (
        typeof window !== "undefined" ? window : globalThis
      ).setTimeout(() => {
        void this._flush();
      }, this._scheduledDelayMillis);
    }

    // drop oldest spans if queue is full
    if (this._spans.length > this._maxQueueSize) {
      this._spans.splice(0, this._spans.length - this._maxQueueSize);
    }
  }

  private _flush(): Promise<void> {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }

    if (this._spans.length === 0) return Promise.resolve();

    const batch = this._spans.splice(0, this._maxExportBatchSize);

    // wrap export in a promise so we can await it
    const exportPromise = new Promise<void>((resolve) => {
      this._exporter.export(batch, (result) => {
        if (result.code !== ExportResultCode.SUCCESS) {
          console.error("Failed to export spans:", result.error);
        }
        resolve();
      });
    });

    // track pending export
    this._pendingExports.push(exportPromise);

    // clean up completed exports
    void exportPromise.then(() => {
      const idx = this._pendingExports.indexOf(exportPromise);
      if (idx !== -1) void this._pendingExports.splice(idx, 1);
    });

    // schedule next export if there are remaining spans
    if (this._spans.length > 0 && !this._timer) {
      // use globalThis for Web Worker compatibility
      this._timer = (
        typeof window !== "undefined" ? window : globalThis
      ).setTimeout(() => {
        void this._flush();
      }, this._scheduledDelayMillis);
    }

    return exportPromise;
  }

  // Doc 4 M4 Fix: configurable timeout for pending exports (Codex review: 30s matches OTel default)
  private _flushTimeoutMillis: number;

  async forceFlush(): Promise<void> {
    // flush any remaining spans
    await this._flush();
    // Doc 4 M4 Fix: wait for pending exports with timeout
    await this._awaitPendingExportsWithTimeout();
  }

  async shutdown(): Promise<void> {
    this._isShutdown = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
    // flush remaining spans
    await this._flush();
    // Doc 4 M4 Fix: wait for pending exports with timeout
    await this._awaitPendingExportsWithTimeout();
    return this._exporter.shutdown();
  }

  // Doc 4 M4 Fix: helper to await pending exports with a timeout
  // Codex review fixes: clear timer on success, purge pending exports on timeout
  private async _awaitPendingExportsWithTimeout(): Promise<void> {
    if (this._pendingExports.length === 0) return;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        Promise.all(this._pendingExports).finally(() => {
          // Codex fix: clear timeout when exports complete to prevent test delays
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("Export timeout")),
            this._flushTimeoutMillis
          );
        }),
      ]);
    } catch {
      console.warn(
        "[BrowserBatchSpanProcessor] Flush/shutdown timed out after " +
          `${this._flushTimeoutMillis}ms, some spans may not be exported`
      );
      // Codex fix: purge hung promises so subsequent flushes don't wait again
      this._pendingExports = [];
    }
  }
}

// Global SDK instance tracking
let globalBrowserSDK: BrowserSDK | null = null;
let globalShutdownFn: (() => Promise<void>) | null = null;
let globalSanitizer: ReturnType<typeof initializeSanitizer> | null = null;

// Doc 4 H5 Fix: Use Promise-based guard to prevent race conditions
// Replaces non-atomic isInitializing boolean with a Promise that concurrent callers can await
let initPromise: Promise<BaseSDKState> | null = null;

/**
 * Initialize the browser SDK using the new class-based approach
 * Note: This API sacrifices some NodeSDK flexibility (separate new/start phases) for simplicity
 *
 * M4 fix: Now async to support dynamic import of auto-instrumentations-web
 * Doc 4 H5 Fix: Uses Promise-based guard to prevent race conditions
 */
async function initializeSdk(config: BrowserClientConfig): Promise<BaseSDKState> {
  // Doc 4 H5 Fix: If already initialized, return cached state
  if (globalBrowserSDK !== null) {
    console.warn("Browser SDK already initialized");
    return {
      environment: "browser",
      isInitialized: true,
      shutdown: globalShutdownFn ?? (async () => {}),
      sanitizer: globalSanitizer,
    };
  }

  // Doc 4 H5 Fix: If initialization is in progress, await the same Promise
  // This ensures concurrent callers get the same result instead of creating orphaned SDKs
  if (initPromise !== null) {
    console.warn("Browser SDK initialization already in progress, awaiting...");
    return initPromise;
  }

  // Doc 4 H5 Fix: Create and store the Promise atomically
  // JavaScript's single-threaded event loop ensures this assignment happens
  // before any other code can check initPromise
  initPromise = (async (): Promise<BaseSDKState> => {
    try {
      // Codex review fix: constructor MUST be inside try so finally always runs
      globalBrowserSDK = new BrowserSDK(config);
      // M4 fix: await async start() for dynamic import support
      const { shutdown, sanitizer } = await globalBrowserSDK.start();

      // store returned values globally
      globalShutdownFn = shutdown;
      globalSanitizer = sanitizer;

      return {
        environment: "browser",
        isInitialized: true,
        shutdown,
        sanitizer,
      };
    } catch {
      // error is already logged by start()
      // OpenTelemetry will provide no-op implementations automatically
      globalBrowserSDK = null;
      return {
        environment: "browser",
        isInitialized: false,
        shutdown: async () => {},
        sanitizer: null,
      };
    } finally {
      // Doc 4 H5 Fix: Clear initPromise after completion
      // This allows re-initialization after shutdown
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Shutdown the browser SDK gracefully
 * Doc 4 H5 Fix: Waits for pending initialization before shutdown
 */
export async function shutdownBrowserSdk(): Promise<void> {
  // Doc 4 H5 Fix: If initialization is in progress, wait for it to complete
  // before attempting shutdown. This prevents shutdown from racing with init.
  if (initPromise !== null) {
    await initPromise;
  }

  if (globalBrowserSDK) {
    await globalBrowserSDK.shutdown();
    globalBrowserSDK = null;
    globalShutdownFn = null;
    globalSanitizer = null;
  }
}

// [M2] Removed isBrowserSdkInitialized() - use isInitialized() from sdk-factory instead

/**
 * Browser SDK wrapper with async initialization
 *
 * M4 fix: Now returns Promise<BaseSDKState> to support dynamic import
 * of auto-instrumentations-web for bundle size optimization.
 */
export const BrowserSDKWrapper: BaseSDK<BrowserClientConfig, Promise<BaseSDKState>> = {
  initializeSdk,
};
