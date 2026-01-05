/**
 * Telemetry Pipeline Verification Tests
 *
 * H2 Fix: These tests verify that telemetry flows through the pipeline correctly.
 *
 * Multi-Model Review Finding (Codex Primary):
 * "Tests set up InMemorySpanExporter/InMemoryMetricExporter but never inspect the
 * actual exported telemetry: spans/metrics never read"
 *
 * Approach: Uses mock tracer/meter providers (BYOP pattern) to verify that:
 * - Spans are created with correct names and attributes
 * - Metrics are recorded with correct values
 * - Error recording produces expected telemetry
 *
 * NOTE: Full InMemorySpanExporter verification requires investigation of the
 * OTel SDK global provider wiring in test contexts. See TODO below.
 *
 * TODO: Investigate why testSpanProcessor passed to SmartClient.initialize()
 * doesn't capture spans created via trace.getTracer() in the unified client.
 * The global TracerProvider may not be properly set or may be cached from
 * previous test runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartClient } from "../../index.mjs";
import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";
import { clearAllInstances } from "../../client-instance.mjs";

// ============================================================================
// Shared Mock Creators (used by all test suites)
// ============================================================================

/**
 * Creates a mock tracer that captures span operations for verification.
 * Uses closure-scoped spanData per span to correctly handle nested/concurrent spans.
 */
function createMockTracer() {
  const recordedSpans: Array<{
    name: string;
    attributes: Record<string, unknown>;
    status: { code?: number; message?: string };
    ended: boolean;
    exception?: Error;
  }> = [];

  // helper to create a span with closure-scoped state
  const createSpanData = (name: string, options?: { attributes?: Record<string, unknown> }) => {
    const spanData = {
      name,
      attributes: options?.attributes ?? {},
      status: {} as { code?: number; message?: string },
      ended: false,
      exception: undefined as Error | undefined,
    };
    recordedSpans.push(spanData);

    // methods close over this specific spanData, not a shared variable
    return {
      spanData,
      spanHandle: {
        end: vi.fn(() => { spanData.ended = true; }),
        setAttribute: vi.fn((key: string, value: unknown) => { spanData.attributes[key] = value; }),
        setStatus: vi.fn((status: { code?: number; message?: string }) => { spanData.status = status; }),
        recordException: vi.fn((error: Error) => { spanData.exception = error; }),
        isRecording: () => true,
        spanContext: () => ({
          traceId: `trace-${recordedSpans.length}`,
          spanId: `span-${recordedSpans.length}`,
          traceFlags: 1,
        }),
      },
    };
  };

  const startSpan = vi.fn((name: string, options?: { attributes?: Record<string, unknown> }) => {
    return createSpanData(name, options).spanHandle;
  });

  const startActiveSpan = vi.fn((
    name: string,
    optionsOrFn: unknown,
    contextOrFn?: unknown,
    fn?: unknown,
  ) => {
    // handle various overload signatures
    let callback: ((span: unknown) => unknown) | undefined;
    let spanOptions: { attributes?: Record<string, unknown> } = {};

    if (typeof optionsOrFn === "function") {
      callback = optionsOrFn as (span: unknown) => unknown;
    } else if (typeof contextOrFn === "function") {
      spanOptions = optionsOrFn as { attributes?: Record<string, unknown> };
      callback = contextOrFn as (span: unknown) => unknown;
    } else if (typeof fn === "function") {
      spanOptions = optionsOrFn as { attributes?: Record<string, unknown> };
      callback = fn as (span: unknown) => unknown;
    }

    const { spanHandle } = createSpanData(name, spanOptions);
    return callback?.(spanHandle);
  });

  return {
    startSpan,
    startActiveSpan,
    recordedSpans,
    getSpans: () => recordedSpans,
    getSpan: (name: string) => recordedSpans.find((s) => s.name === name),
    reset: () => {
      recordedSpans.length = 0;
      startSpan.mockClear();
      startActiveSpan.mockClear();
    },
  };
}

/**
 * Creates a mock meter that captures metric operations for verification.
 * Tracks created gauges and exposes triggerAllObservations() to
 * simulate SDK metric collection and verify gauge values.
 */
function createMockMeter() {
  const recordedMetrics: Array<{
    type: "counter" | "gauge" | "histogram" | "updowncounter";
    name: string;
    value: number;
    attributes?: Record<string, unknown>;
  }> = [];

  // track all created observable gauges for triggering
  const createdGauges: Array<{
    name: string;
    _triggerCallback: () => void;
  }> = [];

  return {
    createCounter: vi.fn((name: string) => ({
      add: vi.fn((value: number, attributes?: Record<string, unknown>) => {
        recordedMetrics.push({ type: "counter", name, value, attributes });
      }),
    })),
    createUpDownCounter: vi.fn((name: string) => ({
      add: vi.fn((value: number, attributes?: Record<string, unknown>) => {
        recordedMetrics.push({ type: "updowncounter", name, value, attributes });
      }),
    })),
    createHistogram: vi.fn((name: string) => ({
      record: vi.fn((value: number, attributes?: Record<string, unknown>) => {
        recordedMetrics.push({ type: "histogram", name, value, attributes });
      }),
    })),
    createObservableGauge: vi.fn((name: string) => {
      let lastCallback: ((observableResult: { observe: (value: number, attributes?: Record<string, unknown>) => void }) => void) | null = null;

      const gaugeMock = {
        addCallback: vi.fn((callback) => {
          lastCallback = callback;
        }),
        removeCallback: vi.fn(),
        // internal helper to simulate SDK collection cycle
        _triggerCallback: () => {
          if (lastCallback) {
            lastCallback({
              observe: (value: number, attributes?: Record<string, unknown>) => {
                recordedMetrics.push({ type: "gauge", name, value, attributes });
              },
            });
          }
        },
      };

      createdGauges.push({ name, _triggerCallback: gaugeMock._triggerCallback });
      return gaugeMock;
    }),
    // simulate a metric collection interval - triggers all gauge callbacks
    triggerAllObservations: () => {
      createdGauges.forEach((g) => g._triggerCallback());
    },
    getMetrics: () => recordedMetrics,
    getMetric: (name: string) => recordedMetrics.filter((m) => m.name.includes(name)),
    reset: () => {
      recordedMetrics.length = 0;
      createdGauges.length = 0;
    },
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Telemetry Pipeline Verification (Mock-Based)", () => {
  let client: UnifiedObservabilityClient;
  let mockTracer: ReturnType<typeof createMockTracer>;
  let mockMeter: ReturnType<typeof createMockMeter>;
  let mockTracerProvider: { getTracer: ReturnType<typeof vi.fn> };
  let mockMeterProvider: { getMeter: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    clearAllInstances();

    mockTracer = createMockTracer();
    mockMeter = createMockMeter();

    mockTracerProvider = {
      getTracer: vi.fn().mockReturnValue(mockTracer),
    };

    mockMeterProvider = {
      getMeter: vi.fn().mockReturnValue(mockMeter),
    };

    client = await SmartClient.create({
      serviceName: "telemetry-pipeline-test",
      environment: "node",
      existingTracerProvider: mockTracerProvider as unknown as Parameters<typeof SmartClient.create>[0]["existingTracerProvider"],
      existingMeterProvider: mockMeterProvider as unknown as Parameters<typeof SmartClient.create>[0]["existingMeterProvider"],
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

  describe("Span Export Verification", () => {
    it("should create spans with correct name and attributes", () => {
      const serviceInstrument = client.getServiceInstrumentation();

      // create and end a span with attributes
      const span = serviceInstrument.traces.startSpan("test-operation", {
        attributes: {
          "custom.attr": "expected-value",
          "operation.type": "test",
        },
      });
      span.end();

      // verify span was recorded with correct data
      expect(mockTracer.startSpan).toHaveBeenCalled();
      const recordedSpan = mockTracer.getSpan("test-operation");
      expect(recordedSpan).toBeDefined();
      expect(recordedSpan!.name).toBe("test-operation");
      expect(recordedSpan!.attributes["custom.attr"]).toBe("expected-value");
      expect(recordedSpan!.attributes["operation.type"]).toBe("test");
      expect(recordedSpan!.ended).toBe(true);
    });

    it("should record span status on error", () => {
      const serviceInstrument = client.getServiceInstrumentation();

      const span = serviceInstrument.traces.startSpan("error-operation");
      const testError = new Error("Test failure");

      span.recordException(testError);
      span.setStatus({ code: 2, message: "Operation failed" }); // ERROR status
      span.end();

      const recordedSpan = mockTracer.getSpan("error-operation");
      expect(recordedSpan).toBeDefined();
      expect(recordedSpan!.status.code).toBe(2);
      expect(recordedSpan!.status.message).toBe("Operation failed");
      expect(recordedSpan!.exception).toBe(testError);
    });

    it("should create spans via withSpan helper", async () => {
      const serviceInstrument = client.getServiceInstrumentation();

      await serviceInstrument.traces.withSpan("withspan-test", async () => {
        // simulated work
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "result";
      });

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();
      const recordedSpan = mockTracer.getSpan("withspan-test");
      expect(recordedSpan).toBeDefined();
      expect(recordedSpan!.ended).toBe(true);
    });

    it("should record error status when withSpan callback throws", async () => {
      const serviceInstrument = client.getServiceInstrumentation();

      await expect(
        serviceInstrument.traces.withSpan("failing-span", async () => {
          throw new Error("Intentional failure");
        }),
      ).rejects.toThrow("Intentional failure");

      const recordedSpan = mockTracer.getSpan("failing-span");
      expect(recordedSpan).toBeDefined();
      // status should indicate error (code 2 = ERROR in OTel)
      expect(recordedSpan!.status.code).toBe(2);
    });
  });

  describe("Metric Export Verification", () => {
    it("should record counter metrics with correct value", () => {
      const serviceInstrument = client.getServiceInstrumentation();

      // record counter metrics
      serviceInstrument.metrics.increment("test.counter", 5);
      serviceInstrument.metrics.increment("test.counter", 3);

      // verify counter was created and add was called
      expect(mockMeter.createCounter).toHaveBeenCalled();
      const counterCalls = mockMeter.getMetric("test.counter");
      expect(counterCalls.length).toBe(2);
      expect(counterCalls[0]!.value).toBe(5);
      expect(counterCalls[1]!.value).toBe(3);
    });

    it("should record gauge metrics with correct value", () => {
      const serviceInstrument = client.getServiceInstrumentation();

      // record gauge metrics - these set the internal value to be observed
      serviceInstrument.metrics.gauge("test.gauge", 42);
      serviceInstrument.metrics.gauge("test.gauge", 99);

      // verify gauge was created
      expect(mockMeter.createObservableGauge).toHaveBeenCalled();

      // simulate SDK metric collection to trigger observable callbacks
      mockMeter.triggerAllObservations();

      // verify the most recent gauge value was observed
      const gaugeCalls = mockMeter.getMetric("test.gauge");
      expect(gaugeCalls.length).toBeGreaterThanOrEqual(1);
      // the last value set (99) should be reported
      expect(gaugeCalls[gaugeCalls.length - 1]!.value).toBe(99);
    });

    it("should record histogram metrics with correct value", () => {
      const serviceInstrument = client.getServiceInstrumentation();

      const values = [10, 20, 30, 40, 50];
      values.forEach((v) => {
        serviceInstrument.metrics.record("test.histogram", v);
      });

      // verify histogram was created and record was called
      expect(mockMeter.createHistogram).toHaveBeenCalled();
      const histogramCalls = mockMeter.getMetric("test.histogram");
      expect(histogramCalls.length).toBe(5);
      expect(histogramCalls.map((h) => h.value)).toEqual(values);
    });

    it("should record metrics with correct attributes", () => {
      const serviceInstrument = client.getServiceInstrumentation();

      serviceInstrument.metrics.increment("attributed.counter", 1, {
        environment: "test",
        region: "us-east-1",
      });

      const counterCalls = mockMeter.getMetric("attributed.counter");
      expect(counterCalls.length).toBe(1);
      // use toMatchObject to allow for SDK-enriched attributes (release, version)
      expect(counterCalls[0]!.attributes).toMatchObject({
        environment: "test",
        region: "us-east-1",
      });
    });
  });

  describe("Scoped Instrument Telemetry", () => {
    it("should create scoped tracers with correct scope name", () => {
      const scopedInstrument = client.getInstrumentation("payment-service", "1.0.0");

      scopedInstrument.traces.startSpan("process-payment").end();

      // verify tracer was requested with scope name
      expect(mockTracerProvider.getTracer).toHaveBeenCalledWith(
        "payment-service",
        "1.0.0",
      );
    });

    it("should create scoped meters with correct scope name", () => {
      const scopedInstrument = client.getInstrumentation("auth-service", "2.0.0");

      scopedInstrument.metrics.increment("auth.attempts", 1);

      // verify meter was requested with scope name
      expect(mockMeterProvider.getMeter).toHaveBeenCalledWith(
        "auth-service",
        "2.0.0",
      );
    });
  });
});

describe("Telemetry Pipeline Edge Cases (Mock-Based)", () => {
  let client: UnifiedObservabilityClient;
  let mockTracer: ReturnType<typeof createMockTracer>;

  // uses module-level createMockTracer - no duplicate needed

  beforeEach(async () => {
    clearAllInstances();
    mockTracer = createMockTracer();

    const mockTracerProvider = {
      getTracer: vi.fn().mockReturnValue(mockTracer),
    };

    const mockMeterProvider = {
      getMeter: vi.fn().mockReturnValue({
        createCounter: vi.fn(() => ({ add: vi.fn() })),
        createUpDownCounter: vi.fn(() => ({ add: vi.fn() })),
        createHistogram: vi.fn(() => ({ record: vi.fn() })),
        createObservableGauge: vi.fn(() => ({ addCallback: vi.fn(), removeCallback: vi.fn() })),
      }),
    };

    client = await SmartClient.create({
      serviceName: "edge-case-test",
      environment: "node",
      existingTracerProvider: mockTracerProvider as unknown as Parameters<typeof SmartClient.create>[0]["existingTracerProvider"],
      existingMeterProvider: mockMeterProvider as unknown as Parameters<typeof SmartClient.create>[0]["existingMeterProvider"],
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

  it("should handle empty span attributes gracefully", () => {
    const instrument = client.getServiceInstrumentation();

    const span = instrument.traces.startSpan("empty-attrs", {
      attributes: {},
    });
    span.end();

    const recordedSpan = mockTracer.getSpan("empty-attrs");
    expect(recordedSpan).toBeDefined();
    expect(recordedSpan!.ended).toBe(true);
  });

  it("should handle special characters in span names", () => {
    const instrument = client.getServiceInstrumentation();

    const span = instrument.traces.startSpan("span:with/special.chars");
    span.end();

    const recordedSpan = mockTracer.getSpan("span:with/special.chars");
    expect(recordedSpan).toBeDefined();
  });

  it("should handle setAttribute calls after span creation", () => {
    const instrument = client.getServiceInstrumentation();

    const span = instrument.traces.startSpan("dynamic-attrs");
    span.setAttribute("added.later", "value");
    span.setAttribute("another.attr", 123);
    span.end();

    const recordedSpan = mockTracer.getSpan("dynamic-attrs");
    expect(recordedSpan).toBeDefined();
    expect(recordedSpan!.attributes["added.later"]).toBe("value");
    expect(recordedSpan!.attributes["another.attr"]).toBe(123);
  });
});
