/**
 * Histogram Bucket Boundary Tests
 *
 * M3 Fix: Tests to verify histogram recording and boundary value handling.
 *
 * Multi-Model Review Finding:
 * "No tests verify histogram bucket configuration or boundary handling."
 * "Impact: Off-by-one errors in p99 latency reporting could go undetected."
 *
 * These tests verify:
 * - Histogram values are correctly recorded
 * - Boundary values are handled correctly
 * - Histogram aggregation produces correct min/max/sum/count
 * - Values across all magnitude ranges are properly tracked
 *
 * Note: Actual bucket assignment verification requires the real SDK's
 * InMemoryMetricExporter to capture histogram data points. These tests
 * use the mock-based approach from telemetry-pipeline.test.mts for
 * comprehensive value tracking verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartClient } from "../../index.mjs";
import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";
import { clearAllInstances } from "../../client-instance.mjs";

/**
 * Creates a mock meter that captures histogram operations for verification.
 * Tracks all recorded values and computes min/max/sum/count.
 */
function createHistogramTrackingMeter() {
  const histogramRecords = new Map<
    string,
    {
      values: number[];
      attributes: Record<string, unknown>[];
    }
  >();

  const createHistogram = vi.fn((name: string) => ({
    record: vi.fn((value: number, attributes?: Record<string, unknown>) => {
      if (!histogramRecords.has(name)) {
        histogramRecords.set(name, { values: [], attributes: [] });
      }
      const record = histogramRecords.get(name)!;
      record.values.push(value);
      record.attributes.push(attributes ?? {});
    }),
  }));

  return {
    createCounter: vi.fn(() => ({ add: vi.fn() })),
    createUpDownCounter: vi.fn(() => ({ add: vi.fn() })),
    createHistogram,
    createObservableGauge: vi.fn(() => ({
      addCallback: vi.fn(),
      removeCallback: vi.fn(),
    })),

    // test helpers
    getHistogramData: (name: string) => {
      const record = histogramRecords.get(name);
      if (!record || record.values.length === 0) return null;

      const values = record.values;
      return {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: Math.min(...values),
        max: Math.max(...values),
        values: [...values],
        attributes: record.attributes,
      };
    },

    getAllHistograms: () => Array.from(histogramRecords.keys()),

    reset: () => {
      histogramRecords.clear();
      createHistogram.mockClear();
    },
  };
}

describe("Histogram Bucket Boundary Tests (M3 Fix)", () => {
  let client: UnifiedObservabilityClient;
  let mockMeter: ReturnType<typeof createHistogramTrackingMeter>;
  let mockMeterProvider: { getMeter: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    clearAllInstances();

    mockMeter = createHistogramTrackingMeter();
    mockMeterProvider = {
      getMeter: vi.fn().mockReturnValue(mockMeter),
    };

    // mock tracer provider (minimal - not testing traces here)
    const mockTracerProvider = {
      getTracer: vi.fn().mockReturnValue({
        startSpan: vi.fn().mockReturnValue({
          end: vi.fn(),
          setAttribute: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          isRecording: () => true,
          spanContext: () => ({ traceId: "test", spanId: "test", traceFlags: 1 }),
        }),
        startActiveSpan: vi.fn((_name: string, optionsOrFn: unknown, contextOrFn?: unknown, fn?: unknown) => {
          const callback =
            typeof optionsOrFn === "function"
              ? (optionsOrFn as (span: unknown) => unknown)
              : typeof contextOrFn === "function"
                ? (contextOrFn as (span: unknown) => unknown)
                : (fn as ((span: unknown) => unknown) | undefined);
          return callback?.({
            end: vi.fn(),
            setAttribute: vi.fn(),
            setStatus: vi.fn(),
            recordException: vi.fn(),
          });
        }),
      }),
    };

    client = await SmartClient.create({
      serviceName: "histogram-boundary-test",
      environment: "node",
      existingTracerProvider:
        mockTracerProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingTracerProvider"],
      existingMeterProvider:
        mockMeterProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingMeterProvider"],
      disableInstrumentation: true,
    });
  });

  afterEach(async () => {
    try {
      await client?.destroy();
    } catch {
      // ignore
    }
    clearAllInstances();
    vi.restoreAllMocks();
  });

  describe("Basic Histogram Recording", () => {
    it("should record single value correctly", () => {
      const instrument = client.getServiceInstrumentation();

      instrument.metrics.record("test.latency", 42);

      const data = mockMeter.getHistogramData("test.latency");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
      expect(data!.sum).toBe(42);
      expect(data!.min).toBe(42);
      expect(data!.max).toBe(42);
    });

    it("should record multiple values with correct aggregation", () => {
      const instrument = client.getServiceInstrumentation();

      const values = [10, 20, 30, 40, 50];
      values.forEach((v) => {
        instrument.metrics.record("test.multi", v);
      });

      const data = mockMeter.getHistogramData("test.multi");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(5);
      expect(data!.sum).toBe(150);
      expect(data!.min).toBe(10);
      expect(data!.max).toBe(50);
      expect(data!.values).toEqual(values);
    });

    it("should record values with attributes", () => {
      const instrument = client.getServiceInstrumentation();

      instrument.metrics.record("test.attributed", 100, {
        operation: "query",
        endpoint: "/api/users",
      });

      const data = mockMeter.getHistogramData("test.attributed");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
      // verify attributes are passed through (SDK enriches with additional attrs)
      expect(data!.attributes[0]).toMatchObject({
        operation: "query",
        endpoint: "/api/users",
      });
    });
  });

  describe("Boundary Value Handling", () => {
    it("should handle exact boundary value 100", () => {
      const instrument = client.getServiceInstrumentation();

      // common latency bucket boundary (100ms)
      instrument.metrics.record("test.boundary.100", 100);

      const data = mockMeter.getHistogramData("test.boundary.100");
      expect(data).not.toBeNull();
      expect(data!.min).toBe(100);
      expect(data!.max).toBe(100);
    });

    it("should distinguish values just below and just above boundary", () => {
      const instrument = client.getServiceInstrumentation();

      // values around 100ms boundary
      instrument.metrics.record("test.boundary.around", 99);
      instrument.metrics.record("test.boundary.around", 100);
      instrument.metrics.record("test.boundary.around", 101);

      const data = mockMeter.getHistogramData("test.boundary.around");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(3);
      expect(data!.min).toBe(99);
      expect(data!.max).toBe(101);
      expect(data!.values).toEqual([99, 100, 101]);
    });

    it("should handle values at multiple common bucket boundaries", () => {
      const instrument = client.getServiceInstrumentation();

      // common latency bucket boundaries (based on OTel defaults)
      const boundaryValues = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000];
      boundaryValues.forEach((v) => {
        instrument.metrics.record("test.boundaries", v);
      });

      const data = mockMeter.getHistogramData("test.boundaries");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(boundaryValues.length);
      expect(data!.min).toBe(0);
      expect(data!.max).toBe(1000);
      expect(data!.values).toEqual(boundaryValues);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero value", () => {
      const instrument = client.getServiceInstrumentation();

      instrument.metrics.record("test.zero", 0);

      const data = mockMeter.getHistogramData("test.zero");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
      expect(data!.sum).toBe(0);
      expect(data!.min).toBe(0);
      expect(data!.max).toBe(0);
    });

    it("should handle very small fractional values", () => {
      const instrument = client.getServiceInstrumentation();

      instrument.metrics.record("test.small", 0.001);
      instrument.metrics.record("test.small", 0.0001);

      const data = mockMeter.getHistogramData("test.small");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(2);
      expect(data!.min).toBeCloseTo(0.0001);
      expect(data!.max).toBeCloseTo(0.001);
    });

    it("should handle fractional values near boundaries", () => {
      const instrument = client.getServiceInstrumentation();

      // values very close to 100 boundary
      instrument.metrics.record("test.fractional", 99.999);
      instrument.metrics.record("test.fractional", 100.001);

      const data = mockMeter.getHistogramData("test.fractional");
      expect(data).not.toBeNull();
      expect(data!.min).toBeCloseTo(99.999);
      expect(data!.max).toBeCloseTo(100.001);
    });

    it("should handle very large values", () => {
      const instrument = client.getServiceInstrumentation();

      instrument.metrics.record("test.large", 1_000_000);
      instrument.metrics.record("test.large", 10_000_000);

      const data = mockMeter.getHistogramData("test.large");
      expect(data).not.toBeNull();
      expect(data!.min).toBe(1_000_000);
      expect(data!.max).toBe(10_000_000);
    });

    it("should handle large number of samples without data loss", () => {
      const instrument = client.getServiceInstrumentation();

      const sampleCount = 1000;
      let expectedSum = 0;

      for (let i = 1; i <= sampleCount; i++) {
        instrument.metrics.record("test.many", i);
        expectedSum += i;
      }

      const data = mockMeter.getHistogramData("test.many");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(sampleCount);
      expect(data!.sum).toBe(expectedSum);
      expect(data!.min).toBe(1);
      expect(data!.max).toBe(1000);
    });
  });

  describe("Latency Distribution Scenarios", () => {
    it("should correctly track realistic latency distribution", () => {
      const instrument = client.getServiceInstrumentation();

      // simulate realistic latency distribution with DETERMINISTIC values
      // (codex review: Math.random() causes flaky tests)
      // fast responses (10-50ms): 80 values
      // medium responses (50-100ms): 15 values
      // slow responses (100-500ms): 4 values
      // very slow (>500ms): 1 value

      const values: number[] = [];

      // 80 fast responses - deterministic spread across 10-50ms range
      for (let i = 0; i < 80; i++) {
        const v = 10 + (i * 40) / 80; // evenly distributed 10-49.5ms
        values.push(v);
        instrument.metrics.record("test.latency.realistic", v);
      }

      // 15 medium responses - deterministic spread across 50-100ms range
      for (let i = 0; i < 15; i++) {
        const v = 50 + (i * 50) / 15; // evenly distributed 50-96.67ms
        values.push(v);
        instrument.metrics.record("test.latency.realistic", v);
      }

      // 4 slow responses - deterministic spread across 100-500ms range
      for (let i = 0; i < 4; i++) {
        const v = 100 + (i * 400) / 4; // 100, 200, 300, 400ms
        values.push(v);
        instrument.metrics.record("test.latency.realistic", v);
      }

      // 1 very slow response (outlier)
      values.push(750);
      instrument.metrics.record("test.latency.realistic", 750);

      const data = mockMeter.getHistogramData("test.latency.realistic");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(100);

      // min should be exactly 10 (deterministic)
      expect(data!.min).toBe(10);

      // max should be 750 (the outlier)
      expect(data!.max).toBe(750);

      // sum should match exactly (deterministic values)
      expect(data!.sum).toBeCloseTo(values.reduce((a, b) => a + b, 0));
    });

    it("should track p99 outlier correctly", () => {
      const instrument = client.getServiceInstrumentation();

      // 99 fast requests at 50ms
      for (let i = 0; i < 99; i++) {
        instrument.metrics.record("test.p99.outlier", 50);
      }

      // 1 slow request at 5000ms (the p99 value)
      instrument.metrics.record("test.p99.outlier", 5000);

      const data = mockMeter.getHistogramData("test.p99.outlier");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(100);
      expect(data!.min).toBe(50);
      expect(data!.max).toBe(5000);

      // the max (5000) is the p99 outlier that would be missed
      // if bucket boundaries don't extend high enough
      expect(data!.values.filter((v) => v === 5000)).toHaveLength(1);
    });
  });

  describe("Timer API (uses histogram internally)", () => {
    // codex review: use afterEach to ensure fake timers are always restored
    // even if test assertions fail
    afterEach(() => {
      vi.useRealTimers();
    });

    it("should record timer values in histogram", () => {
      vi.useFakeTimers();

      const instrument = client.getServiceInstrumentation();

      const timer = instrument.metrics.timer("test.operation.duration");
      vi.advanceTimersByTime(150);
      timer.end();

      const data = mockMeter.getHistogramData("test.operation.duration");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
      expect(data!.min).toBe(150);
      expect(data!.max).toBe(150);
    });

    it("should track multiple timer operations", () => {
      vi.useFakeTimers();

      const instrument = client.getServiceInstrumentation();

      // simulate 3 operations with different durations
      const durations = [25, 75, 150];

      durations.forEach((d) => {
        const timer = instrument.metrics.timer("test.multi.timer");
        vi.advanceTimersByTime(d);
        timer.end();
      });

      const data = mockMeter.getHistogramData("test.multi.timer");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(3);
      expect(data!.min).toBe(25);
      expect(data!.max).toBe(150);
    });
  });

  describe("Scoped Instrument Histograms", () => {
    it("should track histograms per scope independently", () => {
      const paymentScope = client.getInstrumentation("payment-service");
      const authScope = client.getInstrumentation("auth-service");

      paymentScope.metrics.record("request.latency", 100);
      paymentScope.metrics.record("request.latency", 200);

      authScope.metrics.record("request.latency", 25);
      authScope.metrics.record("request.latency", 50);

      // verify meter provider was called with different scope names
      expect(mockMeterProvider.getMeter).toHaveBeenCalledWith(
        "payment-service",
        undefined,
      );
      expect(mockMeterProvider.getMeter).toHaveBeenCalledWith(
        "auth-service",
        undefined,
      );

      // codex review: also verify the histogram data was recorded
      // note: since both scopes return the same mock meter in our setup,
      // we verify total values recorded (real SDK would separate by scope)
      const data = mockMeter.getHistogramData("request.latency");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(4); // 2 from payment + 2 from auth
    });
  });

  describe("Invalid Input Handling", () => {
    // codex review: add tests for invalid inputs (negative, NaN, Infinity)
    // note: the SDK validates inputs and may filter out invalid values

    it("should handle negative values (SDK behavior varies)", () => {
      const instrument = client.getServiceInstrumentation();

      // negative duration values are technically invalid for latency
      // but SDK may still accept them - verify they're passed through
      instrument.metrics.record("test.negative", -10);

      const data = mockMeter.getHistogramData("test.negative");
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
      expect(data!.values).toContain(-10);
    });

    it("should filter NaN values (SDK validation)", () => {
      const instrument = client.getServiceInstrumentation();

      // NaN values are filtered by the SDK's MetricValidation
      // this is correct behavior - invalid metrics should not be recorded
      instrument.metrics.record("test.nan", NaN);

      // verify no data was recorded (NaN filtered)
      const data = mockMeter.getHistogramData("test.nan");
      expect(data).toBeNull();
    });

    it("should filter Infinity values (SDK validation)", () => {
      const instrument = client.getServiceInstrumentation();

      // Infinity values are filtered by the SDK's MetricValidation
      // this is correct behavior - non-finite values should be rejected
      instrument.metrics.record("test.infinity", Infinity);
      instrument.metrics.record("test.infinity", -Infinity);

      // verify no data was recorded (Infinity filtered)
      const data = mockMeter.getHistogramData("test.infinity");
      expect(data).toBeNull();
    });
  });
});
