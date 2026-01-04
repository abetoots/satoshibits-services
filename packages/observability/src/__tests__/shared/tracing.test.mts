/**
 * Shared Tracing Functionality Tests
 *
 * Tests the public tracing API across environments without testing OTEL internals.
 * Uses MockObservabilityClient to verify API behavior and span recording.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { MockObservabilityClient } from "../test-utils/mock-client.mjs";

describe("Tracing API - Shared Functionality", () => {
  let client: MockObservabilityClient;

  beforeEach(() => {
    client = new MockObservabilityClient();
  });

  describe("Span Creation", () => {
    it("Should create spans with startSpan", () => {
      const span = client.traces.startSpan("user_operation");

      expect(span).toBeDefined();
      expect(typeof span.end).toBe("function");
      expect(typeof span.setStatus).toBe("function");
      expect(typeof span.setAttribute).toBe("function");
      expect(typeof span.recordException).toBe("function");

      span.end();

      expect(client.traces.hasSpan("user_operation")).toBe(true);
    });

    it("Should create spans with attributes", () => {
      const span = client.traces.startSpan("database_query", {
        attributes: {
          table: "users",
          operation: "SELECT",
          userId: "12345",
        },
      });

      span.end();

      const recordedSpan = client.traces.getSpan("database_query");
      expect(recordedSpan).toBeDefined();
      expect(recordedSpan?.attributes).toEqual({
        table: "users",
        operation: "SELECT",
        userId: "12345",
      });
    });

    it("Should set span attributes after creation", () => {
      const span = client.traces.startSpan("api_request");

      span.setAttribute("method", "POST");
      span.setAttribute("endpoint", "/api/orders");
      span.setAttribute("statusCode", 201);

      span.end();

      const recordedSpan = client.traces.getSpan("api_request");
      expect(recordedSpan?.attributes).toEqual({
        method: "POST",
        endpoint: "/api/orders",
        statusCode: 201,
      });
    });

    it("Should set span status", () => {
      const span = client.traces.startSpan("failing_operation");

      span.setStatus({ code: 2 }); // ERROR status
      span.end();

      const recordedSpan = client.traces.getSpan("failing_operation");
      expect(recordedSpan?.status).toBe("ERROR");
    });

    it("Should record exceptions on spans", () => {
      const span = client.traces.startSpan("exception_operation");
      const error = new Error("Operation failed");

      span.recordException(error);
      span.end();

      const recordedSpan = client.traces.getSpan("exception_operation");
      expect(recordedSpan?.error).toBe(error);
    });
  });

  describe("Automatic Span Management with withSpan", () => {
    it("Should execute function within span context", async () => {
      let executedInSpan = false;

      const result = await client.traces.withSpan(
        "auto_span_operation",
        async () => {
          executedInSpan = true;
          return "success";
        },
      );

      expect(result).toBe("success");
      expect(executedInSpan).toBe(true);
      expect(client.traces.hasSpan("auto_span_operation")).toBe(true);

      const recordedSpan = client.traces.getSpan("auto_span_operation");
      expect(recordedSpan?.status).toBe("OK");
      expect(typeof recordedSpan?.duration).toBe("number");
    });

    it("Should handle errors in withSpan", async () => {
      const testError = new Error("Span operation failed");

      await expect(
        client.traces.withSpan("failing_span", async () => {
          throw testError;
        }),
      ).rejects.toThrow("Span operation failed");

      expect(client.traces.hasSpan("failing_span")).toBe(true);

      const recordedSpan = client.traces.getSpan("failing_span");
      expect(recordedSpan?.status).toBe("ERROR");
      expect(recordedSpan?.error).toBe(testError);
      expect(typeof recordedSpan?.duration).toBe("number");

      // Should also record error via error API
      const errors = client.errors.getRecorded();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error).toBe(testError);
      expect(errors[0]!.context?.span).toBe("failing_span");
    });

    it("Should support withSpan with attributes", async () => {
      const result = await client.traces.withSpan(
        "attributed_operation",
        async () => {
          return { processed: 42 };
        },
        {
          attributes: {
            component: "data_processor",
            version: "1.0.0",
          },
        },
      );

      expect(result).toEqual({ processed: 42 });

      const recordedSpan = client.traces.getSpan("attributed_operation");
      expect(recordedSpan?.attributes).toEqual({
        component: "data_processor",
        version: "1.0.0",
      });
    });
  });

  describe("Top-level Trace Method", () => {
    it("Should provide convenient trace method", async () => {
      const result = await client.trace("convenience_operation", async () => {
        return "traced_result";
      });

      expect(result).toBe("traced_result");
      expect(client.traces.hasSpan("convenience_operation")).toBe(true);

      const recordedSpan = client.traces.getSpan("convenience_operation");
      expect(recordedSpan?.status).toBe("OK");
    });

    it("Should handle trace method with options", async () => {
      const result = await client.trace(
        "optioned_trace",
        async () => "success",
        { attributes: { level: "high" } },
      );

      expect(result).toBe("success");

      const recordedSpan = client.traces.getSpan("optioned_trace");
      expect(recordedSpan?.attributes).toEqual({ level: "high" });
    });
  });

  describe("Active Span Management", () => {
    it("Should track active span", () => {
      // Initially no active span
      expect(client.traces.getActiveSpan()).toBeUndefined();

      const span = client.traces.startSpan("active_test");
      span.end();

      // After creating a span, it should be the active one
      const activeSpan = client.traces.getActiveSpan();
      expect(activeSpan).toBeDefined();
      expect(activeSpan?.name).toBe("active_test");
    });

    it("Should update active span with nested spans", () => {
      const span1 = client.traces.startSpan("outer_span");
      span1.end();

      expect(client.traces.getActiveSpan()?.name).toBe("outer_span");

      const span2 = client.traces.startSpan("inner_span");
      span2.end();

      // Most recent span should be active
      expect(client.traces.getActiveSpan()?.name).toBe("inner_span");
    });
  });

  describe("Nested Spans and Context Propagation", () => {
    it("Should handle nested withSpan calls", async () => {
      const results: string[] = [];

      await client.traces.withSpan("outer_operation", async () => {
        results.push("outer_start");

        await client.traces.withSpan("inner_operation", async () => {
          results.push("inner_executed");
        });

        results.push("outer_end");
      });

      expect(results).toEqual(["outer_start", "inner_executed", "outer_end"]);
      expect(client.traces.hasSpan("outer_operation")).toBe(true);
      expect(client.traces.hasSpan("inner_operation")).toBe(true);

      const spans = client.traces.getSpans();
      expect(spans).toHaveLength(2);
    });

    it("Should maintain span context across async operations", async () => {
      await client.traces.withSpan("async_parent", async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 1));

        await client.traces.withSpan("async_child", async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
        });
      });

      const parentSpan = client.traces.getSpan("async_parent");
      const childSpan = client.traces.getSpan("async_child");

      expect(parentSpan).toBeDefined();
      expect(childSpan).toBeDefined();
      expect(parentSpan?.status).toBe("OK");
      expect(childSpan?.status).toBe("OK");
    });
  });

  describe("Span Timing", () => {
    it("Should record span duration", async () => {
      const startTime = Date.now();

      await client.traces.withSpan("timed_operation", async () => {
        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const endTime = Date.now();
      const recordedSpan = client.traces.getSpan("timed_operation");

      expect(recordedSpan?.duration).toBeGreaterThan(0);
      expect(recordedSpan?.duration).toBeLessThan(endTime - startTime + 50); // Allow some margin
    });

    it("Should record duration even for failed spans", async () => {
      await expect(
        client.traces.withSpan("failed_timed", async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error("Deliberate failure");
        }),
      ).rejects.toThrow("Deliberate failure");

      const recordedSpan = client.traces.getSpan("failed_timed");
      expect(recordedSpan?.duration).toBeGreaterThan(0);
      expect(recordedSpan?.status).toBe("ERROR");
    });
  });

  describe("Integration with Other APIs", () => {
    it("Should work with metrics timing", async () => {
      await client.traces.withSpan("traced_metrics", async () => {
        // Record metrics within span
        client.metrics.increment("operations_count");
        client.metrics.gauge("current_load", 0.75);

        await client.metrics.timing("nested_operation", async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      });

      // Both tracing and metrics should work
      expect(client.traces.hasSpan("traced_metrics")).toBe(true);
      expect(client.metrics.hasIncremented("operations_count")).toBe(true);
      expect(client.metrics.hasGauge("current_load")).toBe(true);
      expect(client.metrics.hasRecorded("nested_operation.duration")).toBe(
        true,
      );
    });

    it("Should work with error recording", async () => {
      const testError = new Error("Integration test error");

      await client.traces.withSpan("error_integration", async () => {
        client.errors.record(testError, { source: "manual" });
      });

      expect(client.traces.hasSpan("error_integration")).toBe(true);

      const errors = client.errors.getRecorded();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error).toBe(testError);
      expect(errors[0]!.context?.source).toBe("manual");
    });

    it("Should work with context and breadcrumbs", async () => {
      await client.traces.withSpan("context_integration", async () => {
        client.context.addBreadcrumb("Started processing", { step: 1 });
        client.context.setUser("user123", { role: "admin" });
        client.context.addTag("environment", "test");

        client.context.addBreadcrumb("Completed processing", { step: 2 });
      });

      expect(client.traces.hasSpan("context_integration")).toBe(true);

      const breadcrumbs = client.context.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(2);
      expect(breadcrumbs[0]!.message).toBe("Started processing");
      expect(breadcrumbs[1]!.message).toBe("Completed processing");

      const user = client.context.getUser();
      expect(user?.id).toBe("user123");

      const tags = client.context.getTags();
      expect(tags).toHaveLength(1);
      expect(tags[0]!.key).toBe("environment");
    });
  });

  describe("Test Helpers and Inspection", () => {
    it("Should provide test helper methods", () => {
      client.traces.startSpan("helper_test_1").end();
      client.traces.startSpan("helper_test_2").end();

      // Test inspection methods
      expect(client.traces.hasSpan("helper_test_1")).toBe(true);
      expect(client.traces.hasSpan("nonexistent")).toBe(false);

      const span1 = client.traces.getSpan("helper_test_1");
      expect(span1?.name).toBe("helper_test_1");

      const allSpans = client.traces.getSpans();
      expect(allSpans).toHaveLength(2);
      expect(allSpans.map((s) => s.name)).toContain("helper_test_1");
      expect(allSpans.map((s) => s.name)).toContain("helper_test_2");
    });

    it("Should provide top-level span helpers", () => {
      client.traces.startSpan("findable_span").end();

      const span = client.findSpan("findable_span");
      expect(span?.name).toBe("findable_span");

      const allSpans = client.getSpans();
      expect(allSpans).toHaveLength(1);
      expect(allSpans[0]!.name).toBe("findable_span");
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("Should handle spans with null/undefined names", () => {
      // MockObservabilityClient should handle edge cases gracefully
      expect(() => {
        // @ts-expect-error - Testing null span name handling
        const span = client.traces.startSpan(null);
        span.end();
      }).not.toThrow();
    });

    it("Should handle null/undefined attributes", () => {
      expect(() => {
        client.traces
          .startSpan("null_attrs", {
            attributes: {
              valid: "value",
              nullValue: null,
              undefinedValue: undefined,
            },
          })
          .end();
      }).not.toThrow();

      const span = client.traces.getSpan("null_attrs");
      expect(span?.attributes).toEqual({
        valid: "value",
        nullValue: null,
        undefinedValue: undefined,
      });
    });

    it("Should handle multiple setAttribute calls", () => {
      const span = client.traces.startSpan("multi_attrs");

      span.setAttribute("first", "value1");
      span.setAttribute("second", "value2");
      span.setAttribute("first", "updated_value"); // Should update

      span.end();

      const recorded = client.traces.getSpan("multi_attrs");
      expect(recorded?.attributes).toEqual({
        first: "updated_value",
        second: "value2",
      });
    });

    it("Should handle multiple setStatus calls", () => {
      const span = client.traces.startSpan("status_test");

      span.setStatus({ code: 1 }); // OK
      span.setStatus({ code: 2 }); // ERROR (should update)

      span.end();

      const recorded = client.traces.getSpan("status_test");
      expect(recorded?.status).toBe("ERROR");
    });
  });

  describe("Reset and Cleanup", () => {
    it("Should clear spans when client is reset", () => {
      client.traces.startSpan("temp_span_1").end();
      client.traces.startSpan("temp_span_2").end();

      expect(client.traces.getSpans()).toHaveLength(2);

      client.reset();

      expect(client.traces.getSpans()).toHaveLength(0);
      expect(client.traces.hasSpan("temp_span_1")).toBe(false);
      expect(client.traces.hasSpan("temp_span_2")).toBe(false);
    });
  });
});
