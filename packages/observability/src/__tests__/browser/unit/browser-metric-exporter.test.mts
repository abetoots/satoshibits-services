/**
 * BrowserFetchMetricExporter Tests
 *
 * Doc 4 H1 Fix: Tests for histogram bucket data export in OTLP format
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import type { ResourceMetrics } from "@opentelemetry/sdk-metrics";

import { FetchMetricExporter } from "../../../sdk-wrapper-browser.mjs";

// type for expected OTLP metric payload structure
interface OtlpMetricDataPoint {
  explicitBounds?: number[];
  bucketCounts?: number[];
  min?: number;
  max?: number;
  sum?: number;
  count?: number;
  asInt?: number;
}

interface OtlpMetricData {
  dataPoints: OtlpMetricDataPoint[];
  isMonotonic?: boolean;
}

interface OtlpMetric {
  histogram?: OtlpMetricData;
  sum?: OtlpMetricData;
}

interface OtlpScopeMetrics {
  metrics: OtlpMetric[];
}

interface OtlpResourceMetrics {
  scopeMetrics: OtlpScopeMetrics[];
}

interface OtlpPayload {
  resourceMetrics: OtlpResourceMetrics[];
}

// mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("FetchMetricExporter - Doc 4 H1 Histogram Bucket Export", () => {
  let exporter: FetchMetricExporter;
  let capturedPayload: string | null = null;

  beforeEach(() => {
    capturedPayload = null;
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      capturedPayload = options?.body as string;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    exporter = new FetchMetricExporter({
      endpoint: "/v1/metrics",
      headers: { "X-Test": "true" },
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await exporter.shutdown();
  });

  // helper to create a mock ResourceMetrics with histogram data
  function createHistogramResourceMetrics(options: {
    min?: number;
    max?: number;
    sum?: number;
    count?: number;
    buckets?: { boundaries: number[]; counts: number[] };
  }): ResourceMetrics {
    return {
      resource: {
        attributes: { "service.name": "test-service" },
      },
      scopeMetrics: [
        {
          scope: {
            name: "test-meter",
            version: "1.0.0",
          },
          metrics: [
            {
              descriptor: {
                name: "test.histogram",
                description: "Test histogram metric",
                unit: "ms",
                type: "HISTOGRAM",
              },
              dataPoints: [
                {
                  startTime: [1704067200, 0] as [number, number], // 2024-01-01 00:00:00 UTC
                  endTime: [1704067260, 0] as [number, number], // 2024-01-01 00:01:00 UTC
                  attributes: { operation: "test" },
                  value: {
                    min: options.min,
                    max: options.max,
                    sum: options.sum,
                    count: options.count,
                    buckets: options.buckets,
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ResourceMetrics;
  }

  describe("histogram export with bucket data (Doc 4 H1 Fix)", () => {
    it("should include explicitBounds and bucketCounts when bucket data is present", async () => {
      const metrics = createHistogramResourceMetrics({
        min: 10,
        max: 100,
        sum: 550,
        count: 10,
        buckets: {
          boundaries: [0, 25, 50, 75, 100],
          counts: [0, 2, 5, 2, 1, 0], // 6 counts for 5 boundaries (n+1 buckets)
        },
      });

      await new Promise<void>((resolve) => {
        exporter.export(metrics, (result) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          resolve();
        });
      });

      expect(capturedPayload).not.toBeNull();
      const payload = JSON.parse(capturedPayload!) as OtlpPayload;

      // navigate to the histogram data point
      const histogramData =
        payload.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.histogram;
      expect(histogramData).toBeDefined();

      const dataPoint = histogramData?.dataPoints[0];

      // Doc 4 H1 Fix: verify bucket data is included
      expect(dataPoint?.explicitBounds).toEqual([0, 25, 50, 75, 100]);
      expect(dataPoint?.bucketCounts).toEqual([0, 2, 5, 2, 1, 0]);

      // verify other histogram fields are still present
      expect(dataPoint?.min).toBe(10);
      expect(dataPoint?.max).toBe(100);
      expect(dataPoint?.sum).toBe(550);
      expect(dataPoint?.count).toBe(10);
    });

    it("should handle histogram without bucket data gracefully", async () => {
      // some histogram aggregations may not have bucket data (e.g., drop aggregation)
      const metrics = createHistogramResourceMetrics({
        min: 5,
        max: 50,
        sum: 100,
        count: 5,
        // no buckets property
      });

      await new Promise<void>((resolve) => {
        exporter.export(metrics, (result) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          resolve();
        });
      });

      expect(capturedPayload).not.toBeNull();
      const payload = JSON.parse(capturedPayload!) as OtlpPayload;

      const histogramData =
        payload.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.histogram;
      const dataPoint = histogramData?.dataPoints[0];

      // should not have bucket data if not provided
      expect(dataPoint?.explicitBounds).toBeUndefined();
      expect(dataPoint?.bucketCounts).toBeUndefined();

      // but other fields should still be present
      expect(dataPoint?.min).toBe(5);
      expect(dataPoint?.max).toBe(50);
      expect(dataPoint?.sum).toBe(100);
      expect(dataPoint?.count).toBe(5);
    });

    it("should handle empty bucket arrays", async () => {
      const metrics = createHistogramResourceMetrics({
        min: 0,
        max: 0,
        sum: 0,
        count: 0,
        buckets: {
          boundaries: [],
          counts: [0], // single bucket for no boundaries
        },
      });

      await new Promise<void>((resolve) => {
        exporter.export(metrics, (result) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          resolve();
        });
      });

      expect(capturedPayload).not.toBeNull();
      const payload = JSON.parse(capturedPayload!) as OtlpPayload;

      const dataPoint =
        payload.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.histogram
          ?.dataPoints[0];

      expect(dataPoint?.explicitBounds).toEqual([]);
      expect(dataPoint?.bucketCounts).toEqual([0]);
    });
  });

  describe("counter/gauge export (regression test)", () => {
    it("should still correctly export counter metrics", async () => {
      const metrics = {
        resource: {
          attributes: { "service.name": "test-service" },
        },
        scopeMetrics: [
          {
            scope: { name: "test-meter", version: "1.0.0" },
            metrics: [
              {
                descriptor: {
                  name: "test.counter",
                  description: "Test counter",
                  unit: "1",
                  type: "COUNTER",
                },
                dataPoints: [
                  {
                    startTime: [1704067200, 0],
                    endTime: [1704067260, 0],
                    attributes: {},
                    value: 42,
                  },
                ],
              },
            ],
          },
        ],
      } as unknown as ResourceMetrics;

      await new Promise<void>((resolve) => {
        exporter.export(metrics, (result) => {
          expect(result.code).toBe(ExportResultCode.SUCCESS);
          resolve();
        });
      });

      expect(capturedPayload).not.toBeNull();
      const payload = JSON.parse(capturedPayload!) as OtlpPayload;

      const sumData =
        payload.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.sum;
      expect(sumData).toBeDefined();
      expect(sumData?.isMonotonic).toBe(true);
      expect(sumData?.dataPoints[0]?.asInt).toBe(42);
    });
  });
});

// NOTE: CORS detection tests are skipped in browser mode because window.location
// is read-only in real Chromium and cannot be mocked. The CORS logic is tested
// in otlp-exporter-helpers.test.mts which uses the windowOrigin parameter.
// See: src/__tests__/browser/utils/otlp-exporter-helpers.test.mts
describe.skip("FetchMetricExporter - Doc 4 H2 CORS Fix", () => {
  const mockSendBeacon = vi.fn().mockReturnValue(true);

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    mockSendBeacon.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use fetch for cross-origin endpoints (Doc 4 H2 Fix)", async () => {
    // cross-origin endpoint
    const exporter = new FetchMetricExporter({
      endpoint: "https://telemetry.example.com/v1/metrics",
    });

    const metrics = {
      resource: { attributes: {} },
      scopeMetrics: [
        {
          scope: { name: "test", version: "1.0.0" },
          metrics: [
            {
              descriptor: { name: "test", type: "COUNTER" },
              dataPoints: [
                { startTime: [0, 0], endTime: [0, 0], attributes: {}, value: 1 },
              ],
            },
          ],
        },
      ],
    } as unknown as ResourceMetrics;

    await new Promise<void>((resolve) => {
      exporter.export(metrics, () => resolve());
    });

    // should use fetch, not sendBeacon
    expect(mockFetch).toHaveBeenCalled();
    expect(mockSendBeacon).not.toHaveBeenCalled();

    await exporter.shutdown();
  });

  it("should use sendBeacon with application/json for same-origin endpoints (Doc 4 H2 Fix)", async () => {
    // same-origin endpoint (relative path)
    const exporter = new FetchMetricExporter({
      endpoint: "/v1/metrics",
    });

    const metrics = {
      resource: { attributes: {} },
      scopeMetrics: [
        {
          scope: { name: "test", version: "1.0.0" },
          metrics: [
            {
              descriptor: { name: "test", type: "COUNTER" },
              dataPoints: [
                { startTime: [0, 0], endTime: [0, 0], attributes: {}, value: 1 },
              ],
            },
          ],
        },
      ],
    } as unknown as ResourceMetrics;

    await new Promise<void>((resolve) => {
      exporter.export(metrics, () => resolve());
    });

    // should use sendBeacon for same-origin
    expect(mockSendBeacon).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();

    // Doc 4 H2 Fix: same-origin can safely use application/json (no CORS preflight)
    const blobArg = mockSendBeacon.mock.calls[0]![1] as Blob;
    expect(blobArg.type).toBe("application/json");

    await exporter.shutdown();
  });

  it("should use fetch for protocol-relative URLs (Doc 4 H2 Fix)", async () => {
    // protocol-relative URL - should be treated as cross-origin
    const exporter = new FetchMetricExporter({
      endpoint: "//telemetry.example.com/v1/metrics",
    });

    const metrics = {
      resource: { attributes: {} },
      scopeMetrics: [
        {
          scope: { name: "test", version: "1.0.0" },
          metrics: [
            {
              descriptor: { name: "test", type: "COUNTER" },
              dataPoints: [
                { startTime: [0, 0], endTime: [0, 0], attributes: {}, value: 1 },
              ],
            },
          ],
        },
      ],
    } as unknown as ResourceMetrics;

    await new Promise<void>((resolve) => {
      exporter.export(metrics, () => resolve());
    });

    // protocol-relative URLs should use fetch (cross-origin handling)
    expect(mockFetch).toHaveBeenCalled();
    expect(mockSendBeacon).not.toHaveBeenCalled();

    await exporter.shutdown();
  });

  it("should use fetch when custom headers are present", async () => {
    const exporter = new FetchMetricExporter({
      endpoint: "/v1/metrics",
      headers: { Authorization: "Bearer token123" },
    });

    const metrics = {
      resource: { attributes: {} },
      scopeMetrics: [
        {
          scope: { name: "test", version: "1.0.0" },
          metrics: [
            {
              descriptor: { name: "test", type: "COUNTER" },
              dataPoints: [
                { startTime: [0, 0], endTime: [0, 0], attributes: {}, value: 1 },
              ],
            },
          ],
        },
      ],
    } as unknown as ResourceMetrics;

    await new Promise<void>((resolve) => {
      exporter.export(metrics, () => resolve());
    });

    // should use fetch due to custom auth header
    expect(mockFetch).toHaveBeenCalled();
    expect(mockSendBeacon).not.toHaveBeenCalled();

    await exporter.shutdown();
  });
});
