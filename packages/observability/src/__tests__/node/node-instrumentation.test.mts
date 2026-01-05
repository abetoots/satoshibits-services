/**
 * Node.js Instrumentation Integration Tests
 *
 * Focuses on behaviours provided by UnifiedObservabilityClient:
 * - Context enrichment on metrics
 * - Sanitization applied to user-supplied attributes
 * - Scoped instrumentation caching across multiple calls
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

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

import { SmartClient } from "../../index.mjs";

function extractMetricDataPoints(exporter: InMemoryMetricExporter) {
  const exports = exporter.getMetrics();
  return exports.flatMap((batch) =>
    batch.scopeMetrics.flatMap((scopeMetric) =>
      scopeMetric.metrics.flatMap((metric) => {
        const data = metric.dataPoints ?? [];
        return data.map((point) => ({
          name: metric.descriptor.name,
          attributes: point.attributes ?? {},
          value: "value" in point ? point.value : undefined,
        }));
      }),
    ),
  );
}

describe("Node.js Instrumentation Integration", () => {
  let client: UnifiedObservabilityClient;
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let metricReader: PeriodicExportingMetricReader;

  beforeEach(async () => {
    spanExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 50,
    });

    client = await SmartClient.initialize({
      serviceName: "node-instrumentation-integration",
      environment: "node",
      sanitize: true,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    });
  });

  afterEach(async () => {
    await metricReader.forceFlush().catch(() => undefined);
    await SmartClient.shutdown();
    spanExporter.reset();
  });

  it("enriches metrics with business context and sanitizes attributes", async () => {
    const instrument = client.getServiceInstrumentation();

    await client.context.business.run({ tenantId: "tenant-123" }, () => {
      instrument.metrics.increment("node.instrumentation.counter", 1, {
        apiKey: "sk_live_secret",
        region: "us-east-1",
      });
    });

    await metricReader.forceFlush();

    const points = extractMetricDataPoints(metricExporter);
    const counterPoint = points.find(
      (point) => point.name === "node.instrumentation.counter",
    );

    expect(counterPoint).toBeDefined();
    expect(counterPoint?.value).toBeGreaterThanOrEqual(1);
    expect(counterPoint?.attributes.region).toBe("us-east-1");
    expect(counterPoint?.attributes.apiKey).toBe("[REDACTED]");
    // business context is converted to snake_case for otel
    expect(counterPoint?.attributes.tenant_id).toBe("tenant-123");
  });

  it("reuses scoped instrumentation across calls", () => {
    const instrument = client.getInstrumentation("orders-service", "1.0.0");
    const instrument2 = client.getInstrumentation("orders-service", "1.0.0");

    // should return the same instance for caching
    expect(instrument).toBe(instrument2);

    // metrics should not throw
    expect(() => {
      instrument.metrics.increment("orders.count", 1);
      instrument.metrics.increment("orders.count", 2);
      instrument.metrics.record("orders.latency", 150);
    }).not.toThrow();
  });

  it("records spans via unified client helpers without leaking raw errors", async () => {
    const instrument = client.getServiceInstrumentation();

    // withSpan should handle errors correctly and rethrow
    await expect(
      instrument.traces.withSpan("failing-operation", () => {
        const error = new Error("integration failure");
        // errors.record should sanitize sensitive data
        instrument.errors.record(error, { apiKey: "sk_live_123" });
        throw error;
      }),
    ).rejects.toThrow("integration failure");

    // verify error recording doesn't throw
    expect(() => {
      instrument.errors.record(new Error("test"), { password: "secret" });
    }).not.toThrow();
  });
});
