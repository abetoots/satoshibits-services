import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { MockedFunction } from "vitest";

import { FetchSpanExporter } from "../../../sdk-wrapper-browser.mjs";

/**
 * FetchSpanExporter Integration Tests
 *
 * Tests OUR custom FetchSpanExporter implementation.
 * This is our code, not OpenTelemetry's, so we test it thoroughly.
 */

// Type for the export callback result
interface ExportCallbackResult {
  code: number;
  error?: Error;
}

// Properly typed mock navigator
interface MockNavigator {
  sendBeacon: MockedFunction<typeof navigator.sendBeacon>;
}

describe("FetchSpanExporter - Our Custom Implementation", () => {
  let exporter: FetchSpanExporter;
  let mockNavigator: MockNavigator;
  let mockFetch: MockedFunction<typeof fetch>;

  beforeEach(() => {
    // Mock browser APIs with proper types
    mockNavigator = {
      sendBeacon: vi.fn().mockReturnValue(true) as MockedFunction<
        typeof navigator.sendBeacon
      >,
    };
    // Use vi.stubGlobal for proper mocking
    vi.stubGlobal("navigator", mockNavigator);

    mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true } as Response) as MockedFunction<
      typeof fetch
    >;
    vi.stubGlobal("fetch", mockFetch);

    // Mock Blob constructor
    const MockBlob = class Blob {
      constructor(
        public parts: BlobPart[],
        public options?: BlobPropertyBag,
      ) {}
    };
    vi.stubGlobal("Blob", MockBlob);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up all global stubs
    vi.unstubAllGlobals();
  });

  describe("Our Beacon API Usage", () => {
    it("Should prefer beacon API for small payloads", async () => {
      // Test OUR decision to use beacon for small data
      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
      });

      const mockSpan = {
        name: "test-span",
        attributes: { key: "value" },
        spanContext: () => ({
          traceId: "123",
          spanId: "456",
        }),
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            // Test OUR beacon usage logic
            expect(mockNavigator.sendBeacon).toHaveBeenCalledWith(
              "/telemetry",
              expect.any(Blob),
            );
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.code).toBe(0); // Success
            resolve();
          },
        );
      });
    });

    it("Should handle beacon API unavailability", async () => {
      // Test OUR fallback when beacon is not available
      Object.defineProperty(globalThis, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
      });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            // Should fall back to fetch
            expect(mockFetch).toHaveBeenCalledWith(
              "/telemetry",
              expect.objectContaining({
                method: "POST",
                keepalive: true,
              }),
            );
            expect(result.code).toBe(0);
            resolve();
          },
        );
      });
    });

    it("Should report failure when beacon API returns false", async () => {
      // Test OUR error reporting when beacon returns false
      mockNavigator.sendBeacon.mockReturnValue(false);

      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
      });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            // Should try beacon first, then fall back based on result
            expect(mockNavigator.sendBeacon).toHaveBeenCalled();
            // When beacon fails (returns false), we get error code
            expect(result.code).toBe(1); // Failure since beacon returned false
            resolve();
          },
        );
      });
    });
  });

  describe("Our Payload Size Handling", () => {
    it("Should use fetch for large payloads exceeding beacon limit", async () => {
      // Test OUR 64KB limit logic
      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
      });

      // Create many spans to exceed 64KB
      const manySpans = Array(1000)
        .fill(null)
        .map((_, i) => ({
          name: `span-${i}`,
          attributes: {
            largeData: "x".repeat(100),
            index: i,
          },
          spanContext: () => ({
            traceId: `trace-${i}`,
            spanId: `span-${i}`,
          }),
        }));

      await new Promise<void>((resolve) => {
        exporter.export(
          manySpans as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            // Should skip beacon for large payload
            expect(mockNavigator.sendBeacon).not.toHaveBeenCalled();
            expect(mockFetch).toHaveBeenCalled();
            expect(result.code).toBe(0);
            resolve();
          },
        );
      });
    });
  });

  describe("Our Header Configuration", () => {
    it("Should include custom headers in fetch requests", async () => {
      // Test OUR header handling
      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
        headers: {
          "X-API-Key": "test-key",
          "X-Custom": "value",
        },
      });

      // Disable beacon to force fetch
      Object.defineProperty(globalThis, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
      };

      await new Promise<void>((resolve) => {
        exporter.export([mockSpan] as unknown as ReadableSpan[], () => {
          expect(mockFetch).toHaveBeenCalledWith(
            "/telemetry",
            expect.objectContaining({
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any by design
              headers: expect.objectContaining({
                "Content-Type": "application/json",
                "X-API-Key": "test-key",
                "X-Custom": "value",
              }),
            }),
          );
          resolve();
        });
      });
    });
  });

  describe("Our Error Handling", () => {
    it("Should handle fetch errors gracefully", async () => {
      // Test OUR error handling logic
      mockFetch.mockRejectedValue(new Error("Network error"));
      Object.defineProperty(globalThis, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
      });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            expect(result.code).toBe(1); // Error code
            resolve();
          },
        );
      });
    });
  });

  describe("Our Endpoint Configuration", () => {
    it("Should use default endpoint when not specified", () => {
      exporter = new FetchSpanExporter({});

      // Our default is '/v1/traces'
      // We'd test this by checking the endpoint used in export
      // For now, just verify it initializes
      expect(exporter).toBeDefined();
    });

    it("Should use custom endpoint when provided", async () => {
      exporter = new FetchSpanExporter({
        endpoint: "https://custom.telemetry.com/spans",
      });

      Object.defineProperty(globalThis, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      }); // Force fetch

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
      };

      await new Promise<void>((resolve) => {
        exporter.export([mockSpan] as unknown as ReadableSpan[], () => {
          expect(mockFetch).toHaveBeenCalledWith(
            "https://custom.telemetry.com/spans",
            expect.any(Object),
          );
          resolve();
        });
      });
    });
  });

  describe("Our Keepalive Flag", () => {
    it("Should set keepalive flag for fetch requests", async () => {
      // Test OUR decision to use keepalive
      exporter = new FetchSpanExporter({
        endpoint: "/telemetry",
      });

      Object.defineProperty(globalThis, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      }); // Force fetch

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
      };

      await new Promise<void>((resolve) => {
        exporter.export([mockSpan] as unknown as ReadableSpan[], () => {
          expect(mockFetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              keepalive: true, // Our decision for reliability
            }),
          );
          resolve();
        });
      });
    });
  });
});

/**
 * RED Phase Tests: OTLP Compliance
 *
 * Issue #4: FetchSpanExporter exports {resource, spans} instead of OTLP-compliant
 * {resourceSpans: [{resource, scopeSpans: [{spans}]}]}. Also ignores non-2xx responses.
 *
 * These tests verify:
 * - Export payload matches OTLP/HTTP JSON format
 * - Non-2xx responses are treated as errors
 * - Network failures are handled gracefully
 * - Resource attributes propagate unchanged
 */
describe("RED: OTLP Compliance for FetchSpanExporter", () => {
  let exporter: FetchSpanExporter;
  let mockFetch: MockedFunction<typeof fetch>;
  let capturedPayload: unknown;

  beforeEach(() => {
    capturedPayload = null;

    // mock fetch to capture the payload
    mockFetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.body) {
        capturedPayload = JSON.parse(options.body as string);
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as MockedFunction<typeof fetch>;

    vi.stubGlobal("fetch", mockFetch);

    // disable beacon to force fetch usage
    vi.stubGlobal("navigator", undefined);

    // mock Blob
    const MockBlob = class Blob {
      constructor(
        public parts: BlobPart[],
        public options?: BlobPropertyBag,
      ) {}
    };
    vi.stubGlobal("Blob", MockBlob);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("OTLP payload structure", () => {
    it("should export spans in OTLP-compliant resourceSpans format", async () => {
      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-operation",
        kind: 1, // SPAN_KIND_INTERNAL
        attributes: { "http.method": "GET", "http.url": "/api/test" },
        status: { code: 1 }, // OK
        events: [],
        startTime: [1234567890, 0],
        endTime: [1234567891, 0],
        spanContext: () => ({
          traceId: "0123456789abcdef0123456789abcdef",
          spanId: "0123456789abcdef",
        }),
        parentSpanContext: { spanId: "fedcba9876543210" },
        resource: {
          attributes: {
            "service.name": "test-service",
            "service.version": "1.0.0",
          },
        },
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            expect(result.code).toBe(0);
            resolve();
          },
        );
      });

      // verify OTLP structure: resourceSpans[].scopeSpans[].spans[]
      expect(capturedPayload).toHaveProperty("resourceSpans");
      expect(Array.isArray((capturedPayload as { resourceSpans: unknown[] }).resourceSpans)).toBe(true);

      const resourceSpans = (capturedPayload as { resourceSpans: unknown[] }).resourceSpans;
      expect(resourceSpans.length).toBeGreaterThan(0);

      const firstResourceSpan = resourceSpans[0] as {
        resource?: { attributes?: unknown };
        scopeSpans?: unknown[];
      };

      // should have resource
      expect(firstResourceSpan).toHaveProperty("resource");
      expect(firstResourceSpan.resource).toHaveProperty("attributes");

      // should have scopeSpans
      expect(firstResourceSpan).toHaveProperty("scopeSpans");
      expect(Array.isArray(firstResourceSpan.scopeSpans)).toBe(true);

      const scopeSpans = firstResourceSpan.scopeSpans as { spans?: unknown[] }[];
      expect(scopeSpans.length).toBeGreaterThan(0);

      // should have spans array within scopeSpans
      expect(scopeSpans[0]).toHaveProperty("spans");
      expect(Array.isArray(scopeSpans[0]!.spans)).toBe(true);
    });

    it("should preserve resource attributes in OTLP format", async () => {
      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "abc123", spanId: "def456" }),
        resource: {
          attributes: {
            "service.name": "my-service",
            "service.version": "2.0.0",
            "deployment.environment": "production",
            "custom.attribute": "custom-value",
          },
        },
      };

      await new Promise<void>((resolve) => {
        exporter.export([mockSpan] as unknown as ReadableSpan[], () => {
          resolve();
        });
      });

      // extract resource attributes from OTLP payload
      const resourceSpans = (capturedPayload as { resourceSpans: unknown[] })?.resourceSpans;
      const resource = (resourceSpans?.[0] as { resource?: { attributes?: unknown[] } })?.resource;

      // OTLP format uses array of { key, value: { stringValue | intValue | ... } }
      expect(resource?.attributes).toEqual(
        expect.arrayContaining([
          { key: "service.name", value: { stringValue: "my-service" } },
          { key: "service.version", value: { stringValue: "2.0.0" } },
          { key: "deployment.environment", value: { stringValue: "production" } },
          { key: "custom.attribute", value: { stringValue: "custom-value" } },
        ]),
      );
    });

    it("should include all span fields in OTLP format", async () => {
      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "detailed-span",
        kind: 2, // SERVER
        attributes: { key: "value" },
        status: { code: 2, message: "Error occurred" }, // ERROR
        events: [{ name: "event1", time: [123, 0] }],
        startTime: [1000, 500],
        endTime: [1001, 500],
        spanContext: () => ({
          traceId: "trace123",
          spanId: "span456",
        }),
        parentSpanContext: { spanId: "parent789" },
        resource: { attributes: {} },
      };

      await new Promise<void>((resolve) => {
        exporter.export([mockSpan] as unknown as ReadableSpan[], () => {
          resolve();
        });
      });

      // get the span from OTLP structure
      const resourceSpans = (capturedPayload as { resourceSpans: unknown[] })?.resourceSpans;
      const scopeSpans = (resourceSpans?.[0] as { scopeSpans?: unknown[] })?.scopeSpans;
      const spans = (scopeSpans?.[0] as { spans?: unknown[] })?.spans;
      const span = spans?.[0] as Record<string, unknown>;

      // verify all required OTLP span fields
      expect(span).toHaveProperty("traceId");
      expect(span).toHaveProperty("spanId");
      expect(span).toHaveProperty("name");
      expect(span).toHaveProperty("kind");
      expect(span).toHaveProperty("startTimeUnixNano");
      expect(span).toHaveProperty("endTimeUnixNano");
      expect(span).toHaveProperty("attributes");
      expect(span).toHaveProperty("status");
    });
  });

  describe("HTTP response handling", () => {
    it("should treat non-2xx responses as errors", async () => {
      // mock 500 response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
        resource: { attributes: {} },
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            // should report failure for 500
            expect(result.code).toBe(1);
            resolve();
          },
        );
      });
    });

    it("should treat 4xx responses as errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      } as Response);

      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
        resource: { attributes: {} },
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            expect(result.code).toBe(1);
            resolve();
          },
        );
      });
    });

    it("should treat 2xx responses as success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 202, // Accepted
      } as Response);

      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
        resource: { attributes: {} },
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            expect(result.code).toBe(0);
            resolve();
          },
        );
      });
    });
  });

  describe("network failure handling", () => {
    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
        resource: { attributes: {} },
      };

      await new Promise<void>((resolve) => {
        exporter.export(
          [mockSpan] as unknown as ReadableSpan[],
          (result: ExportCallbackResult) => {
            expect(result.code).toBe(1);
            expect(result.error).toBeDefined();
            resolve();
          },
        );
      });
    });

    it("should not throw on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network unavailable"));

      exporter = new FetchSpanExporter({ endpoint: "/v1/traces" });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
        resource: { attributes: {} },
      };

      // should not throw, should call callback with error
      await expect(
        new Promise<void>((resolve, reject) => {
          try {
            exporter.export(
              [mockSpan] as unknown as ReadableSpan[],
              (result: ExportCallbackResult) => {
                if (result.code === 1) {
                  resolve();
                } else {
                  reject(new Error("Expected error code"));
                }
              },
            );
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("header preservation", () => {
    it("should preserve custom headers in fetch request", async () => {
      exporter = new FetchSpanExporter({
        endpoint: "/v1/traces",
        headers: {
          "X-API-Key": "secret-key",
          "X-Tenant-ID": "tenant-123",
        },
      });

      const mockSpan = {
        name: "test-span",
        spanContext: () => ({ traceId: "123", spanId: "456" }),
        resource: { attributes: {} },
      };

      await new Promise<void>((resolve) => {
        exporter.export([mockSpan] as unknown as ReadableSpan[], () => {
          resolve();
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String) as unknown as string,
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "secret-key",
            "X-Tenant-ID": "tenant-123",
            "Content-Type": "application/json",
          }) as unknown as Record<string, string>,
        }) as unknown as RequestInit,
      );
    });
  });
});
