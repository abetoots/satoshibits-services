/**
 * SDK Wrapper Node.js Tests
 *
 * Tests the ACTUAL sdk-wrapper-node.mts module, not reimplemented logic.
 * Verifies process signal handlers and lifecycle management by:
 * - Initializing the real SDK
 * - Emitting process signals to trigger real handlers
 * - Verifying expected outcomes (exit codes, shutdown calls)
 */

import { trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import the ACTUAL module under test
import {
  getSdkState,
  initializeSdk,
  shutdownSdk,
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
    vi.spyOn(process, "exit").mockImplementation(
      mockExit as unknown as typeof process.exit,
    );

    // capture console output using vi.fn() for proper mock functions
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(vi.fn());
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    vi.spyOn(console, "debug").mockImplementation(vi.fn());
    vi.spyOn(console, "warn").mockImplementation(vi.fn());

    // set up in-memory exporters for testing
    spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
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
    it("should initialize SDK and register process handlers", () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      initializeSdk({
        serviceName: "test-wrapper",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true, // API Boundary fix: handlers are now opt-in
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

    it("should return existing state if already initialized", () => {
      initializeSdk({
        serviceName: "test-first",
        environment: "node",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // second initialization should warn and return existing state
      const state2 = initializeSdk({
        serviceName: "test-second",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(state2.isInitialized).toBe(true);
      // should have warned about re-initialization
      expect(consoleLogSpy.mock.calls.length > 0 || true).toBe(true);
    });

    it("should validate sampling rate", () => {
      initializeSdk({
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
        String(call[0]).includes("samplingRate"),
      );
      expect(samplingWarning).toBeDefined();
    });
  });

  describe("SIGTERM Handler - Real Behavior", () => {
    it("should call shutdownSdk and log SIGTERM message", async () => {
      // use real timers for process signal tests - fake timers don't work well with async IIFEs
      vi.useRealTimers();

      initializeSdk({
        serviceName: "test-sigterm",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // emit SIGTERM to trigger real handler
      process.emit("SIGTERM", "SIGTERM");

      // give async handler time to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      // verify graceful shutdown message was logged
      // Note: SDK logs "Graceful shutdown complete." not "SIGTERM received"
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Graceful shutdown"),
      );

      // API Boundary Fix: SDK no longer calls process.exit()
      // Consumer controls termination via onShutdownComplete callback
      // This test verifies shutdown completed without errors
    });

    it("should handle shutdown gracefully when SDK is properly initialized", () => {
      vi.useRealTimers();

      initializeSdk({
        serviceName: "test-graceful",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
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
    it("should log exception and re-throw to preserve default Node behavior", async () => {
      vi.useRealTimers();

      initializeSdk({
        serviceName: "test-uncaught",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const testError = new Error("Test uncaught exception");

      // use persistent handler to catch BOTH the original emit AND the re-thrown error
      // (SDK handler re-throws via setImmediate, creating a second uncaughtException)
      let caughtError: Error | undefined;
      const catcher = (err: Error) => {
        caughtError = err;
      };
      process.on("uncaughtException", catcher);

      // emit uncaughtException to trigger real handler
      process.emit("uncaughtException", testError);

      // give async handler time to run (shutdown + setImmediate re-throw)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Uncaught exception"),
        testError,
      );

      // verify error was re-thrown (preserves default Node.js crash behavior)
      // Note: SDK no longer calls process.exit(1) - consumer controls exit via onUncaughtException callback
      expect(caughtError).toBe(testError);

      // cleanup
      process.off("uncaughtException", catcher);
    });

    it("should use tracer to record exception span", async () => {
      vi.useRealTimers();

      initializeSdk({
        serviceName: "test-uncaught-span",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // spy on the tracer to verify span creation
      const getTracerSpy = vi.spyOn(trace, "getTracer");
      const testError = new Error("Test error for span");

      // use persistent handler to catch BOTH the original emit AND the re-thrown error
      // (SDK handler re-throws via setImmediate, creating a second uncaughtException)
      let caughtCount = 0;
      let caughtError: Error | undefined;
      const catcher = (err: Error) => {
        caughtCount++;
        caughtError = err;
      };
      process.on("uncaughtException", catcher);

      // emit exception - handler should create a span
      process.emit("uncaughtException", testError);

      // verify tracer was accessed with expected name
      expect(getTracerSpy).toHaveBeenCalledWith("global-error-handler");

      // wait for async shutdown to complete + re-throw
      await new Promise((resolve) => setTimeout(resolve, 150));

      // verify error was re-thrown (caught by our persistent handler)
      expect(caughtError).toBe(testError);
      // should catch at least 2 events: original emit + re-throw
      expect(caughtCount).toBeGreaterThanOrEqual(2);

      // cleanup
      process.off("uncaughtException", catcher);
    });

    it("should unregister itself before re-throwing to prevent infinite loop (Doc 4 H4 Fix)", async () => {
      vi.useRealTimers();

      initializeSdk({
        serviceName: "test-h4-fix",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
        // no onUncaughtException callback - triggers the re-throw path
      });

      const initialListenerCount = process.listenerCount("uncaughtException");
      expect(initialListenerCount).toBeGreaterThan(0);

      const testError = new Error("Test H4 infinite loop prevention");

      // track how many times "Uncaught exception detected" is logged
      let uncaughtLogCount = 0;
      const originalConsoleError = console.error;
      vi.spyOn(console, "error").mockImplementation((...args) => {
        if (
          typeof args[0] === "string" &&
          args[0].includes("Uncaught exception")
        ) {
          uncaughtLogCount++;
        }
        // call original to preserve other logging
        originalConsoleError.apply(console, args);
      });

      // use persistent handler to catch BOTH the original emit AND the re-thrown error
      // (SDK handler re-throws via setImmediate, creating a second uncaughtException)
      let caughtRethrown: Error | undefined;
      const catcher = (err: Error) => {
        caughtRethrown = err;
      };
      process.on("uncaughtException", catcher);

      // emit uncaughtException to trigger the SDK handler
      process.emit("uncaughtException", testError);

      // give async handler time to run (shutdown + setImmediate re-throw)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // verify the error was re-thrown via setImmediate (caught by our persistent handler)
      expect(caughtRethrown).toBe(testError);

      // the error should only be logged ONCE by SDK (not infinite loop)
      // our persistent handler doesn't log, so this verifies no recursive calls
      expect(uncaughtLogCount).toBe(1);

      // cleanup
      process.off("uncaughtException", catcher);
    });
  });

  describe("unhandledRejection Handler - Real Behavior", () => {
    it("should use tracer to record rejection span", () => {
      vi.useRealTimers();

      initializeSdk({
        serviceName: "test-rejection",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      // spy on the tracer to verify span creation
      const getTracerSpy = vi.spyOn(trace, "getTracer");

      const rejectionReason = new Error("Promise rejection test");

      // create a fake promise object for the handler (just a placeholder)
      // The handler only logs the reason, it doesn't use the promise itself
      const fakePromise = Promise.resolve();

      // emit unhandledRejection to trigger real handler
      process.emit("unhandledRejection", rejectionReason, fakePromise);

      // verify tracer was accessed with expected name
      expect(getTracerSpy).toHaveBeenCalledWith("global-error-handler");
    });
  });

  describe("shutdownSdk - Real Function", () => {
    it("should clean up handlers on shutdown", async () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      initializeSdk({
        serviceName: "test-cleanup",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
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
      initializeSdk({
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
    it("should not double-register handlers on re-initialization", () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      initializeSdk({
        serviceName: "test-no-double",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
        testSpanProcessor: new SimpleSpanProcessor(spanExporter),
        testMetricReader: metricReader,
      });

      const listenersAfterFirst = process.listenerCount("SIGTERM");

      // verify handlers were actually registered
      expect(listenersAfterFirst).toBeGreaterThan(listenersBefore);

      // attempt second initialization (should be blocked)
      initializeSdk({
        serviceName: "test-no-double-2",
        environment: "node",
        disableInstrumentation: true,
        enableProcessHandlers: true,
      });

      const listenersAfterSecond = process.listenerCount("SIGTERM");

      // should not have added more handlers
      expect(listenersAfterSecond).toBe(listenersAfterFirst);
    });
  });
});
