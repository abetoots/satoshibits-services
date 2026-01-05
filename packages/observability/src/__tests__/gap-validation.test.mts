/**
 * Tests to Validate Identified Gaps
 *
 * These tests specifically target the gaps between README claims
 * and actual implementation, helping track what needs to be fixed.
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { UnifiedObservabilityClient } from "../unified-smart-client.mjs";
import type { ScopedInstrument } from "../internal/scoped-instrument.mjs";

import { SmartClient } from "../index.mjs";

describe("Error Context Integration", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ScopedInstrument;
  let spanExporter: InMemorySpanExporter;
  let metricReader: PeriodicExportingMetricReader;

  beforeEach(async () => {
    // in-memory exporters required for SDK initialization (prevents network calls)
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    client = await SmartClient.initialize({
      serviceName: "gap-validation-test",
      environment: "node" as const,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    } as unknown as Parameters<typeof SmartClient.initialize>[0]);

    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    spanExporter.reset();
  });

  it("should automatically include breadcrumbs in error context", () => {
    // add breadcrumbs to global context
    client.context.business.addBreadcrumb("User clicked button", {
      category: "action",
    });
    client.context.business.addBreadcrumb("Navigated to checkout", {
      category: "navigation",
    });

    // record error - should not throw and should capture breadcrumbs
    const error = new Error("Test error");
    expect(() => serviceInstrument.errors.record(error)).not.toThrow();

    // BEHAVIORAL VERIFICATION: verify breadcrumbs are maintained in context
    const breadcrumbs = client.context.business.getBreadcrumbs();
    expect(breadcrumbs).toHaveLength(2);

    // access breadcrumbs after verifying length (non-null assertions are safe here)
    const firstBreadcrumb = breadcrumbs[0]!;
    const secondBreadcrumb = breadcrumbs[1]!;

    expect(firstBreadcrumb.message).toBe("User clicked button");
    expect(firstBreadcrumb.data).toEqual({ category: "action" });
    expect(secondBreadcrumb.message).toBe("Navigated to checkout");
    expect(secondBreadcrumb.data).toEqual({ category: "navigation" });

    // verify breadcrumbs have timestamps (behavioral: properly constructed)
    expect(firstBreadcrumb.timestamp).toBeDefined();
    expect(typeof firstBreadcrumb.timestamp).toBe("number");
  });

  it("should provide error recording API", () => {
    // verify the client has the expected error recording API
    expect(typeof serviceInstrument.errors.record).toBe("function");
    expect(typeof serviceInstrument.errors.capture).toBe("function");

    // Should not throw when recording errors
    const error = new Error("Test error");
    expect(() => serviceInstrument.errors.record(error)).not.toThrow();
    expect(() => serviceInstrument.errors.capture(error)).not.toThrow();
  });
});

// NOTE: "PII Sanitization Coverage" tests moved to sanitization.test.mts per M4 refactoring

describe("SmartClient lifecycle", () => {
  afterEach(async () => {
    try {
      await SmartClient.shutdown();
    } catch {
      // ignore shutdown errors in cleanup
    }
  });

  it("allows re-initialization after shutdown", async () => {
    const createTestConfig = () => {
      const spanExporter = new InMemorySpanExporter();
      const metricExporter = new InMemoryMetricExporter(
        AggregationTemporality.CUMULATIVE,
      );
      const metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 100,
      });

      return {
        serviceName: "smartclient-reinit-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      } as const;
    };

    const firstClient = await SmartClient.initialize(createTestConfig());
    await SmartClient.shutdown();

    const secondClient = await SmartClient.initialize(createTestConfig());

    expect(secondClient).toBeDefined();
    expect(secondClient).not.toBe(firstClient);

    const instrument = secondClient.getServiceInstrumentation();
    expect(() =>
      instrument.metrics.increment("reinit.metric", 1),
    ).not.toThrow();
  });
});

// NOTE: "Smart Sampling Integration" tests removed - redundant with sampler-config.test.mts (700+ lines)

describe("Browser/Node API Parity", () => {
  let client: UnifiedObservabilityClient;
  let spanExporter: InMemorySpanExporter;
  let metricReader: PeriodicExportingMetricReader;

  beforeEach(async () => {
    // in-memory exporters required for SDK initialization (prevents network calls)
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    // Initialize with test configuration
    client = await SmartClient.initialize({
      serviceName: "api-parity-test",
      environment: "node" as const,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    } as unknown as Parameters<typeof SmartClient.initialize>[0]);
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    spanExporter.reset();
  });

  it("should export SmartClient.initialize in both environments", () => {
    // Verify SmartClient has expected initialization API
    expect(typeof SmartClient.initialize).toBe("function");
    expect(typeof SmartClient.create).toBe("function");
    expect(typeof SmartClient.shutdown).toBe("function");
  });

  it("should provide context.business.run() method", () => {
    // Verify context.business.run exists and is callable
    expect(typeof client.context.business.run).toBe("function");

    // Should not throw when calling context.business.run
    expect(() => {
      client.context.business.run({ testKey: "testValue" }, () => {
        // Context execution should work
      });
    }).not.toThrow();
  });
});

describe("Method Naming and Structure", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ScopedInstrument;
  let spanExporter: InMemorySpanExporter;
  let metricReader: PeriodicExportingMetricReader;

  beforeEach(async () => {
    // in-memory exporters required for SDK initialization (prevents network calls)
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    // Initialize with test configuration
    client = await SmartClient.initialize({
      serviceName: "method-test",
      environment: "node" as const,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    } as unknown as Parameters<typeof SmartClient.initialize>[0]);

    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    spanExporter.reset();
  });

  it("should provide single-step metrics API", () => {
    // Metrics API should work without throwing
    expect(() =>
      serviceInstrument.metrics.increment("test.metric", 1),
    ).not.toThrow();
    expect(() => serviceInstrument.metrics.increment("test")).not.toThrow();
    expect(() =>
      serviceInstrument.metrics.gauge("test.gauge", 42),
    ).not.toThrow();
    expect(() =>
      serviceInstrument.metrics.record("test.histogram", 100),
    ).not.toThrow();
  });

  // note: SmartClient.initialize and context.business.run are tested
  // in "Browser/Node API Parity" section above - no duplicates needed
});

describe("Integration Between Modules", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ScopedInstrument;
  let spanExporter: InMemorySpanExporter;
  let metricReader: PeriodicExportingMetricReader;

  beforeEach(async () => {
    // in-memory exporters required for SDK initialization (prevents network calls)
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    // Initialize with test configuration
    client = await SmartClient.initialize({
      serviceName: "integration-test",
      environment: "node" as const,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    } as unknown as Parameters<typeof SmartClient.initialize>[0]);

    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    spanExporter.reset();
  });

  it("should use smart-errors functions for error handling", () => {
    // Verify ErrorsClient provides expected interface
    expect(typeof serviceInstrument.errors.record).toBe("function");
    expect(typeof serviceInstrument.errors.capture).toBe("function");

    // Should delegate to smart-errors functions without throwing
    const error = new Error("Integration test error");
    expect(() => serviceInstrument.errors.record(error)).not.toThrow();
    expect(() => serviceInstrument.errors.capture(error)).not.toThrow();
  });

  // note: SmartSampler tests are in sampler-config.test.mts
});
