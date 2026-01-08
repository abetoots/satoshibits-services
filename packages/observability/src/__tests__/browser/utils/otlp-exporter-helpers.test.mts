/**
 * Unit tests for OTLP Exporter Helpers
 *
 * Tests the shared utility functions extracted from browser exporters:
 * - hrTimeToNanos: HrTime to nanoseconds conversion
 * - convertAttributeValue / convertAttributes: OTLP attribute formatting
 * - isCrossOrigin: Cross-origin detection for CORS decisions
 * - sendOtlpData: Transport abstraction (fetch/sendBeacon)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  convertAttributes,
  convertAttributeValue,
  hrTimeToNanos,
  isCrossOrigin,
  sendOtlpData,
} from "../../../browser/utils/otlp-exporter-helpers.mjs";

describe("OTLP Exporter Helpers (R1 Refactoring)", () => {
  describe("hrTimeToNanos", () => {
    it("should convert HrTime tuple to nanoseconds string", () => {
      // [seconds, nanoseconds]
      const hrTime: [number, number] = [1234567890, 123456789];
      const result = hrTimeToNanos(hrTime);
      expect(result).toBe("1234567890123456789");
    });

    it("should handle zero values", () => {
      const hrTime: [number, number] = [0, 0];
      expect(hrTimeToNanos(hrTime)).toBe("0");
    });

    it("should handle undefined input", () => {
      expect(hrTimeToNanos(undefined)).toBe("0");
    });

    it("should handle large nanosecond values", () => {
      // max nanoseconds is 999999999
      const hrTime: [number, number] = [1, 999999999];
      expect(hrTimeToNanos(hrTime)).toBe("1999999999");
    });

    it("should handle large timestamp values without overflow", () => {
      // unix timestamp for year 2100
      const hrTime: [number, number] = [4102444800, 0];
      expect(hrTimeToNanos(hrTime)).toBe("4102444800000000000");
    });
  });

  describe("convertAttributeValue", () => {
    it("should convert string values", () => {
      expect(convertAttributeValue("hello")).toEqual({ stringValue: "hello" });
    });

    it("should convert integer values", () => {
      expect(convertAttributeValue(42)).toEqual({ intValue: 42 });
    });

    it("should convert float values", () => {
      expect(convertAttributeValue(3.14)).toEqual({ doubleValue: 3.14 });
    });

    it("should convert boolean values", () => {
      expect(convertAttributeValue(true)).toEqual({ boolValue: true });
      expect(convertAttributeValue(false)).toEqual({ boolValue: false });
    });

    it("should stringify null", () => {
      expect(convertAttributeValue(null)).toEqual({ stringValue: "null" });
    });

    it("should stringify undefined", () => {
      expect(convertAttributeValue(undefined)).toEqual({
        stringValue: "undefined",
      });
    });

    it("should convert arrays to OTLP arrayValue format", () => {
      expect(convertAttributeValue([1, 2, 3])).toEqual({
        arrayValue: {
          values: [{ intValue: 1 }, { intValue: 2 }, { intValue: 3 }],
        },
      });
    });

    it("should handle mixed-type arrays", () => {
      expect(convertAttributeValue(["a", 1, true])).toEqual({
        arrayValue: {
          values: [{ stringValue: "a" }, { intValue: 1 }, { boolValue: true }],
        },
      });
    });

    it("should handle nested arrays", () => {
      expect(convertAttributeValue([[1, 2], [3]])).toEqual({
        arrayValue: {
          values: [
            { arrayValue: { values: [{ intValue: 1 }, { intValue: 2 }] } },
            { arrayValue: { values: [{ intValue: 3 }] } },
          ],
        },
      });
    });

    it("should handle empty arrays", () => {
      expect(convertAttributeValue([])).toEqual({
        arrayValue: { values: [] },
      });
    });

    it("should stringify objects", () => {
      expect(convertAttributeValue({ foo: "bar" })).toEqual({
        stringValue: "[object Object]",
      });
    });
  });

  describe("convertAttributes", () => {
    it("should convert record to OTLP KeyValue array", () => {
      const attrs = {
        service: "api",
        count: 5,
        active: true,
        ratio: 0.75,
      };

      const result = convertAttributes(attrs);

      expect(result).toEqual([
        { key: "service", value: { stringValue: "api" } },
        { key: "count", value: { intValue: 5 } },
        { key: "active", value: { boolValue: true } },
        { key: "ratio", value: { doubleValue: 0.75 } },
      ]);
    });

    it("should handle empty attributes", () => {
      expect(convertAttributes({})).toEqual([]);
    });
  });

  describe("isCrossOrigin", () => {
    // use the windowOrigin parameter for deterministic testing
    // this avoids browser environment issues where globalThis.window is read-only
    const TEST_ORIGIN = "https://example.com";

    it("should return false for relative URLs", () => {
      expect(isCrossOrigin("/v1/traces", TEST_ORIGIN)).toBe(false);
      expect(isCrossOrigin("/api/telemetry", TEST_ORIGIN)).toBe(false);
    });

    it("should return true for protocol-relative URLs", () => {
      expect(isCrossOrigin("//other.com/api", TEST_ORIGIN)).toBe(true);
    });

    it("should return true for cross-origin absolute URLs", () => {
      expect(isCrossOrigin("https://other.com/api", TEST_ORIGIN)).toBe(true);
    });

    it("should return false for same-origin absolute URLs", () => {
      expect(isCrossOrigin("https://example.com/api", TEST_ORIGIN)).toBe(false);
    });

    it("should use windowOrigin parameter for testing", () => {
      expect(isCrossOrigin("https://test.com/api", "https://test.com")).toBe(
        false,
      );
      expect(isCrossOrigin("https://other.com/api", "https://test.com")).toBe(
        true,
      );
    });

    // skip in browser mode: this tests SSR fallback behavior where window doesn't exist,
    // but in real Chromium window.location.origin is always available
    it.skip("should return false when no origin provided (SSR fallback)", () => {
      // without windowOrigin param and no window global, should return false (SSR safety)
      // note: in real browser, window.location.origin would be used
      // this test verifies the SSR fallback behavior
      expect(isCrossOrigin("https://any.com/api", undefined)).toBe(false);
    });

    it("should use windowOrigin param to detect cross-origin", () => {
      // with explicit origin, should correctly detect cross-origin
      expect(
        isCrossOrigin("https://other.com/api", "https://example.com"),
      ).toBe(true);
      expect(
        isCrossOrigin("https://example.com/api", "https://example.com"),
      ).toBe(false);
    });

    it("should return false for malformed URLs", () => {
      expect(isCrossOrigin("not-a-valid-url", TEST_ORIGIN)).toBe(false);
    });
  });

  describe("sendOtlpData", () => {
    const mockFetch = vi.fn();
    const mockSendBeacon = vi.fn();
    // use windowOrigin parameter for testing instead of mocking window.location
    // (window is read-only in real Chromium browsers)
    const TEST_ORIGIN = "https://example.com";

    beforeEach(() => {
      vi.clearAllMocks();
      // use vi.stubGlobal for proper mocking in browser environments
      vi.stubGlobal("fetch", mockFetch);
      vi.stubGlobal("navigator", { sendBeacon: mockSendBeacon });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should call onSuccess callback when fetch succeeds", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onSuccess = vi.fn(() => "success");
      const onError = vi.fn(() => "error");

      const result = sendOtlpData({
        url: "https://other.com/v1/traces", // cross-origin to trigger fetch
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        windowOrigin: TEST_ORIGIN,
        onSuccess,
        onError,
      });

      await result;

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it("should call onError callback when fetch fails with HTTP error", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const onSuccess = vi.fn(() => "success");
      const onError = vi.fn(() => "error");

      const result = sendOtlpData({
        url: "https://other.com/v1/traces",
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        windowOrigin: TEST_ORIGIN,
        onSuccess,
        onError,
      });

      await result;

      expect(onError).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("should call onError callback when fetch throws network error", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      const onSuccess = vi.fn(() => "success");
      const onError = vi.fn(() => "error");

      const result = sendOtlpData({
        url: "https://other.com/v1/traces",
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        windowOrigin: TEST_ORIGIN,
        onSuccess,
        onError,
      });

      await result;

      expect(onError).toHaveBeenCalled();
    });

    it("should use sendBeacon for same-origin when useBeacon is true", async () => {
      mockSendBeacon.mockReturnValue(true);

      const onSuccess = vi.fn(() => "success");
      const onError = vi.fn(() => "error");

      await sendOtlpData({
        url: "/v1/traces", // same-origin
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess,
        onError,
      });

      expect(mockSendBeacon).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });

    it("should use fetch for cross-origin even when useBeacon is true", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await sendOtlpData({
        url: "https://other.com/v1/traces", // cross-origin
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess: () => "success",
        onError: () => "error",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(mockSendBeacon).not.toHaveBeenCalled();
    });

    it("should use fetch when custom auth headers are present", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await sendOtlpData({
        url: "/v1/traces", // same-origin
        body: '{"test":true}',
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token", // custom auth header
        },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess: () => "success",
        onError: () => "error",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(mockSendBeacon).not.toHaveBeenCalled();
    });

    it("should call onError when sendBeacon fails", async () => {
      mockSendBeacon.mockReturnValue(false);

      const onSuccess = vi.fn(() => "success");
      const onError = vi.fn(() => "error");

      await sendOtlpData({
        url: "/v1/traces",
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess,
        onError,
      });

      expect(onError).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("should skip sendBeacon for large payloads", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const largeBody = "x".repeat(70000); // > 65536 default limit

      await sendOtlpData({
        url: "/v1/traces",
        body: largeBody,
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess: () => "success",
        onError: () => "error",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(mockSendBeacon).not.toHaveBeenCalled();
    });

    it("should return onSuccess result for sendBeacon success", () => {
      mockSendBeacon.mockReturnValue(true);

      const result = sendOtlpData({
        url: "/v1/traces",
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess: () => "my-success-value",
        onError: () => "my-error-value",
      });

      expect(result).toBe("my-success-value");
    });

    it("should return onError result for sendBeacon failure", () => {
      mockSendBeacon.mockReturnValue(false);

      const result = sendOtlpData({
        url: "/v1/traces",
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess: () => "my-success-value",
        onError: () => "my-error-value",
      });

      expect(result).toBe("my-error-value");
    });

    it("should call onError when no transport is available", () => {
      // use vi.stubGlobal to remove fetch and sendBeacon for this test
      vi.stubGlobal("fetch", undefined);
      vi.stubGlobal("navigator", undefined);

      const onSuccess = vi.fn(() => "success");
      const onError = vi.fn(() => "error");
      const consoleSpy = vi
        .spyOn(console, "error")
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementation(() => {});

      const result = sendOtlpData({
        url: "/v1/traces",
        body: '{"test":true}',
        headers: { "Content-Type": "application/json" },
        windowOrigin: TEST_ORIGIN,
        onSuccess,
        onError,
      });

      expect(onError).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(result).toBe("error");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No transport available"),
      );

      consoleSpy.mockRestore();
    });

    it("should use Blob.size for accurate byte length check", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      // multi-byte UTF-8 characters: each emoji is 4 bytes
      // 16384 emojis × 4 bytes = 65536 bytes (exactly at limit)
      const multiByteBody = "😀".repeat(16384);

      await sendOtlpData({
        url: "/v1/traces",
        body: multiByteBody,
        headers: { "Content-Type": "application/json" },
        useBeacon: true,
        windowOrigin: TEST_ORIGIN,
        onSuccess: () => "success",
        onError: () => "error",
      });

      // should fall back to fetch because Blob.size exceeds limit
      expect(mockFetch).toHaveBeenCalled();
      expect(mockSendBeacon).not.toHaveBeenCalled();
    });
  });
});
