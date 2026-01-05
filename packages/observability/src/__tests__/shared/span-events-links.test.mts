/**
 * Span Events and Links Tests (M5 Fix)
 *
 * Tests for OpenTelemetry span events and links - important concepts for:
 * - Events: Recording discrete occurrences within a span (e.g., "cache miss", "query started")
 * - Links: Connecting spans across different traces (e.g., async messaging, batch processing)
 *
 * Uses BYOP (Bring Your Own Provider) pattern with mock tracer for test isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanContext, Link, SpanOptions } from "@opentelemetry/api";
import { TraceFlags } from "@opentelemetry/api";

import { SmartClient } from "../../index.mjs";
import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

// track span operations for verification
interface SpanEvent {
  name: string;
  attributes?: Record<string, unknown>;
  timestamp?: number;
}

interface SpanLinkRecord {
  context: SpanContext;
  attributes?: Record<string, unknown>;
}

interface TrackedSpan {
  name: string;
  id: string; // unique id to handle multiple spans with same name
  events: SpanEvent[];
  links: SpanLinkRecord[];
  attributes: Record<string, unknown>;
  ended: boolean;
}

/**
 * normalizes OTel TimeInput (number | Date | [number, number]) to milliseconds
 */
function normalizeTimestamp(time: unknown): number | undefined {
  if (typeof time === "number") {
    return time;
  }
  if (time instanceof Date) {
    return time.getTime();
  }
  // HrTime [seconds, nanoseconds]
  if (Array.isArray(time) && time.length === 2 && typeof time[0] === "number" && typeof time[1] === "number") {
    return time[0] * 1000 + time[1] / 1_000_000;
  }
  return undefined;
}

/**
 * creates a mock tracer that tracks span events and links
 */
function createSpanTrackingTracer() {
  const spans: TrackedSpan[] = [];
  let spanIdCounter = 0;

  const createMockSpan = (name: string, options?: SpanOptions) => {
    const spanId = `span-${++spanIdCounter}`;
    const span: TrackedSpan = {
      name,
      id: spanId,
      events: [],
      links: (options?.links ?? []).map((link) => ({
        context: link.context,
        attributes: link.attributes as Record<string, unknown>,
      })),
      attributes: (options?.attributes as Record<string, unknown>) ?? {},
      ended: false,
    };
    spans.push(span);

    return {
      end: vi.fn(() => {
        span.ended = true;
      }),
      setAttribute: vi.fn((key: string, value: unknown) => {
        span.attributes[key] = value;
      }),
      setAttributes: vi.fn((attrs: Record<string, unknown>) => {
        Object.assign(span.attributes, attrs);
      }),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      isRecording: vi.fn().mockReturnValue(true),
      spanContext: vi.fn().mockReturnValue({
        traceId: `trace-${name}`,
        spanId,
        traceFlags: TraceFlags.SAMPLED,
      }),
      updateName: vi.fn(),
      // key method for M5 - handles all OTel TimeInput types
      addEvent: vi.fn((eventName: string, attributesOrTime?: Record<string, unknown> | number | Date | [number, number], timestamp?: number | Date | [number, number]) => {
        const event: SpanEvent = { name: eventName };

        // handle timestamp-only case: addEvent("name", timestamp)
        const normalizedTime = normalizeTimestamp(attributesOrTime);
        if (normalizedTime !== undefined) {
          event.timestamp = normalizedTime;
        } else if (attributesOrTime && typeof attributesOrTime === "object" && !Array.isArray(attributesOrTime) && !(attributesOrTime instanceof Date)) {
          // attributes case
          event.attributes = attributesOrTime as Record<string, unknown>;
          const ts = normalizeTimestamp(timestamp);
          if (ts !== undefined) {
            event.timestamp = ts;
          }
        }

        span.events.push(event);
      }),
      // links are set at span creation, not via addLink
      // (OTel API doesn't have addLink post-creation)
    };
  };

  const startSpan = vi.fn((name: string, options?: SpanOptions) => {
    return createMockSpan(name, options);
  });

  const mockTracerProvider = {
    getTracer: vi.fn(() => ({
      startSpan,
      startActiveSpan: vi.fn(),
    })),
    forceFlush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };

  return {
    mockTracerProvider,
    startSpan,
    // get first span matching name (for backward compatibility)
    getSpan: (name: string) => spans.find((s) => s.name === name),
    // get all spans matching name
    getSpansByName: (name: string) => spans.filter((s) => s.name === name),
    getSpans: () => spans,
    hasSpan: (name: string) => spans.some((s) => s.name === name),
  };
}

describe("Span Events and Links Tests (M5 Fix)", () => {
  let client: UnifiedObservabilityClient;
  let mockTracer: ReturnType<typeof createSpanTrackingTracer>;

  beforeEach(async () => {
    mockTracer = createSpanTrackingTracer();

    client = await SmartClient.initialize({
      serviceName: "span-events-links-test",
      environment: "node" as const,
      disableInstrumentation: true,
      existingTracerProvider: mockTracer.mockTracerProvider as unknown as Parameters<
        typeof SmartClient.initialize
      >[0]["existingTracerProvider"],
    });
  });

  afterEach(async () => {
    await SmartClient.shutdown();
    vi.restoreAllMocks();
  });

  describe("Span Events (addEvent)", () => {
    it("should support addEvent on spans", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("event-test");

      // verify addEvent method exists and is callable
      expect(typeof span.addEvent).toBe("function");

      // add an event
      span.addEvent("cache.miss", { key: "user:123" });
      span.end();

      // verify the event was recorded
      const trackedSpan = mockTracer.getSpan("event-test");
      expect(trackedSpan).toBeDefined();
      expect(trackedSpan!.events).toHaveLength(1);
      expect(trackedSpan!.events[0]).toEqual({
        name: "cache.miss",
        attributes: { key: "user:123" },
      });
    });

    it("should support multiple events on a single span", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("multi-event-test");

      span.addEvent("database.query.start", { table: "users" });
      span.addEvent("database.query.execute", { rowCount: 42 });
      span.addEvent("database.query.complete", { durationMs: 15 });
      span.end();

      const trackedSpan = mockTracer.getSpan("multi-event-test");
      expect(trackedSpan!.events).toHaveLength(3);
      expect(trackedSpan!.events.map((e) => e.name)).toEqual([
        "database.query.start",
        "database.query.execute",
        "database.query.complete",
      ]);
    });

    it("should support events without attributes", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("simple-event-test");

      span.addEvent("checkpoint.reached");
      span.end();

      const trackedSpan = mockTracer.getSpan("simple-event-test");
      expect(trackedSpan!.events[0]).toEqual({
        name: "checkpoint.reached",
      });
    });

    it("should support events with attributes and timestamp", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("timed-event-test");

      const timestamp = Date.now();
      span.addEvent("external.api.call", { endpoint: "/api/v1/data" }, timestamp);
      span.end();

      const trackedSpan = mockTracer.getSpan("timed-event-test");
      expect(trackedSpan!.events[0]).toEqual({
        name: "external.api.call",
        attributes: { endpoint: "/api/v1/data" },
        timestamp,
      });
    });

    it("should support events with timestamp only (no attributes)", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("timestamp-only-event");

      const timestamp = Date.now();
      span.addEvent("checkpoint", timestamp);
      span.end();

      const trackedSpan = mockTracer.getSpan("timestamp-only-event");
      expect(trackedSpan!.events[0]).toEqual({
        name: "checkpoint",
        timestamp,
      });
    });

    it("should support events with Date timestamp", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("date-timestamp-event");

      const date = new Date("2026-01-05T12:00:00Z");
      span.addEvent("scheduled.task", date);
      span.end();

      const trackedSpan = mockTracer.getSpan("date-timestamp-event");
      expect(trackedSpan!.events[0]).toEqual({
        name: "scheduled.task",
        timestamp: date.getTime(),
      });
    });

    it("should support events with HrTime timestamp", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("hrtime-timestamp-event");

      // HrTime: [seconds, nanoseconds]
      const hrTime: [number, number] = [1704456000, 500_000_000]; // 500ms
      span.addEvent("high.resolution.event", hrTime);
      span.end();

      const trackedSpan = mockTracer.getSpan("hrtime-timestamp-event");
      expect(trackedSpan!.events[0]).toEqual({
        name: "high.resolution.event",
        timestamp: 1704456000 * 1000 + 500, // converted to ms
      });
    });

    it("should support events with Date timestamp and attributes", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("date-attrs-event");

      const date = new Date("2026-01-05T12:00:00Z");
      span.addEvent("audit.log", { action: "login", userId: "user123" }, date);
      span.end();

      const trackedSpan = mockTracer.getSpan("date-attrs-event");
      expect(trackedSpan!.events[0]).toEqual({
        name: "audit.log",
        attributes: { action: "login", userId: "user123" },
        timestamp: date.getTime(),
      });
    });

    it("should handle events in error scenarios", () => {
      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("error-event-test");

      span.addEvent("operation.start");
      span.addEvent("error.detected", { errorCode: "E001", severity: "high" });
      span.recordException(new Error("Operation failed"));
      span.end();

      const trackedSpan = mockTracer.getSpan("error-event-test");
      expect(trackedSpan!.events).toHaveLength(2);
      expect(trackedSpan!.events[1]).toEqual({
        name: "error.detected",
        attributes: { errorCode: "E001", severity: "high" },
      });
    });
  });

  describe("Span Links", () => {
    it("should support creating spans with links", () => {
      const instrument = client.getServiceInstrumentation();

      // create a link to a "parent" trace (e.g., Kafka producer)
      const producerSpanContext: SpanContext = {
        traceId: "producer-trace-id",
        spanId: "producer-span-id",
        traceFlags: TraceFlags.SAMPLED,
      };

      const links: Link[] = [
        {
          context: producerSpanContext,
          attributes: { "messaging.operation": "receive" },
        },
      ];

      // create consumer span with link to producer
      const span = instrument.traces.startSpan("kafka.consume", { links });
      span.end();

      const trackedSpan = mockTracer.getSpan("kafka.consume");
      expect(trackedSpan).toBeDefined();
      expect(trackedSpan!.links).toHaveLength(1);
      expect(trackedSpan!.links[0]).toEqual({
        context: producerSpanContext,
        attributes: { "messaging.operation": "receive" },
      });
    });

    it("should support multiple links (batch processing)", () => {
      const instrument = client.getServiceInstrumentation();

      // simulate batch processing linking to multiple source traces
      const sourceTraces: Link[] = [
        {
          context: {
            traceId: "source-trace-1",
            spanId: "source-span-1",
            traceFlags: TraceFlags.SAMPLED,
          },
          attributes: { batchIndex: 0 },
        },
        {
          context: {
            traceId: "source-trace-2",
            spanId: "source-span-2",
            traceFlags: TraceFlags.SAMPLED,
          },
          attributes: { batchIndex: 1 },
        },
        {
          context: {
            traceId: "source-trace-3",
            spanId: "source-span-3",
            traceFlags: TraceFlags.SAMPLED,
          },
          attributes: { batchIndex: 2 },
        },
      ];

      const span = instrument.traces.startSpan("batch.process", { links: sourceTraces });
      span.end();

      const trackedSpan = mockTracer.getSpan("batch.process");
      expect(trackedSpan!.links).toHaveLength(3);
      expect(trackedSpan!.links.map((l) => l.context.traceId)).toEqual([
        "source-trace-1",
        "source-trace-2",
        "source-trace-3",
      ]);
    });

    it("should support links without attributes", () => {
      const instrument = client.getServiceInstrumentation();

      const links: Link[] = [
        {
          context: {
            traceId: "linked-trace",
            spanId: "linked-span",
            traceFlags: TraceFlags.SAMPLED,
          },
        },
      ];

      const span = instrument.traces.startSpan("linked-operation", { links });
      span.end();

      const trackedSpan = mockTracer.getSpan("linked-operation");
      expect(trackedSpan!.links[0].context.traceId).toBe("linked-trace");
      expect(trackedSpan!.links[0].attributes).toBeUndefined();
    });

    it("should handle unsampled linked traces", () => {
      const instrument = client.getServiceInstrumentation();

      // link to an unsampled trace (still valid for correlation)
      const links: Link[] = [
        {
          context: {
            traceId: "unsampled-trace",
            spanId: "unsampled-span",
            traceFlags: TraceFlags.NONE, // not sampled
          },
          attributes: { "sampling.decision": "not_sampled" },
        },
      ];

      const span = instrument.traces.startSpan("follow-unsampled", { links });
      span.end();

      const trackedSpan = mockTracer.getSpan("follow-unsampled");
      expect(trackedSpan!.links[0].context.traceFlags).toBe(TraceFlags.NONE);
    });
  });

  describe("Combined Events and Links", () => {
    it("should support both events and links on the same span", () => {
      const instrument = client.getServiceInstrumentation();

      const links: Link[] = [
        {
          context: {
            traceId: "trigger-trace",
            spanId: "trigger-span",
            traceFlags: TraceFlags.SAMPLED,
          },
          attributes: { trigger: "webhook" },
        },
      ];

      const span = instrument.traces.startSpan("async-job", { links });
      span.addEvent("job.started");
      span.addEvent("job.step.complete", { step: 1 });
      span.addEvent("job.step.complete", { step: 2 });
      span.addEvent("job.finished", { status: "success" });
      span.end();

      const trackedSpan = mockTracer.getSpan("async-job");
      expect(trackedSpan!.links).toHaveLength(1);
      expect(trackedSpan!.links[0].context.traceId).toBe("trigger-trace");
      expect(trackedSpan!.events).toHaveLength(4);
      expect(trackedSpan!.events.map((e) => e.name)).toEqual([
        "job.started",
        "job.step.complete",
        "job.step.complete",
        "job.finished",
      ]);
    });
  });

  describe("Multiple Spans with Same Name", () => {
    it("should track all spans even when names are duplicated", () => {
      const instrument = client.getServiceInstrumentation();

      // simulate multiple HTTP requests with same operation name
      const span1 = instrument.traces.startSpan("http.request");
      span1.addEvent("request.start", { requestId: "req-001" });
      span1.end();

      const span2 = instrument.traces.startSpan("http.request");
      span2.addEvent("request.start", { requestId: "req-002" });
      span2.end();

      const span3 = instrument.traces.startSpan("http.request");
      span3.addEvent("request.start", { requestId: "req-003" });
      span3.end();

      // verify all spans are tracked
      const allSpans = mockTracer.getSpansByName("http.request");
      expect(allSpans).toHaveLength(3);

      // verify each span has unique ID
      const spanIds = allSpans.map((s) => s.id);
      expect(new Set(spanIds).size).toBe(3);

      // verify events are correctly associated
      expect(allSpans[0]!.events[0].attributes?.requestId).toBe("req-001");
      expect(allSpans[1]!.events[0].attributes?.requestId).toBe("req-002");
      expect(allSpans[2]!.events[0].attributes?.requestId).toBe("req-003");
    });

    it("should return first span with getSpan for backward compatibility", () => {
      const instrument = client.getServiceInstrumentation();

      instrument.traces.startSpan("dup-test").end();
      instrument.traces.startSpan("dup-test").end();

      // getSpan returns first match for backward compat
      const firstSpan = mockTracer.getSpan("dup-test");
      expect(firstSpan?.id).toBe("span-1");

      // getSpansByName returns all
      const allSpans = mockTracer.getSpansByName("dup-test");
      expect(allSpans).toHaveLength(2);
    });
  });

  describe("Real-World Scenarios", () => {
    it("should support Kafka consumer→producer linking pattern", () => {
      const instrument = client.getServiceInstrumentation();

      // simulate receiving message with producer trace context
      const producerContext: SpanContext = {
        traceId: "kafka-producer-trace",
        spanId: "kafka-producer-span",
        traceFlags: TraceFlags.SAMPLED,
      };

      const consumerSpan = instrument.traces.startSpan("kafka.message.process", {
        links: [{ context: producerContext, attributes: { "messaging.kafka.topic": "orders" } }],
        attributes: { "messaging.system": "kafka", "messaging.destination": "orders" },
      });

      consumerSpan.addEvent("message.received");
      consumerSpan.addEvent("message.validated");
      consumerSpan.addEvent("message.processed");
      consumerSpan.end();

      const trackedSpan = mockTracer.getSpan("kafka.message.process");
      expect(trackedSpan!.links[0].context.traceId).toBe("kafka-producer-trace");
      expect(trackedSpan!.events).toHaveLength(3);
      expect(trackedSpan!.attributes["messaging.system"]).toBe("kafka");
    });

    it("should support HTTP request with retry events", () => {
      const instrument = client.getServiceInstrumentation();

      const span = instrument.traces.startSpan("http.request", {
        attributes: { "http.method": "POST", "http.url": "https://api.example.com/data" },
      });

      span.addEvent("request.attempt", { attemptNumber: 1 });
      span.addEvent("request.failed", { statusCode: 503, reason: "Service Unavailable" });
      span.addEvent("request.retry.scheduled", { delayMs: 1000 });
      span.addEvent("request.attempt", { attemptNumber: 2 });
      span.addEvent("request.success", { statusCode: 200 });
      span.end();

      const trackedSpan = mockTracer.getSpan("http.request");
      expect(trackedSpan!.events).toHaveLength(5);

      // verify retry flow is captured
      const attemptEvents = trackedSpan!.events.filter((e) => e.name === "request.attempt");
      expect(attemptEvents).toHaveLength(2);
      expect(attemptEvents[0].attributes?.attemptNumber).toBe(1);
      expect(attemptEvents[1].attributes?.attemptNumber).toBe(2);
    });

    it("should support cron job with linked scheduled task trace", () => {
      const instrument = client.getServiceInstrumentation();

      // link to the scheduler that triggered this job
      const schedulerContext: SpanContext = {
        traceId: "scheduler-trace",
        spanId: "scheduler-span",
        traceFlags: TraceFlags.SAMPLED,
      };

      const span = instrument.traces.startSpan("cron.daily-cleanup", {
        links: [{ context: schedulerContext, attributes: { "cron.schedule": "0 0 * * *" } }],
      });

      span.addEvent("cleanup.started", { targetTables: ["sessions", "logs"] });
      span.addEvent("table.cleaned", { table: "sessions", rowsDeleted: 1523 });
      span.addEvent("table.cleaned", { table: "logs", rowsDeleted: 45678 });
      span.addEvent("cleanup.completed", { totalRowsDeleted: 47201 });
      span.end();

      const trackedSpan = mockTracer.getSpan("cron.daily-cleanup");
      expect(trackedSpan!.links[0].attributes?.["cron.schedule"]).toBe("0 0 * * *");
      expect(trackedSpan!.events[3].attributes?.totalRowsDeleted).toBe(47201);
    });
  });
});
