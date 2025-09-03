/**
 * Test Setup Helpers
 *
 * Eliminates test boilerplate by providing standardized setup/teardown utilities
 * for both browser and node test environments.
 *
 * Why this file exists:
 * - Nearly identical beforeEach/afterEach hooks are duplicated across test files
 * - This is "essential duplication" - the same setup logic repeated verbatim
 * - Refactoring accepted by Gemini 2.5 Pro review (see REFACTORING-ADVISOR-SYNTHESIS.md)
 *
 * Benefits:
 * - Single source of truth for test setup
 * - Changes to setup logic propagate automatically
 * - Easier to write new tests
 * - Reduced cognitive load when reading tests
 */

import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import type {
  BrowserClientConfig,
  NodeClientConfig,
  UnifiedObservabilityClient,
} from "../../unified-smart-client.mjs";

import { SmartClient } from "../../index.mjs";

/**
 * Test context containing client and exporters for assertions
 */
export interface TestContext {
  client: UnifiedObservabilityClient;
  spanExporter: InMemorySpanExporter;
  metricExporter?: InMemoryMetricExporter;
  metricReader?: PeriodicExportingMetricReader;
  timers: NodeJS.Timeout[];
}

/**
 * Setup a Node.js test client with in-memory exporters
 *
 * This helper creates a fully-configured SmartClient instance for testing
 * Node.js-specific functionality. It uses in-memory exporters to avoid
 * network calls and provides access to captured telemetry data.
 *
 * @param config - Optional configuration to override defaults
 * @returns Test context with client, exporters, and timer tracking
 *
 * @example
 * ```typescript
 * describe("My Node Tests", () => {
 *   let testContext: TestContext;
 *
 *   beforeEach(async () => {
 *     testContext = await setupNodeTestClient({
 *       serviceName: "my-test-service"
 *     });
 *   });
 *
 *   afterEach(async () => {
 *     await teardownTestClient(testContext);
 *   });
 *
 *   it("should emit metrics", () => {
 *     testContext.client.metrics.increment("test_counter");
 *     // Assert on testContext.metricExporter
 *   });
 * });
 * ```
 */
export async function setupNodeTestClient(
  config: Partial<NodeClientConfig> = {},
): Promise<TestContext> {
  // create in-memory exporters for test assertions
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 100, // fast export for tests
  });

  // initialize client with test exporters (no network calls)
  const client = await SmartClient.initialize({
    serviceName: config.serviceName ?? "test-service",
    environment: "node",
    disableInstrumentation: true, // avoid auto-instrumentation overhead in tests
    testSpanProcessor: new SimpleSpanProcessor(spanExporter),
    testMetricReader: metricReader,
    ...config,
  });

  return {
    client,
    spanExporter,
    metricExporter,
    metricReader,
    timers: [], // for tracking setTimeout/setInterval in tests
  };
}

/**
 * Setup a browser test client with in-memory exporters
 *
 * This helper creates a SmartClient instance for testing browser-specific
 * functionality. It disables network exporters and uses console exporter
 * for debugging.
 *
 * @param config - Optional configuration to override defaults
 * @returns Test context with client and timer tracking
 *
 * @example
 * ```typescript
 * describe("My Browser Tests", () => {
 *   let testContext: TestContext;
 *
 *   beforeEach(async () => {
 *     testContext = await setupBrowserTestClient({
 *       serviceName: "my-browser-app"
 *     });
 *   });
 *
 *   afterEach(async () => {
 *     await teardownTestClient(testContext);
 *   });
 *
 *   it("should track page views", () => {
 *     // Test browser-specific functionality
 *   });
 * });
 * ```
 */
export async function setupBrowserTestClient(
  config: Partial<BrowserClientConfig> = {},
): Promise<TestContext> {
  // create in-memory span exporter
  const spanExporter = new InMemorySpanExporter();

  // initialize client for browser environment
  const client = await SmartClient.initialize({
    serviceName: config.serviceName ?? "test-service",
    environment: "browser",
    endpoint: undefined, // disable network exports
    useConsoleExporter: false, // disable console noise in tests
    ...config,
  });

  return {
    client,
    spanExporter,
    timers: [],
  };
}

/**
 * Teardown test client and cleanup resources
 *
 * This helper ensures proper cleanup after each test:
 * - Clears all timers (prevents leaks between tests)
 * - Shuts down the SmartClient
 * - Resets exporters
 *
 * @param context - Test context from setup helper
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *   await teardownTestClient(testContext);
 * });
 * ```
 */
export async function teardownTestClient(context: TestContext): Promise<void> {
  // clear all timers to prevent leaks
  context.timers.forEach((timer) => clearTimeout(timer));
  context.timers = [];

  // shutdown client (flushes pending telemetry)
  await SmartClient.shutdown();

  // reset exporters for next test
  if (context.spanExporter) {
    context.spanExporter.reset();
  }

  if (context.metricExporter) {
    context.metricExporter.reset();
  }
}

/**
 * Helper to track timers in tests
 *
 * Use this instead of raw setTimeout/setInterval to ensure timers
 * are properly cleaned up in teardown.
 *
 * @param context - Test context
 * @param callback - Timer callback
 * @param delay - Delay in milliseconds
 * @returns Timer handle
 *
 * @example
 * ```typescript
 * it("should handle delayed operations", async () => {
 *   addTimer(testContext, () => {
 *     testContext.client.metrics.increment("delayed_metric");
 *   }, 100);
 *
 *   await new Promise(resolve => setTimeout(resolve, 150));
 *   // Assert metric was recorded
 * });
 * ```
 */
export function addTimer(
  context: TestContext,
  callback: () => void,
  delay: number,
): NodeJS.Timeout {
  const timer = setTimeout(callback, delay);
  context.timers.push(timer);
  return timer;
}

/**
 * Wait for metric reader to export metrics
 *
 * Useful when testing metric collection with periodic export.
 *
 * @param context - Test context with metric reader
 * @param timeoutMs - Maximum time to wait (default 200ms)
 * @returns Promise that resolves when metrics are exported
 *
 * @example
 * ```typescript
 * it("should export metrics", async () => {
 *   testContext.client.metrics.increment("test_counter");
 *
 *   await waitForMetricExport(testContext);
 *
 *   const metrics = testContext.metricExporter!.getMetrics();
 *   expect(metrics.length).toBeGreaterThan(0);
 * });
 * ```
 */
export async function waitForMetricExport(
  context: TestContext,
  timeoutMs = 200,
): Promise<void> {
  if (!context.metricReader) {
    throw new Error("No metric reader available in context");
  }

  // force flush to trigger immediate export
  await context.metricReader.forceFlush();

  // wait a bit for async export to complete
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

/**
 * Get exported spans from test context
 *
 * Convenience helper to access spans for assertions.
 *
 * @param context - Test context
 * @returns Array of exported spans
 *
 * @example
 * ```typescript
 * it("should create spans", async () => {
 *   await testContext.client.trace("test_span", async () => {
 *     // do work
 *   });
 *
 *   const spans = getExportedSpans(testContext);
 *   expect(spans).toHaveLength(1);
 *   expect(spans[0].name).toBe("test_span");
 * });
 * ```
 */
export function getExportedSpans(context: TestContext) {
  return context.spanExporter.getFinishedSpans();
}

/**
 * Get exported metrics from test context
 *
 * Convenience helper to access metrics for assertions.
 *
 * @param context - Test context
 * @returns Array of exported metrics
 *
 * @example
 * ```typescript
 * it("should record metrics", async () => {
 *   testContext.client.metrics.increment("test_counter", 5);
 *
 *   await waitForMetricExport(testContext);
 *
 *   const metrics = getExportedMetrics(testContext);
 *   expect(metrics.length).toBeGreaterThan(0);
 * });
 * ```
 */
export function getExportedMetrics(context: TestContext) {
  if (!context.metricExporter) {
    throw new Error(
      "No metric exporter available in context (browser tests don't have metrics)",
    );
  }
  return context.metricExporter.getMetrics();
}
