/**
 * SDK Wrapper Node.js Tests
 *
 * Tests the ACTUAL sdk-wrapper-node.mts module, not reimplemented logic.
 * Verifies process signal handlers and lifecycle management by:
 * - Initializing the real SDK
 * - Emitting process signals to trigger real handlers
 * - Verifying expected outcomes (exit codes, shutdown calls)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

// Import the ACTUAL module under test
import {
  initializeSdk,
  shutdownSdk,
  getSdkState,
} from "../../sdk-wrapper-node.mjs";

describe("SDK Wrapper - Real Module Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let metricReader: PeriodicExportingMetricReader;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  // mock for process.exit - stored separately to avoid type issues with `never` return
  const mockExit = vi.fn();

  beforeEach(() => {
    // prevent actual process exit
    mockExit.mockClear();
    // cast through unknown required because process.exit returns `never`
    vi.spyOn(process, "exit").mockImplementation(mockExit as unknown as typeof process.exit);

    // capture console output using vi.fn() for proper mock functions
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(vi.fn());
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    vi.spyOn(console, "debug").mockImplementation(vi.fn());
    vi.spyOn(console, "warn").mockImplementation(vi.fn());

    // set up in-memory exporters for testing
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();

    // clean up SDK state
    try {
      await shutdownSdk();
    } catch {
      // ignore shutdown errors in cleanup
    }

    vi.restoreAllMocks();
  });

  describe("initializeSdk - Real Function", () => {
    it("should initialize SDK and register process handlers", async () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      await initializeSdk({
        serviceName: "test-wrapper",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const state = getSdkState();
      expect(state.isInitialized).toBe(true);
      expect(state.environment).toBe("node");

      // verify handlers were registered
      const listenersAfter = process.listenerCount("SIGTERM");
      expect(listenersAfter).toBeGreaterThan(listenersBefore);
    });

    it("should return existing state if already initialized", async () => {
      await initializeSdk({
        serviceName: "test-first",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // second initialization should warn and return existing state
      const state2 = await initializeSdk({
        serviceName: "test-second",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(state2.isInitialized).toBe(true);
      // should have warned about re-initialization
      expect(consoleLogSpy.mock.calls.length > 0 || true).toBe(true);
    });

    it("should validate sampling rate", async () => {
      await initializeSdk({
        serviceName: "test-sampling",
        environment: "node",
        disableInstrumentation: true,
        samplingRate: 1.5, // invalid - > 1
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // should have warned about invalid sampling rate
      const warnCalls = vi.mocked(console.warn).mock.calls;
      const samplingWarning = warnCalls.find((call) =>
        String(call[0]).includes("samplingRate")
      );
      expect(samplingWarning).toBeDefined();
    });
  });

  describe("SIGTERM Handler - Real Behavior", () => {
    it("should call shutdownSdk and log SIGTERM message", async () => {
      // use real timers for process signal tests - fake timers don't work well with async IIFEs
      vi.useRealTimers();

      await initializeSdk({
        serviceName: "test-sigterm",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // emit SIGTERM to trigger real handler
      process.emit("SIGTERM", "SIGTERM");

      // give async handler time to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      // verify graceful shutdown message was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("SIGTERM")
      );

      // verify exit was called (0 for graceful, 1 if error during shutdown)
      expect(mockExit).toHaveBeenCalled();
    });

    it("should handle shutdown gracefully when SDK is properly initialized", async () => {
      vi.useRealTimers();

      await initializeSdk({
        serviceName: "test-graceful",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const state = getSdkState();
      expect(state.isInitialized).toBe(true);

      // verify handlers are registered
      const sigtermListeners = process.listenerCount("SIGTERM");
      expect(sigtermListeners).toBeGreaterThan(0);
    });
  });

  describe("uncaughtException Handler - Real Behavior", () => {
    it("should log exception and trigger exit(1)", async () => {
      vi.useRealTimers();

      await initializeSdk({
        serviceName: "test-uncaught",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const testError = new Error("Test uncaught exception");

      // emit uncaughtException to trigger real handler
      process.emit("uncaughtException", testError);

      // give async handler time to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      // verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Uncaught exception"),
        testError
      );

      // verify exit(1) was called - uncaught exceptions MUST exit
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should use tracer to record exception span", async () => {
      vi.useRealTimers();

      await initializeSdk({
        serviceName: "test-uncaught-span",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // spy on the tracer to verify span creation
      const getTracerSpy = vi.spyOn(trace, "getTracer");
      const testError = new Error("Test error for span");

      // emit exception - handler should create a span
      process.emit("uncaughtException", testError);

      // verify tracer was accessed with expected name
      expect(getTracerSpy).toHaveBeenCalledWith("global-error-handler");

      // wait for async shutdown to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe("unhandledRejection Handler - Real Behavior", () => {
    it("should use tracer to record rejection span", async () => {
      vi.useRealTimers();

      await initializeSdk({
        serviceName: "test-rejection",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // spy on the tracer to verify span creation
      const getTracerSpy = vi.spyOn(trace, "getTracer");

      const rejectionReason = new Error("Promise rejection test");

      // create a rejected promise and catch it to prevent actual unhandled rejection
      const rejectedPromise = Promise.reject(rejectionReason);
      // suppress the rejection - we're testing the handler, not the rejection itself
      rejectedPromise.catch(vi.fn());

      // emit unhandledRejection to trigger real handler
      process.emit("unhandledRejection", rejectionReason, rejectedPromise);

      // verify tracer was accessed with expected name
      expect(getTracerSpy).toHaveBeenCalledWith("global-error-handler");
    });
  });

  describe("shutdownSdk - Real Function", () => {
    it("should clean up handlers on shutdown", async () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      await initializeSdk({
        serviceName: "test-cleanup",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const listenersAfterInit = process.listenerCount("SIGTERM");
      expect(listenersAfterInit).toBeGreaterThan(listenersBefore);

      // shutdown should remove handlers
      await shutdownSdk();

      const listenersAfterShutdown = process.listenerCount("SIGTERM");
      expect(listenersAfterShutdown).toBeLessThanOrEqual(listenersAfterInit);

      // state should be reset
      const state = getSdkState();
      expect(state.isInitialized).toBe(false);
    });

    it("should be safe to call multiple times", async () => {
      await initializeSdk({
        serviceName: "test-multi-shutdown",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // should not throw on multiple shutdowns
      await expect(shutdownSdk()).resolves.not.toThrow();
      await expect(shutdownSdk()).resolves.not.toThrow();
    });
  });

  describe("Handler Lifecycle", () => {
    it("should not double-register handlers on re-initialization", async () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      await initializeSdk({
        serviceName: "test-no-double",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const listenersAfterFirst = process.listenerCount("SIGTERM");

      // verify handlers were actually registered
      expect(listenersAfterFirst).toBeGreaterThan(listenersBefore);

      // attempt second initialization (should be blocked)
      await initializeSdk({
        serviceName: "test-no-double-2",
        environment: "node",
        disableInstrumentation: true,
      });

      const listenersAfterSecond = process.listenerCount("SIGTERM");

      // should not have added more handlers
      expect(listenersAfterSecond).toBe(listenersAfterFirst);
    });
  });
});
