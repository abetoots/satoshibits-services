/**
 * Bring Your Own Provider (BYOP) Tests
 *
 * API Boundary Fix - Issue #5: No Hook to Reuse Existing OTel Providers
 *
 * Tests verify that:
 * 1. skipSdkInitialization skips internal SDK setup
 * 2. existingTracerProvider is used when provided
 * 3. existingMeterProvider is used when provided
 * 4. Integration with frameworks that pre-configure OTel works correctly
 */

import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAllInstances } from "../../client-instance.mjs";
import { SmartClient } from "../../index.mjs";

describe("Bring Your Own Provider (BYOP)", () => {
  beforeEach(() => {
    clearAllInstances();
  });

  afterEach(async () => {
    try {
      await SmartClient.shutdown();
    } catch {
      // ignore errors during cleanup
    }
    clearAllInstances();
  });

  describe("skipSdkInitialization", () => {
    it("should skip SDK initialization when skipSdkInitialization is true", async () => {
      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {
        /* noop */
      });

      const client = await SmartClient.create({
        serviceName: "skip-init-test",
        environment: "node",
        skipSdkInitialization: true,
      });

      // should log that SDK initialization was skipped
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping SDK initialization"),
      );

      // client should still be functional using global providers
      expect(client).toBeDefined();
      expect(client.isDestroyed).toBe(false);

      // should be able to get instrumentation
      const scope = client.getInstrumentation("test-scope");
      expect(scope).toBeDefined();

      // should be able to use metrics/logs (they use global providers)
      expect(() => {
        client.metrics.increment("test_metric", 1);
        client.logs.info("test log");
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it("should use global tracer provider when skipSdkInitialization is true", async () => {
      // get the global tracer provider before initialization
      const globalTracerProvider = trace.getTracerProvider();

      const client = await SmartClient.create({
        serviceName: "global-tracer-test",
        environment: "node",
        skipSdkInitialization: true,
      });

      // verify we're using the global provider (by checking we get a tracer from it)
      const scope = client.getInstrumentation("test-scope");
      expect(scope.traces).toBeDefined();

      // the global provider should still be the same
      expect(trace.getTracerProvider()).toBe(globalTracerProvider);
    });
  });

  describe("existingTracerProvider", () => {
    it("should use provided tracer provider", async () => {
      // create a mock tracer provider
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue({
          end: vi.fn(),
          setAttribute: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          isRecording: () => true,
          spanContext: () => ({
            traceId: "mock-trace-id",
            spanId: "mock-span-id",
            traceFlags: 1,
          }),
        }),
        startActiveSpan: vi.fn(
          (
            _name: string,
            options: unknown,
            context?: unknown,
            fn?: unknown,
          ) => {
            const span = {
              end: vi.fn(),
              setAttribute: vi.fn(),
              setStatus: vi.fn(),
              recordException: vi.fn(),
              isRecording: () => true,
            };
            if (typeof options === "function") {
              return (options as (s: unknown) => unknown)(span);
            }
            if (typeof context === "function") {
              return (context as (s: unknown) => unknown)(span);
            }
            return (fn as ((s: unknown) => unknown) | undefined)?.(span);
          },
        ),
      };

      const mockTracerProvider = {
        getTracer: vi.fn().mockReturnValue(mockTracer),
      };

      const client = await SmartClient.create({
        serviceName: "existing-tracer-test",
        environment: "node",
        existingTracerProvider: mockTracerProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingTracerProvider"],
        disableInstrumentation: true,
      });

      // get instrumentation and use tracing
      const scope = client.getInstrumentation("my-module");

      // this should use our mock tracer
      scope.traces.startSpan("test-span").end();

      // verify our mock was called
      expect(mockTracerProvider.getTracer).toHaveBeenCalledWith(
        "my-module",
        undefined,
      );
      // verify startSpan was called with the span name (may have additional undefined args)
      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(mockTracer.startSpan.mock.calls[0]?.[0]).toBe("test-span");
    });
  });

  describe("existingMeterProvider", () => {
    it("should use provided meter provider", async () => {
      // create a mock meter provider
      const mockCounter = {
        add: vi.fn(),
      };

      const mockMeter = {
        createCounter: vi.fn().mockReturnValue(mockCounter),
        createUpDownCounter: vi.fn().mockReturnValue({ add: vi.fn() }),
        createHistogram: vi.fn().mockReturnValue({ record: vi.fn() }),
        createObservableGauge: vi.fn().mockReturnValue({
          addCallback: vi.fn(),
          removeCallback: vi.fn(),
        }),
      };

      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue(mockMeter),
      };

      const client = await SmartClient.create({
        serviceName: "existing-meter-test",
        environment: "node",
        existingMeterProvider: mockMeterProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingMeterProvider"],
        disableInstrumentation: true,
      });

      // get instrumentation and use metrics
      const scope = client.getInstrumentation("metrics-module");

      // increment a metric
      scope.metrics.increment("test_counter", 5);

      // verify our mock was called
      expect(mockMeterProvider.getMeter).toHaveBeenCalledWith(
        "metrics-module",
        undefined,
      );
      expect(mockMeter.createCounter).toHaveBeenCalled();
      expect(mockCounter.add).toHaveBeenCalledWith(5, expect.any(Object));
    });
  });

  describe("integration scenarios", () => {
    it("should skip SDK initialization when both providers are provided", async () => {
      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {
        /* noop */
      });

      const mockTracer = {
        startSpan: vi.fn().mockReturnValue({
          end: vi.fn(),
          setAttribute: vi.fn(),
          spanContext: () => ({ traceId: "t", spanId: "s", traceFlags: 1 }),
        }),
        startActiveSpan: vi.fn(),
      };

      const mockMeter = {
        createCounter: vi.fn().mockReturnValue({ add: vi.fn() }),
        createUpDownCounter: vi.fn().mockReturnValue({ add: vi.fn() }),
        createHistogram: vi.fn().mockReturnValue({ record: vi.fn() }),
        createObservableGauge: vi.fn().mockReturnValue({
          addCallback: vi.fn(),
          removeCallback: vi.fn(),
        }),
      };

      const mockTracerProvider = {
        getTracer: vi.fn().mockReturnValue(mockTracer),
      };
      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue(mockMeter),
      };

      // note: NOT setting skipSdkInitialization, but providing both providers
      await SmartClient.create({
        serviceName: "both-providers-skip-test",
        environment: "node",
        existingTracerProvider: mockTracerProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingTracerProvider"],
        existingMeterProvider: mockMeterProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingMeterProvider"],
      });

      // should skip SDK initialization because both providers are provided
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "using provided TracerProvider and MeterProvider",
        ),
      );

      consoleSpy.mockRestore();
    });

    it("should work with both providers provided together", async () => {
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue({
          end: vi.fn(),
          setAttribute: vi.fn(),
          spanContext: () => ({ traceId: "t", spanId: "s", traceFlags: 1 }),
        }),
        startActiveSpan: vi.fn(),
      };

      const mockMeter = {
        createCounter: vi.fn().mockReturnValue({ add: vi.fn() }),
        createUpDownCounter: vi.fn().mockReturnValue({ add: vi.fn() }),
        createHistogram: vi.fn().mockReturnValue({ record: vi.fn() }),
        createObservableGauge: vi.fn().mockReturnValue({
          addCallback: vi.fn(),
          removeCallback: vi.fn(),
        }),
      };

      const mockTracerProvider = {
        getTracer: vi.fn().mockReturnValue(mockTracer),
      };
      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue(mockMeter),
      };

      const client = await SmartClient.create({
        serviceName: "dual-provider-test",
        environment: "node",
        existingTracerProvider: mockTracerProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingTracerProvider"],
        existingMeterProvider: mockMeterProvider as unknown as Parameters<
          typeof SmartClient.create
        >[0]["existingMeterProvider"],
        disableInstrumentation: true,
      });

      // use both tracing and metrics
      const scope = client.getInstrumentation("dual-module");
      scope.traces.startSpan("test-span").end();
      scope.metrics.increment("test_counter", 1);

      // verify both mocks were used
      expect(mockTracerProvider.getTracer).toHaveBeenCalled();
      expect(mockMeterProvider.getMeter).toHaveBeenCalled();
    });

    it("should support Next.js-like scenario where OTel is pre-configured", async () => {
      // simulate a scenario where a framework has already registered global providers
      // in this case, we just want to use the SmartClient API without re-initializing SDK

      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {
        /* noop */
      });

      const client = await SmartClient.create({
        serviceName: "nextjs-app",
        environment: "node",
        skipSdkInitialization: true,
      });

      // framework consumer can still use all the SmartClient features
      expect(() => {
        client.logs.info("Application started");
        client.metrics.increment("page_views", 1);

        const apiScope = client.getInstrumentation("api-routes");
        apiScope.logs.debug("Handling API request");
        apiScope.metrics.histogram("api_response_time", 150);
      }).not.toThrow();

      // shutdown should be no-op (we didn't initialize)
      client.destroy();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping SDK initialization"),
      );

      consoleSpy.mockRestore();
    });
  });
});
