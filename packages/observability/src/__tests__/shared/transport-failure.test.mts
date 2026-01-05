/**
 * Transport Failure Handling Tests (M6 Fix)
 *
 * Tests that the SDK handles exporter failures gracefully:
 * - Recording operations don't crash when export fails
 * - SDK continues functioning during transport failures
 * - Shutdown works even when exporters are failing
 *
 * Uses testSpanProcessor to inject failing span processors.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpanProcessor, ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";
import { SpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { SmartClient } from "../../index.mjs";
import { Context } from "@opentelemetry/api";

/**
 * creates a span exporter that always fails
 */
function createFailingSpanExporter(config: {
  failureMessage?: string;
  failOnShutdown?: boolean;
}): SpanExporter & { getExportAttempts: () => number } {
  let exportAttempts = 0;

  return {
    export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      exportAttempts++;
      // simulate network/transport failure
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error(config.failureMessage ?? "Simulated transport failure"),
      });
    },
    shutdown(): Promise<void> {
      if (config.failOnShutdown) {
        return Promise.reject(new Error("Shutdown failed"));
      }
      return Promise.resolve();
    },
    getExportAttempts: () => exportAttempts,
  };
}

/**
 * creates a span exporter that fails intermittently
 */
function createIntermittentFailingExporter(config: {
  failAfterN: number; // fail after N successful exports
}): SpanExporter & { getExportAttempts: () => number; getFailureCount: () => number } {
  let exportAttempts = 0;
  let failureCount = 0;

  return {
    export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      exportAttempts++;
      if (exportAttempts > config.failAfterN) {
        failureCount++;
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new Error("Network failure after initial success"),
        });
      } else {
        resultCallback({ code: ExportResultCode.SUCCESS });
      }
    },
    shutdown(): Promise<void> {
      return Promise.resolve();
    },
    getExportAttempts: () => exportAttempts,
    getFailureCount: () => failureCount,
  };
}

/**
 * creates a span processor that throws during forceFlush
 */
function createThrowingSpanProcessor(): SpanProcessor & { wasForceFlushCalled: () => boolean } {
  let forceFlushCalled = false;

  return {
    onStart(_span: Span, _parentContext: Context): void {
      // no-op
    },
    onEnd(_span: ReadableSpan): void {
      // no-op
    },
    forceFlush(): Promise<void> {
      forceFlushCalled = true;
      return Promise.reject(new Error("forceFlush failed - simulated transport error"));
    },
    shutdown(): Promise<void> {
      return Promise.reject(new Error("shutdown failed - simulated transport error"));
    },
    wasForceFlushCalled: () => forceFlushCalled,
  };
}

describe("Transport Failure Handling Tests (M6 Fix)", () => {
  afterEach(async () => {
    try {
      await SmartClient.shutdown();
    } catch {
      // ignore shutdown errors in cleanup
    }
    vi.restoreAllMocks();
  });

  describe("Exporter Failure Handling", () => {
    it("should not crash when span exporter fails", async () => {
      const failingExporter = createFailingSpanExporter({
        failureMessage: "ECONNREFUSED",
      });

      const client = await SmartClient.initialize({
        serviceName: "exporter-failure-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // recording should not throw even though export will fail
      expect(() => {
        const span = instrument.traces.startSpan("operation-during-failure");
        span.setAttribute("key", "value");
        span.end();
      }).not.toThrow();

      // key assertion: operation completed without crash
      // note: SimpleSpanProcessor exports synchronously on span.end()
      // the exporter's failure callback is invoked but doesn't propagate
    });

    it("should continue recording after export failures", async () => {
      const failingExporter = createFailingSpanExporter({
        failureMessage: "Network unreachable",
      });

      const client = await SmartClient.initialize({
        serviceName: "continue-after-failure-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // create multiple spans - all should work without throwing
      for (let i = 0; i < 10; i++) {
        expect(() => {
          instrument.traces.startSpan(`operation-${i}`).end();
        }).not.toThrow();
      }

      // key assertion: operations completed without crash
      // export attempts tracked by processor (may vary based on SDK batching)
    });

    it("should handle intermittent failures gracefully", async () => {
      const intermittentExporter = createIntermittentFailingExporter({
        failAfterN: 3, // first 3 succeed, then fail
      });

      const client = await SmartClient.initialize({
        serviceName: "intermittent-failure-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(intermittentExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // create 10 spans - first 3 exports succeed, rest fail
      // key behavior: none should throw
      for (let i = 0; i < 10; i++) {
        expect(() => {
          instrument.traces.startSpan(`operation-${i}`).end();
        }).not.toThrow();
      }

      // key assertion: operations completed without crash despite mixed success/failure
    });
  });

  // Note: Span processor throwing tests moved to end of suite to avoid
  // affecting other tests (see "Span Processor Throwing Errors" describe block)

  describe("API Stability During Failures", () => {
    it("should maintain API availability during transport failures", async () => {
      const failingExporter = createFailingSpanExporter({});

      const client = await SmartClient.initialize({
        serviceName: "api-stability-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // all API methods should remain functional
      expect(() => {
        // tracing
        const span = instrument.traces.startSpan("api-test");
        span.setAttribute("key", "value");
        span.addEvent("event", { detail: "info" });
        span.end();

        // metrics (these don't go through the span processor)
        instrument.metrics.increment("counter", 1);
        instrument.metrics.gauge("gauge", 42);
        instrument.metrics.record("histogram", 100);

        // errors
        instrument.errors.record(new Error("test"));

        // logs
        instrument.logs.info("test log");
      }).not.toThrow();
    });

    it("should return valid span objects during failures", async () => {
      const failingExporter = createFailingSpanExporter({});

      const client = await SmartClient.initialize({
        serviceName: "span-validity-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();
      const span = instrument.traces.startSpan("valid-span-test");

      // span should have all expected methods
      expect(typeof span.end).toBe("function");
      expect(typeof span.setAttribute).toBe("function");
      expect(typeof span.setAttributes).toBe("function");
      expect(typeof span.setStatus).toBe("function");
      expect(typeof span.recordException).toBe("function");
      expect(typeof span.addEvent).toBe("function");
      expect(typeof span.isRecording).toBe("function");

      // methods should work
      span.setAttribute("key", "value");
      span.addEvent("test-event");
      span.end();
    });
  });

  describe("Async Operation Resilience", () => {
    it("should handle withSpan during export failures", async () => {
      const failingExporter = createFailingSpanExporter({});

      const client = await SmartClient.initialize({
        serviceName: "withspan-failure-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // withSpan should work and return the value even when export fails
      const result = await instrument.traces.withSpan("async-operation", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "success";
      });

      expect(result).toBe("success");
      // note: export may or may not be attempted depending on SDK state
    });

    it("should propagate application errors (not transport errors) from withSpan", async () => {
      const failingExporter = createFailingSpanExporter({});

      const client = await SmartClient.initialize({
        serviceName: "app-error-propagation-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // application errors should propagate, not be swallowed
      await expect(
        instrument.traces.withSpan("failing-operation", () => {
          throw new Error("Application error");
        }),
      ).rejects.toThrow("Application error");
    });
  });

  describe("Error Isolation", () => {
    it("should isolate transport errors from application code", async () => {
      const failingExporter = createFailingSpanExporter({
        failureMessage: "Transport layer error - should not reach app",
      });

      const client = await SmartClient.initialize({
        serviceName: "error-isolation-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(failingExporter),
      } as Parameters<typeof SmartClient.initialize>[0]);

      const instrument = client.getServiceInstrumentation();

      // no errors should propagate from failed exports
      const errors: Error[] = [];
      try {
        for (let i = 0; i < 5; i++) {
          instrument.traces.startSpan(`operation-${i}`).end();
        }
      } catch (e) {
        errors.push(e as Error);
      }

      expect(errors).toHaveLength(0);
      // note: export attempts may vary depending on SDK state
    });
  });

  // put throwing processor tests last to avoid affecting other tests
  describe("Span Processor Throwing Errors (runs last)", () => {
    it("should handle shutdown failures gracefully (at end of suite)", async () => {
      const throwingProcessor = createThrowingSpanProcessor();

      await SmartClient.initialize({
        serviceName: "shutdown-failure-final-test",
        environment: "node" as const,
        disableInstrumentation: true,
        testSpanProcessor: throwingProcessor,
      } as Parameters<typeof SmartClient.initialize>[0]);

      // shutdown should not throw even when processor.shutdown rejects
      // note: the SDK logs the error but should not propagate it
      await expect(SmartClient.shutdown()).resolves.not.toThrow();
    });
  });
});

describe("Real Transport Failure Scenarios", () => {
  afterEach(async () => {
    try {
      await SmartClient.shutdown();
    } catch {
      // ignore
    }
  });

  it("should handle network-like failures without crashing", async () => {
    // create an exporter that simulates real network errors
    const networkErrorExporter: SpanExporter = {
      export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        // simulate various network errors
        const errors = [
          "ECONNREFUSED",
          "ETIMEDOUT",
          "ENOTFOUND",
          "ENETUNREACH",
        ];
        const errorMessage = errors[Math.floor(Math.random() * errors.length)];
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new Error(`connect ${errorMessage} 127.0.0.1:4318`),
        });
      },
      shutdown(): Promise<void> {
        return Promise.resolve();
      },
    };

    const client = await SmartClient.initialize({
      serviceName: "network-error-test",
      environment: "node" as const,
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(networkErrorExporter),
    } as Parameters<typeof SmartClient.initialize>[0]);

    const instrument = client.getServiceInstrumentation();

    // should handle all network error types gracefully
    for (let i = 0; i < 20; i++) {
      expect(() => {
        instrument.traces.startSpan(`network-test-${i}`).end();
      }).not.toThrow();
    }
  });
});
