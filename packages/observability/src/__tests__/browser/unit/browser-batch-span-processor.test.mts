/**
 * BrowserBatchSpanProcessor Tests
 *
 * TDD tests for the flush/shutdown data loss bug.
 * RED: These tests expose the bug - forceFlush/shutdown resolve before export completes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";

import { BrowserBatchSpanProcessor } from "../../../sdk-wrapper-browser.mjs";

// create a minimal mock span
function createMockSpan(name: string): ReadableSpan {
  return {
    name,
    kind: 0,
    spanContext: () => ({
      traceId: "abc123",
      spanId: "def456",
      traceFlags: 1,
    }),
    startTime: [0, 0],
    endTime: [0, 1000000],
    status: { code: 0 },
    attributes: {},
    links: [],
    events: [],
    duration: [0, 1000000],
    ended: true,
    resource: {
      attributes: {},
      merge: () => ({ attributes: {} }) as never,
    },
    instrumentationLibrary: { name: "test", version: "1.0.0" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

describe("BrowserBatchSpanProcessor - Flush Awaiting Bug", () => {
  describe("forceFlush() should await pending exports", () => {
    it("should wait for in-flight export to complete before resolving", async () => {
      let exportCallbackCalled = false;

      const mockExporter: SpanExporter = {
        export: vi.fn(
          (
            _spans: ReadableSpan[],
            resultCallback: (result: { code: number }) => void,
          ) => {
            // simulate async network call
            setTimeout(() => {
              exportCallbackCalled = true;
              resultCallback({ code: ExportResultCode.SUCCESS });
            }, 10);
          },
        ),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const processor = new BrowserBatchSpanProcessor(mockExporter, {
        maxExportBatchSize: 1, // immediate flush
        scheduledDelayMillis: 100000,
      });

      // add span - triggers export
      processor.onEnd(createMockSpan("test-span"));
      expect(mockExporter.export).toHaveBeenCalledTimes(1);

      // forceFlush should wait for the pending export
      await processor.forceFlush();

      // BUG: forceFlush() resolves immediately, exportCallbackCalled is still false
      expect(exportCallbackCalled).toBe(true);
    });
  });

  describe("shutdown() should await pending exports", () => {
    it("should complete all pending exports before resolving", async () => {
      let exportCallbackCalled = false;

      const mockExporter: SpanExporter = {
        export: vi.fn(
          (
            _spans: ReadableSpan[],
            resultCallback: (result: { code: number }) => void,
          ) => {
            setTimeout(() => {
              exportCallbackCalled = true;
              resultCallback({ code: ExportResultCode.SUCCESS });
            }, 10);
          },
        ),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const processor = new BrowserBatchSpanProcessor(mockExporter, {
        maxExportBatchSize: 1,
        scheduledDelayMillis: 100000,
      });

      processor.onEnd(createMockSpan("test-span"));

      // shutdown should wait for export to complete
      await processor.shutdown();

      // BUG: shutdown resolves before export callback fires
      expect(exportCallbackCalled).toBe(true);
      expect(mockExporter.shutdown).toHaveBeenCalled();
    });

    it("should not lose data on rapid shutdown", async () => {
      const exportedSpans: string[] = [];

      const mockExporter: SpanExporter = {
        export: vi.fn(
          (
            spans: ReadableSpan[],
            resultCallback: (result: { code: number }) => void,
          ) => {
            setTimeout(() => {
              spans.forEach((s) => exportedSpans.push(s.name));
              resultCallback({ code: ExportResultCode.SUCCESS });
            }, 5);
          },
        ),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const processor = new BrowserBatchSpanProcessor(mockExporter, {
        maxExportBatchSize: 1,
        scheduledDelayMillis: 100000,
      });

      // add multiple spans rapidly
      processor.onEnd(createMockSpan("span-1"));
      processor.onEnd(createMockSpan("span-2"));
      processor.onEnd(createMockSpan("span-3"));

      // shutdown immediately
      await processor.shutdown();

      // all spans should be exported
      expect(exportedSpans).toContain("span-1");
      expect(exportedSpans).toContain("span-2");
      expect(exportedSpans).toContain("span-3");
    });
  });

  describe("production data loss prevention", () => {
    it("demonstrates the data loss bug when page unloads", async () => {
      let dataExported = false;

      const mockExporter: SpanExporter = {
        export: vi.fn(
          (
            _spans: ReadableSpan[],
            resultCallback: (result: { code: number }) => void,
          ) => {
            // simulates real-world network latency
            setTimeout(() => {
              dataExported = true;
              resultCallback({ code: ExportResultCode.SUCCESS });
            }, 50);
          },
        ),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const processor = new BrowserBatchSpanProcessor(mockExporter, {
        maxExportBatchSize: 1,
        scheduledDelayMillis: 100000,
      });

      processor.onEnd(createMockSpan("critical-user-action"));

      // user navigates away - app calls shutdown
      await processor.shutdown();

      // in real browser, if shutdown resolves before export completes,
      // the page unloads and the fetch is cancelled = data loss!
      expect(dataExported).toBe(true);
    });
  });
});
