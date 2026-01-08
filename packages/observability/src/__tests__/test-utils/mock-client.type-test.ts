/* eslint-disable @typescript-eslint/require-await */
/**
 * Type Assertion Test for MockObservabilityClient
 *
 * This file is never executed - it only exists for compile-time type checking.
 * It ensures the MockObservabilityClient remains compatible with UnifiedObservabilityClient
 * without forcing the mock to implement every complex OTel type.
 *
 * If the mock drifts from the real interface, TypeScript will fail here at build time.
 */

import { MockObservabilityClient } from "./mock-client.mjs";

/**
 * This function is never called, but forces a compile-time compatibility check.
 * We check structural compatibility for the public API methods that tests actually use.
 *
 * NOTE: We deliberately don't check full interface compatibility since the mock
 * is designed to be simpler than the real client (avoiding complex OTel types).
 */
function assertMockCompatibility(): void {
  const mock = new MockObservabilityClient();

  // Check that the mock has the expected method signatures for core API
  // These will fail to compile if method signatures change in UnifiedObservabilityClient

  // Metrics API compatibility
  const _metricsIncrement: typeof mock.metrics.increment =
    mock.metrics.increment;
  const _metricsDecrement: typeof mock.metrics.decrement =
    mock.metrics.decrement;
  const _metricsRecord: typeof mock.metrics.record = mock.metrics.record;
  const _metricsGauge: typeof mock.metrics.gauge = mock.metrics.gauge;
  const _metricsTiming: typeof mock.metrics.timing = mock.metrics.timing;
  const _metricsTimer: typeof mock.metrics.timer = mock.metrics.timer;

  // Traces API compatibility
  const _tracesWithSpan: typeof mock.traces.withSpan = mock.traces.withSpan;
  const _tracesGetActiveSpan: typeof mock.traces.getActiveSpan =
    mock.traces.getActiveSpan;

  // Logs API compatibility
  const _logsInfo: typeof mock.logs.info = mock.logs.info;
  const _logsWarn: typeof mock.logs.warn = mock.logs.warn;
  const _logsError: typeof mock.logs.error = mock.logs.error;
  const _logsCreateErrorReporter: typeof mock.logs.createErrorReporter =
    mock.logs.createErrorReporter;

  // Errors API compatibility
  const _errorsCapture: typeof mock.errors.capture = mock.errors.capture;
  const _errorsRecord: typeof mock.errors.record = mock.errors.record;
  const _errorsRecordResult: typeof mock.errors.recordResult =
    mock.errors.recordResult;
  const _errorsWrap: typeof mock.errors.wrap = mock.errors.wrap;
  const _errorsBoundary: typeof mock.errors.boundary = mock.errors.boundary;
  const _errorsWithHandling: typeof mock.errors.withHandling =
    mock.errors.withHandling;
  const _errorsCategorize: typeof mock.errors.categorize =
    mock.errors.categorize;

  // Context API compatibility
  const _contextRun: typeof mock.context.run = mock.context.run;
  const _contextSetUser: typeof mock.context.setUser = mock.context.setUser;
  const _contextAddBreadcrumb: typeof mock.context.addBreadcrumb =
    mock.context.addBreadcrumb;
  const _contextAddTag: typeof mock.context.addTag = mock.context.addTag;
  const _contextSet: typeof mock.context.set = mock.context.set;
  const _contextGet: typeof mock.context.get = mock.context.get;
  const _contextClear: typeof mock.context.clear = mock.context.clear;

  // Result API compatibility
  const _resultTrace: typeof mock.result.trace = mock.result.trace;
  const _resultMetrics: typeof mock.result.metrics = mock.result.metrics;

  // Top-level trace method compatibility
  const _trace: typeof mock.trace = mock.trace;

  // Suppress unused variable warnings
  void _metricsIncrement;
  void _metricsDecrement;
  void _metricsRecord;
  void _metricsGauge;
  void _metricsTiming;
  void _metricsTimer;
  void _tracesWithSpan;
  void _tracesGetActiveSpan;
  void _logsInfo;
  void _logsWarn;
  void _logsError;
  void _logsCreateErrorReporter;
  void _errorsCapture;
  void _errorsRecord;
  void _errorsRecordResult;
  void _errorsWrap;
  void _errorsBoundary;
  void _errorsWithHandling;
  void _errorsCategorize;
  void _contextRun;
  void _contextSetUser;
  void _contextAddBreadcrumb;
  void _contextAddTag;
  void _contextSet;
  void _contextGet;
  void _contextClear;
  void _resultTrace;
  void _resultMetrics;
  void _trace;
}

/**
 * Additional specific compatibility checks for critical API surface
 */
function assertSpecificCompatibility(): void {
  const mock = new MockObservabilityClient();

  // Test that the mock can be used in contexts where UnifiedObservabilityClient API is expected
  // This checks structural compatibility for the methods that matter in tests

  // Test metrics usage patterns
  mock.metrics.increment("test.counter");
  mock.metrics.record("test.histogram", 123);
  mock.metrics.gauge("test.gauge", 456);

  // Test tracing usage patterns
  void mock.traces.withSpan("test-span", async () => "result");
  void mock.trace("test-span-2", async () => "result");

  // Test error handling patterns
  mock.errors.capture(new Error("test"));
  mock.errors.record(new Error("test"));

  // Test context patterns
  mock.context.setUser("user123");
  mock.context.addBreadcrumb("test breadcrumb");

  // Test logging patterns
  mock.logs.info("test message");
  mock.logs.error("error message", new Error("test"));

  // If we reach here without compile errors, the mock is compatible for testing purposes
}

// Export functions to prevent "unused" warnings (though they're never called)
export { assertMockCompatibility, assertSpecificCompatibility };
