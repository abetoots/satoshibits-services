/**
 * BrowserConsoleInstrumentation Tests
 *
 * Doc 4 H3 Fix: Tests for try/catch wrapper around telemetry code
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserConsoleInstrumentation } from "../../../browser/instrumentations/console-instrumentation.mjs";

describe("BrowserConsoleInstrumentation - Doc 4 H3 Error Safety", () => {
  let instrumentation: BrowserConsoleInstrumentation;
  let originalConsoleError: typeof console.error;
  let consoleErrorCalls: unknown[][] = [];

  beforeEach(() => {
    consoleErrorCalls = [];
    originalConsoleError = console.error;

    // mock console.error to track calls
    console.error = (...args: unknown[]) => {
      consoleErrorCalls.push(args);
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    // disable instrumentation before restoring console
    if (instrumentation) {
      instrumentation.disable();
    }

    // restore original console.error
    console.error = originalConsoleError;
  });

  describe("Error safety in patched console.error (Doc 4 H3 Fix)", () => {
    it("should call original console.error even when tracer throws", () => {
      instrumentation = new BrowserConsoleInstrumentation();

      const tracerError = new Error("Tracer initialization failed");
      // mock the tracer to throw
      const mockTracer = {
        startSpan: vi.fn().mockImplementation(() => {
          throw tracerError;
        }),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      // this should NOT throw, and the original console.error should be called
      expect(() => {
        console.error("Test error message");
      }).not.toThrow();

      // verify original console.error was called + diagnostic logged
      expect(consoleErrorCalls).toHaveLength(2);
      expect(consoleErrorCalls[0]).toEqual(["Test error message"]);
      // diagnostic logged about telemetry failure
      expect(consoleErrorCalls[1]).toEqual([
        "[ConsoleInstrumentation] telemetry failed:",
        tracerError
      ]);
    });

    it("should call original console.error even when span.recordException throws", () => {
      instrumentation = new BrowserConsoleInstrumentation();

      const recordError = new Error("recordException failed");
      // mock the tracer with a span that throws on recordException
      const mockSpan = {
        recordException: vi.fn().mockImplementation(() => {
          throw recordError;
        }),
        end: vi.fn(),
      };
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      // this should NOT throw
      expect(() => {
        console.error("Another test error");
      }).not.toThrow();

      // verify original console.error was called + diagnostic logged
      expect(consoleErrorCalls).toHaveLength(2);
      expect(consoleErrorCalls[0]).toEqual(["Another test error"]);
      expect(consoleErrorCalls[1]).toEqual([
        "[ConsoleInstrumentation] telemetry failed:",
        recordError
      ]);
    });

    it("should call original console.error even when errorHandler throws", () => {
      const handlerError = new Error("Handler exploded");
      const throwingHandler = vi.fn().mockImplementation(() => {
        throw handlerError;
      });

      instrumentation = new BrowserConsoleInstrumentation({
        errorHandler: throwingHandler,
      });

      // mock a working tracer
      const mockSpan = {
        recordException: vi.fn(),
        end: vi.fn(),
      };
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      // this should NOT throw
      expect(() => {
        console.error("Error with throwing handler");
      }).not.toThrow();

      // verify original console.error was called + diagnostic logged
      expect(consoleErrorCalls).toHaveLength(2);
      expect(consoleErrorCalls[0]).toEqual(["Error with throwing handler"]);
      expect(consoleErrorCalls[1]).toEqual([
        "[ConsoleInstrumentation] telemetry failed:",
        handlerError
      ]);

      // verify handler was called (before it threw)
      expect(throwingHandler).toHaveBeenCalled();
    });

    it("should not cause infinite recursion if tracer calls console.error (reentrancy guard)", () => {
      instrumentation = new BrowserConsoleInstrumentation();

      let startSpanCallCount = 0;
      // mock the tracer to actually call console.error, which would cause infinite
      // recursion without the reentrancy guard
      const mockTracer = {
        startSpan: vi.fn().mockImplementation(() => {
          startSpanCallCount++;
          // this will re-enter the patched console.error - without the guard,
          // it would create another span, which would call console.error again, etc.
          console.error("[internal] tracer logging");
          return {
            recordException: vi.fn(),
            end: vi.fn(),
          };
        }),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      // call console.error
      console.error("User error message");

      // the reentrancy guard should prevent startSpan from being called more than once
      expect(startSpanCallCount).toBe(1);

      // we should see two console.error calls:
      // 1. The user's original message
      // 2. The internal tracer logging (which bypasses telemetry due to guard)
      expect(consoleErrorCalls).toHaveLength(2);
      expect(consoleErrorCalls[0]).toEqual(["User error message"]);
      expect(consoleErrorCalls[1]).toEqual(["[internal] tracer logging"]);
    });

    it("should not cause infinite recursion if errorHandler calls console.error", () => {
      let handlerCallCount = 0;
      const recursiveHandler = vi.fn().mockImplementation(() => {
        handlerCallCount++;
        // this will re-enter the patched console.error
        console.error("[handler] logging error details");
      });

      instrumentation = new BrowserConsoleInstrumentation({
        errorHandler: recursiveHandler,
      });

      // mock a working tracer
      const mockSpan = {
        recordException: vi.fn(),
        end: vi.fn(),
      };
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      // call console.error
      console.error("User error");

      // handler should only be called once (reentrancy guard prevents second call)
      expect(handlerCallCount).toBe(1);

      // we should see two console.error calls
      expect(consoleErrorCalls).toHaveLength(2);
      expect(consoleErrorCalls[0]).toEqual(["User error"]);
      expect(consoleErrorCalls[1]).toEqual(["[handler] logging error details"]);
    });

    it("should log telemetry errors via original console.error for visibility", () => {
      instrumentation = new BrowserConsoleInstrumentation();

      const telemetryError = new Error("Tracer failed");
      // mock the tracer to throw
      const mockTracer = {
        startSpan: vi.fn().mockImplementation(() => {
          throw telemetryError;
        }),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      console.error("User message");

      // should see two console.error calls:
      // 1. The user's original message
      // 2. The telemetry error diagnostic
      expect(consoleErrorCalls).toHaveLength(2);
      expect(consoleErrorCalls[0]).toEqual(["User message"]);
      expect(consoleErrorCalls[1]).toEqual([
        "[ConsoleInstrumentation] telemetry failed:",
        telemetryError
      ]);
    });
  });

  describe("Normal operation", () => {
    it("should call error handler with correct arguments", () => {
      const mockHandler = vi.fn();

      instrumentation = new BrowserConsoleInstrumentation({
        errorHandler: mockHandler,
      });

      // mock a working tracer
      const mockSpan = {
        recordException: vi.fn(),
        end: vi.fn(),
      };
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      console.error("Test error", { detail: "info" });

      // verify handler was called
      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(Error),
        { source: "console.error" }
      );

      // verify the error message contains stringified args
      const errorArg = mockHandler.mock.calls[0]![0] as Error;
      expect(errorArg.message).toContain("Test error");
      expect(errorArg.message).toContain('"detail":"info"');
    });

    it("should handle null and undefined arguments", () => {
      instrumentation = new BrowserConsoleInstrumentation();

      // mock a working tracer
      const mockSpan = {
        recordException: vi.fn(),
        end: vi.fn(),
      };
      const mockTracer = {
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      Object.defineProperty(instrumentation, "tracer", {
        get: () => mockTracer,
        configurable: true,
      });

      instrumentation.enable();

      // should not throw
      expect(() => {
        console.error(null, undefined, "message");
      }).not.toThrow();

      expect(consoleErrorCalls).toHaveLength(1);
      expect(consoleErrorCalls[0]).toEqual([null, undefined, "message"]);
    });
  });
});
