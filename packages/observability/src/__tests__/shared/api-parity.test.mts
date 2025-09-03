/**
 * API Parity Tests - Scoped Instrumentation API
 *
 * Validates that the SmartClient provides a scoped instrumentation API that works
 * identically across Node.js and browser environments following OpenTelemetry specifications.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";
import type { ScopedInstrument } from "../../internal/scoped-instrument.mjs";

import { SmartClient } from "../../index.mjs";
import { detectEnvironment } from "../../utils/environment.mjs";

describe("API Parity - Scoped Instrumentation", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ScopedInstrument;
  let spanExporter: InMemorySpanExporter;
  let metricReader: PeriodicExportingMetricReader;
  const currentEnvironment = detectEnvironment();

  beforeEach(async () => {
    // in-memory exporters required for SDK initialization (prevents network calls)
    // these tests verify API surface, not exported telemetry content
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    // Initialize with environment-appropriate configuration
    // testSpanProcessor and testMetricReader are internal test properties
    // not exposed in public SmartClientConfig type
    client = await SmartClient.initialize({
      serviceName: "api-parity-test",
      environment: currentEnvironment,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    } as unknown as Parameters<typeof SmartClient.initialize>[0]);
    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    spanExporter.reset();
    vi.clearAllMocks();
  });

  describe("Scoped API Surface", () => {
    it("should provide scoped instrumentation factory methods", () => {
      // Verify scoped instrumentation factory methods exist
      expect(client.getServiceInstrumentation).toBeDefined();
      expect(typeof client.getServiceInstrumentation).toBe("function");

      expect(client.getInstrumentation).toBeDefined();
      expect(typeof client.getInstrumentation).toBe("function");

      // Test service instrumentation
      const serviceInstr = client.getServiceInstrumentation();
      expect(serviceInstr).toBeDefined();
      expect(serviceInstr.traces).toBeDefined();
      expect(serviceInstr.metrics).toBeDefined();
      expect(serviceInstr.errors).toBeDefined();
      expect(serviceInstr.logs).toBeDefined();
      expect(serviceInstr.result).toBeDefined();

      // Test custom instrumentation
      const customInstr = client.getInstrumentation("test-module", "1.0.0");
      expect(customInstr).toBeDefined();
      expect(customInstr.traces).toBeDefined();
      expect(customInstr.metrics).toBeDefined();
    });

    it("should provide scoped tracing functionality", () => {
      // Test traces on scoped instrument
      const span = serviceInstrument.traces.startSpan("test-span");
      expect(span).toBeDefined();
      expect(span.end).toBeDefined();
      expect(span.setAttribute).toBeDefined();
      expect(span.setAttributes).toBeDefined();

      span.end();
    });

    it("should provide scoped metrics functionality", () => {
      // Test metrics on scoped instrument
      expect(() => {
        serviceInstrument.metrics.increment("test.counter");
        serviceInstrument.metrics.gauge("test.gauge", 42);
        serviceInstrument.metrics.record("test.histogram", 100);
        serviceInstrument.metrics.histogram("test.histogram.alias", 200);
      }).not.toThrow();
    });

    it("should provide scoped error handling", () => {
      // Test errors on scoped instrument
      const error = new Error("Scoped test error");
      expect(() => {
        serviceInstrument.errors.record(error);
        serviceInstrument.errors.capture(error, { boundary: true });
      }).not.toThrow();
    });

    it("should maintain context namespace on main client", () => {
      // Context stays on main client (not scoped)
      expect(client.context).toBeDefined();
      expect(typeof client.context).toBe("object");

      // business context API is namespaced under context.business
      expect(client.context.business).toBeDefined();
      expect(client.context.business.setUser).toBeDefined();
      expect(client.context.business.addTag).toBeDefined();
      expect(client.context.business.addBreadcrumb).toBeDefined();

      // trace context API is namespaced under context.trace
      expect(client.context.trace).toBeDefined();
      expect(client.context.trace.getTraceId).toBeDefined();
    });
  });

  describe("API Functionality", () => {
    it("should work correctly across environments", () => {
      // Test that scoped API works in current environment
      expect(() => {
        const span = serviceInstrument.traces.startSpan("env-test");
        span.end();
        serviceInstrument.metrics.increment("env.test");
        serviceInstrument.metrics.histogram("env.test.hist", 123);
        serviceInstrument.errors.record(new Error("env test"));
      }).not.toThrow();
    });

    it("should expose service-level histogram helper", () => {
      expect(() => {
        client.metrics.histogram("service.histogram", 42, { scope: "service" });
      }).not.toThrow();
    });

    it("should handle invalid inputs gracefully", () => {
      expect(() => {
        // Scoped metrics with invalid values
        serviceInstrument.metrics.increment("test", NaN);
        serviceInstrument.metrics.gauge("test", Infinity);

        // Scoped errors with invalid inputs
        // @ts-expect-error - Testing null error handling
        serviceInstrument.errors.record(null);
      }).not.toThrow();
    });

    it("should provide consistent behavior across scopes", () => {
      // Create multiple scopes and verify they work the same way
      const scope1 = client.getInstrumentation("module-1", "1.0.0");
      const scope2 = client.getInstrumentation("module-2", "2.0.0");

      expect(() => {
        scope1.metrics.increment("test");
        scope2.metrics.increment("test");

        const span1 = scope1.traces.startSpan("test");
        const span2 = scope2.traces.startSpan("test");

        span1.end();
        span2.end();
      }).not.toThrow();
    });
  });

  describe("OpenTelemetry Compliance", () => {
    it("should create properly scoped instruments", () => {
      // Verify that different scopes create different instrument instances
      const scope1 = client.getInstrumentation("module-1", "1.0.0");
      const scope2 = client.getInstrumentation("module-2", "2.0.0");

      expect(scope1).not.toBe(scope2);
      expect(scope1.traces).toBeDefined();
      expect(scope2.traces).toBeDefined();
    });

    it("should support proper instrumentation scope naming", () => {
      // Test that custom scopes can be created with proper names and versions
      const customScope = client.getInstrumentation(
        "my-app/user-service",
        "1.2.3",
      );
      expect(customScope).toBeDefined();
      expect(customScope.metrics).toBeDefined();
      expect(customScope.traces).toBeDefined();
    });
  });
});
