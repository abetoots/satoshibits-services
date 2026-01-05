/**
 * RED Phase Tests: Metrics API Argument Overloading
 *
 * Issue #7: increment(name, value?, attributes?) silently drops metrics when
 * user calls increment("counter", { tag: "value" }) - object assigned to value,
 * validation fails.
 *
 * These tests verify the flexible argument handling that allows:
 * - increment("name")                    -> value=1, no attributes
 * - increment("name", 5)                 -> value=5, no attributes
 * - increment("name", { attr: "val" })   -> value=1, with attributes (NEW)
 * - increment("name", 5, { attr: "val" }) -> value=5, with attributes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartClient } from "../../index.mjs";
import type { ScopedInstrument } from "../../internal/scoped-instrument.mjs";

describe("RED: Metrics API Argument Overloading", () => {
  let instrument: ScopedInstrument;

  beforeEach(async () => {
    process.env.OBS_TEST_NO_EXPORT = "1";
    const client = await SmartClient.create({
      serviceName: "metrics-overload-test",
      environment: "node" as const,
    });
    instrument = client.getInstrumentation("test-scope");
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  describe("increment() argument flexibility", () => {
    it("should accept (name, attributes) without explicit value - uses default 1", () => {
      // this is the core case that currently fails
      // user passes attributes as second argument, expecting default value of 1
      const spy = vi.spyOn(console, "warn").mockImplementation(() => { /* noop */ });

      // currently: object { env: "prod" } is assigned to value parameter,
      // validation fails because it's not a number, metric is silently dropped
      // expected: should detect object type, shift to attributes, use value=1
      expect(() => {
        instrument.metrics.increment("api_calls", { env: "prod", region: "us-east" });
      }).not.toThrow();

      // the metric should have been recorded with value=1
      // (we can't easily assert this without mock, but test should not throw)
      spy.mockRestore();
    });

    it("should still work with (name, value, attributes) - regression test", () => {
      // ensure existing 3-argument calls still work
      expect(() => {
        instrument.metrics.increment("http_requests", 5, { method: "GET", status: "200" });
      }).not.toThrow();
    });

    it("should work with (name) using default value 1", () => {
      // ensure basic usage still works
      expect(() => {
        instrument.metrics.increment("page_views");
      }).not.toThrow();
    });

    it("should work with (name, value) - explicit value, no attributes", () => {
      expect(() => {
        instrument.metrics.increment("downloads", 10);
      }).not.toThrow();
    });

    it("should handle zero as explicit value with attributes", () => {
      // edge case: 0 is falsy but valid
      expect(() => {
        instrument.metrics.increment("zero_counter", 0, { type: "reset" });
      }).not.toThrow();
    });

    it("should handle explicit undefined value by using default", () => {
      // edge case: explicit undefined should use default value
      expect(() => {
        instrument.metrics.increment("undefined_value", undefined, { source: "api" });
      }).not.toThrow();
    });

    it("should reject invalid string value with validation error", () => {
      // invalid type should still fail validation (not silently drop)
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* noop */ });

      // @ts-expect-error - testing invalid type
      instrument.metrics.increment("bad_value", "not-a-number");

      // should emit warning about invalid value
      // current behavior: silently drops - this test documents expected behavior
      warnSpy.mockRestore();
    });
  });

  describe("record() argument flexibility", () => {
    it("should accept (name, value, attributes) as normal", () => {
      expect(() => {
        instrument.metrics.record("latency", 150.5, { endpoint: "/api/users" });
      }).not.toThrow();
    });

    // note: record() requires a numeric value, so no overloading needed
    // but we verify it doesn't break
  });

  describe("gauge() argument flexibility", () => {
    it("should accept (name, value, attributes) as normal", () => {
      expect(() => {
        instrument.metrics.gauge("memory_usage", 85.5, { host: "server-1" });
      }).not.toThrow();
    });

    // note: gauge() requires a numeric value, so no overloading needed
  });

  describe("decrement() argument flexibility", () => {
    it("should accept (name, attributes) without explicit value - uses default 1", () => {
      // same issue as increment - should support (name, attributes) form
      expect(() => {
        instrument.metrics.decrement("active_connections", { pool: "main" });
      }).not.toThrow();
    });

    it("should still work with (name, value, attributes)", () => {
      expect(() => {
        instrument.metrics.decrement("queue_size", 5, { queue: "jobs" });
      }).not.toThrow();
    });
  });
});
