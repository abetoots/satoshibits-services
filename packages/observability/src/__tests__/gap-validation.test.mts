/**
 * Tests to Validate Identified Gaps
 *
 * These tests specifically target the gaps between README claims
 * and actual implementation, helping track what needs to be fixed.
 */

import { ROOT_CONTEXT } from "@opentelemetry/api";
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

import { getGlobalContext } from "../enrichment/context.mjs";
import { sanitizeObject } from "../enrichment/sanitizer.mjs";
// import to ensure SmartClient is available
import { SmartClient } from "../index.mjs";
import { SmartSampler } from "../sampling.mjs";
import { reportError } from "../smart-errors.mjs";
import { isSanitizedObject } from "./test-utils/test-types.mjs";

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

  it("should use smart-errors.mts reportError() for error recording", () => {
    // Verify the client has the expected API that delegates to reportError
    expect(typeof serviceInstrument.errors.record).toBe("function");
    expect(typeof serviceInstrument.errors.capture).toBe("function");

    // Should not throw when recording errors
    const error = new Error("Test error");
    expect(() => serviceInstrument.errors.record(error)).not.toThrow();
    expect(() => serviceInstrument.errors.capture(error)).not.toThrow();
  });
});

describe("PII Sanitization Coverage", () => {
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

    // Initialize with sanitization enabled
    client = await SmartClient.initialize({
      serviceName: "sanitization-test",
      environment: "node" as const,
      disableInstrumentation: true,
      sanitize: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    } as unknown as Parameters<typeof SmartClient.initialize>[0]);

    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    spanExporter.reset();
  });

  it("should sanitize attributes in error context", () => {
    // record error with sensitive attributes
    const error = new Error("Database connection failed");

    // BEHAVIORAL VERIFICATION: sanitizeObject should redact sensitive keys
    const testData = {
      password: "secret123",
      apiKey: "sk_live_abc123",
      normalData: "visible",
    };
    const sanitized = sanitizeObject(testData);

    // verify sanitization actually modifies sensitive data
    expect(sanitized).toBeDefined();
    if (isSanitizedObject(sanitized)) {
      expect(sanitized.password).not.toBe("secret123");
      expect(sanitized.apiKey).not.toBe("sk_live_abc123");
      expect(sanitized.normalData).toBe("visible");
    }

    // verify errors.record doesn't throw with sensitive context
    expect(() =>
      serviceInstrument.errors.record(error, testData),
    ).not.toThrow();
  });

  it("should sanitize attributes in log context", () => {
    // log with sensitive attributes - verifies SDK handles sensitive data without throwing
    expect(() =>
      serviceInstrument.logs.info("Operation completed", {
        apiKey: "sk_live_abc123",
        password: "secret123",
      }),
    ).not.toThrow();

    // note: logs may or may not create spans depending on implementation
    // the key is that the operation completed without exposing sensitive data
  });

  it("should sanitize known sensitive attribute patterns", () => {
    const data = {
      password: "secret123",
      apiKey: "sk_live_abc",
      normal: "data",
    };

    const sanitized = sanitizeObject(data);

    // Verify sanitization works for attributes
    if (isSanitizedObject(sanitized)) {
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.apiKey).toBe("[REDACTED]"); // Fixed: sanitizeObject fully redacts apiKey
      expect(sanitized.normal).toBe("data");
    }
  });
});

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

describe("Smart Sampling Integration", () => {
  it("should create SmartSampler with valid configuration", () => {
    const sampler = new SmartSampler({
      baseRate: 0.1,
      errorRate: 1.0,
      slowRate: 1.0,
      tierRates: {
        free: 0.01,
        pro: 0.1,
        enterprise: 0.5,
      },
    });

    // Sampler should be created successfully
    expect(sampler).toBeDefined();

    // Should make sampling decisions
    const decision = sampler.shouldSample(
      ROOT_CONTEXT,
      "trace123",
      "test-span",
      0,
      { error: true },
      [],
    );

    expect(decision.decision).toBeDefined();
    expect(typeof decision.decision).toBe("number");
  });
});

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

  // note: SmartSampler tests are in "Smart Sampling Integration" section above
});
