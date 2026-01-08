/**
 * Shared mocks for Node.js tests
 */

import { vi } from "vitest";
import type { Mock } from "vitest";

/** Mock span type for tracer tests */
interface MockSpan {
  end: Mock;
  setAttribute: Mock;
  setAttributes: Mock;
  recordException: Mock;
  setStatus: Mock;
  addEvent?: Mock;
  updateName?: Mock;
  isRecording?: Mock;
}

// Create mock meter with all required methods
export const createMockMeter = () => ({
  createCounter: vi.fn().mockReturnValue({
    add: vi.fn(),
  }),
  createUpDownCounter: vi.fn().mockReturnValue({
    add: vi.fn(),
  }),
  createHistogram: vi.fn().mockReturnValue({
    record: vi.fn(),
  }),
  createGauge: vi.fn().mockReturnValue({
    record: vi.fn(),
  }),
  createObservableGauge: vi.fn().mockReturnValue({
    addCallback: vi.fn(),
  }),
  createObservableCounter: vi.fn().mockReturnValue({
    addCallback: vi.fn(),
  }),
  createObservableUpDownCounter: vi.fn().mockReturnValue({
    addCallback: vi.fn(),
  }),
});

// Create mock tracer with all required methods
export const createMockTracer = () => ({
  startSpan: vi.fn().mockReturnValue({
    end: vi.fn(),
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
    addEvent: vi.fn(),
    updateName: vi.fn(),
    isRecording: vi.fn().mockReturnValue(true),
  }),
  startActiveSpan: vi.fn(
    (
      _name: string,
      options: unknown,
      fn?: (span: MockSpan) => unknown,
    ) => {
      const span: MockSpan = {
        end: vi.fn(),
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      if (typeof options === "function") {
        return (options as (span: MockSpan) => unknown)(span);
      }
      return fn?.(span);
    },
  ),
});

// Create mock logger
export const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
});
