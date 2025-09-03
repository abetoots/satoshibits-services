/**
 * Error Safety Tests
 *
 * Tests that verify fail-safe behavior when APIs are called before initialization.
 * Observability libraries MUST NOT throw errors - they should degrade gracefully.
 * These tests ensure that calling global getters before SmartClient.initialize()
 * returns safe defaults that don't break application code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { Span } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { SmartClient } from "../../index.mjs";
import { getGlobalContext } from "../../enrichment/context.mjs";
import { sanitize, sanitizeLabels, sanitizeError } from "../../enrichment/sanitizer.mjs";
import { reportError, extractErrorContext } from "../../smart-errors.mjs";
import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

describe("Fail-Safe Fallbacks", () => {
  let client: UnifiedObservabilityClient;

  beforeEach(async () => {
    // ensure clean state before each test
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  describe("getGlobalContext() Fail-Safe", () => {
    it("should return default context when called before initialization", () => {
      // call before initialization - should return default, not throw
      const context = getGlobalContext();

      // should return working instance with defaults
      expect(context).toBeDefined();
      expect(() => {
        context.setUser({ id: "user-456", email: "test@example.com" });
      }).not.toThrow();

      expect(() => {
        context.addTag("environment", "test");
      }).not.toThrow();

      expect(() => {
        context.addBreadcrumb({ category: "info", message: "Test", level: "info" });
      }).not.toThrow();
    });

    it("should work correctly when getGlobalContext() is called after initialization", async () => {
      // initialize client first
      client = await SmartClient.initialize({
        serviceName: "test-context-safety",
        environment: "test",
        disableInstrumentation: true,
      });

      // now call getGlobalContext() - should work
      const context = getGlobalContext();

      // should return working instance
      expect(() => {
        context.setUser({ id: "user-456", email: "test@example.com" });
      }).not.toThrow();

      expect(() => {
        context.addTag("environment", "test");
      }).not.toThrow();

      expect(() => {
        context.addBreadcrumb({ category: "info", message: "Initialized successfully", level: "info" });
      }).not.toThrow();

      expect(() => {
        const ctx = context.getContext();
        expect(ctx).toBeDefined();
      }).not.toThrow();
    });

    it("should return consistent default context on repeated calls", () => {
      // calling getGlobalContext before initialization returns default
      const context1 = getGlobalContext();
      const context2 = getGlobalContext();

      // both should work and be the same instance (consistent state)
      expect(context1).toBeDefined();
      expect(context2).toBeDefined();
      expect(context1).toBe(context2); // same default instance
    });
  });

  describe("Sanitizer Functions Fail-Safe", () => {
    it("should work when called before initialization", () => {
      // sanitizer functions should work before initialization
      expect(() => {
        const result = sanitize("test@example.com");
        expect(result).toBeDefined();
      }).not.toThrow();

      expect(() => {
        const result = sanitizeLabels({ email: "test@example.com" });
        expect(result).toBeDefined();
      }).not.toThrow();

      expect(() => {
        const result = sanitizeError(new Error("Test error"));
        expect(result).toBeDefined();
      }).not.toThrow();
    });

    it("should still sanitize PII even with default manager", () => {
      // default sanitizer should still protect sensitive data
      const result = sanitize("password: secret123");
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("secret123");
    });

    it("should be accessible through initialized client", async () => {
      // initialize client first
      client = await SmartClient.initialize({
        serviceName: "test-sanitizer-safety",
        environment: "test",
        disableInstrumentation: true,
      });

      // sanitizer manager should be accessible through client
      const sanitizerManager = client.getSanitizerManager();
      expect(sanitizerManager).toBeDefined();

      // should return working instance
      expect(() => {
        const sanitizer = sanitizerManager.getDefault();
        expect(sanitizer).toBeDefined();
      }).not.toThrow();

      expect(() => {
        const sanitizer = sanitizerManager.getSanitizer();
        expect(sanitizer).toBeDefined();
      }).not.toThrow();
    });
  });

  describe("Fail-Safe Behavior", () => {
    it("should never throw when called before initialization", () => {
      // observability libraries must be fail-safe
      expect(() => getGlobalContext()).not.toThrow();
      expect(() => sanitize("test")).not.toThrow();
      expect(() => sanitizeLabels({ test: "value" })).not.toThrow();
    });

    it("should return working defaults that don't break application code", () => {
      // get default context
      const context = getGlobalContext();

      // all operations should work without throwing
      expect(() => {
        context.setUser({ id: "user-123" });
        context.addTag("key", "value");
        context.addBreadcrumb({ category: "info", message: "Test", level: "info" });
        const ctx = context.getContext();
        expect(ctx).toBeDefined();
      }).not.toThrow();
    });

    it("should maintain consistent behavior before and after initialization", async () => {
      // before initialization - returns default
      const contextBefore = getGlobalContext();
      expect(contextBefore).toBeDefined();
      contextBefore.addTag("before", "init");

      // initialize
      client = await SmartClient.initialize({
        serviceName: "test-consistency",
        environment: "test",
        disableInstrumentation: true,
      });

      // after initialization - returns client instance
      const contextAfter = getGlobalContext();
      expect(contextAfter).toBeDefined();
      contextAfter.addTag("after", "init");

      // both should work without errors
      expect(() => contextBefore.getContext()).not.toThrow();
      expect(() => contextAfter.getContext()).not.toThrow();
    });
  });

  describe("Observability Best Practices", () => {
    it("should never break application code due to observability failure", () => {
      // observability libraries must be fail-safe
      // calling APIs before initialization should work with defaults
      expect(() => {
        const context = getGlobalContext();
        context.setUser({ id: "user" });
        const ctx = context.getContext();
        expect(ctx).toBeDefined();
      }).not.toThrow();
    });

    it("should degrade gracefully when not initialized", () => {
      // before initialization, APIs should work with sensible defaults
      const context = getGlobalContext();
      expect(context).toBeDefined();

      const result = sanitize("test");
      expect(result).toBeDefined();
    });
  });

  describe("Error Reporting Sanitization Security", () => {
    beforeEach(async () => {
      // initialize client for error reporting tests
      client = await SmartClient.initialize({
        serviceName: "test-error-sanitization",
        environment: "node",
        disableInstrumentation: true,
      });
    });

    describe("extractErrorContext() sanitizes sensitive data", () => {
      it("sanitizes passwords in error messages", () => {
        // create error with password - common in authentication failures
        const error = new Error("Authentication failed for user admin with password: SuperSecret123!");

        // extract context - this is what gets exported to telemetry
        const context = extractErrorContext(error);

        // FIXED: The password is now sanitized
        expect(context["error.message"]).not.toContain("SuperSecret123");
        expect(context["error.message"]).toContain("[REDACTED]");
      });

      it("sanitizes API keys in error messages", () => {
        const error = new Error("API request failed with key: sk_live_1234567890abcdef");

        const context = extractErrorContext(error);

        // FIXED: The API key is now sanitized
        expect(context["error.message"]).not.toContain("sk_live_1234567890abcdef");
        expect(context["error.message"]).toContain("[REDACTED]");
      });

      it("sanitizes sensitive data in error.details", () => {
        interface ErrorWithDetails extends Error {
          details?: unknown;
        }

        const error = new Error("Payment processing failed") as ErrorWithDetails;
        error.details = {
          creditCard: "4532-1234-5678-9010",
          cvv: "123",
          email: "customer@example.com",
          apiKey: "sk_test_secret",
        };

        const context = extractErrorContext(error);

        // FIXED: Sensitive details are now sanitized
        const details = context["error.details"] as Record<string, unknown>;
        expect(details.creditCard).toContain("[REDACTED]");
        expect(details.email).toContain("[REDACTED]");
        expect(details.apiKey).toContain("[REDACTED]");
      });

      it("sanitizes credentials in stack traces", () => {
        const error = new Error("Database connection failed");
        // simulate stack with connection string (happens in real apps)
        error.stack = `Error: Database connection failed
    at connect (file:///app/db.js:42:15)
    at connectWithCredentials ("mongodb://admin:SuperSecret123@localhost:27017")`;

        const context = extractErrorContext(error);

        // FIXED: Stack trace with credentials is now sanitized
        expect(context["error.stack"]).not.toContain("SuperSecret123");
        expect(context["error.stack"]).toContain("[REDACTED]");
      });
    });

    describe("reportError() exports sanitized data to telemetry", () => {
      it("sends sanitized error messages to spans", () => {
        // mock span to capture what gets exported
        interface MockSpan extends Partial<Span> {
          recordException: ReturnType<typeof vi.fn>;
          setStatus: ReturnType<typeof vi.fn>;
          setAttributes: ReturnType<typeof vi.fn>;
        }

        const mockSpan: MockSpan = {
          recordException: vi.fn(),
          setStatus: vi.fn(),
          setAttributes: vi.fn(),
        };

        vi.spyOn(trace, "getActiveSpan").mockReturnValue(mockSpan as Span);

        // create error with sensitive data
        const error = new Error("Failed to authenticate with password: MyPassword123");

        // report the error - this simulates real usage
        reportError(error);

        // FIXED: sanitized data is sent to telemetry
        expect(mockSpan.recordException).toHaveBeenCalledWith(error);
        expect(mockSpan.setStatus).toHaveBeenCalledWith({
          code: SpanStatusCode.ERROR,
          message: expect.stringContaining("[REDACTED]"),
        });

        // verify password is not in status message
        const statusCall = mockSpan.setStatus.mock.calls[0];
        expect(statusCall).toBeDefined();
        const status = statusCall?.[0] as { code: number; message: string };
        expect(status.message).not.toContain("MyPassword123");

        // check attributes contain sanitized data
        const setAttributesCall = mockSpan.setAttributes.mock.calls[0];
        expect(setAttributesCall).toBeDefined();
        const attributes = setAttributesCall?.[0] as Record<string, unknown>;
        expect(attributes["error.message"]).not.toContain("MyPassword123");
        expect(attributes["error.message"]).toContain("[REDACTED]");
      });

      it("sends sanitized error messages to logs", () => {
        // mock logger to capture what gets exported
        interface MockLogger extends Partial<Logger> {
          emit: ReturnType<typeof vi.fn>;
        }

        const mockLogger: MockLogger = {
          emit: vi.fn(),
        };

        const getLoggerSpy = vi.spyOn(logs, "getLogger").mockReturnValue(mockLogger as Logger);

        // create error with PII
        const error = new Error("User registration failed for email: user@example.com, ssn: 123-45-6789");

        // report the error
        reportError(error);

        // FIXED: sanitized data is sent to logs
        const emitCall = mockLogger.emit.mock.calls[0];
        expect(emitCall).toBeDefined();
        const logRecord = emitCall?.[0] as {
          body: string;
          attributes: Record<string, unknown>;
        };

        // verify SSN is redacted
        expect(logRecord.body).not.toContain("123-45-6789");
        expect(logRecord.body).toContain("[REDACTED]");
        expect(logRecord.attributes["error.message"]).not.toContain("123-45-6789");
        expect(logRecord.attributes["error.message"]).toContain("[REDACTED]");

        getLoggerSpy.mockRestore();
      });

      it("sanitizes custom context", () => {
        interface MockSpan extends Partial<Span> {
          recordException: ReturnType<typeof vi.fn>;
          setStatus: ReturnType<typeof vi.fn>;
          setAttributes: ReturnType<typeof vi.fn>;
        }

        const mockSpan: MockSpan = {
          recordException: vi.fn(),
          setStatus: vi.fn(),
          setAttributes: vi.fn(),
        };

        vi.spyOn(trace, "getActiveSpan").mockReturnValue(mockSpan as Span);

        const error = new Error("Payment failed");
        const customContext = {
          userId: "12345",
          creditCard: "4111-1111-1111-1111",
          apiKey: "sk_live_secret123",
        };

        // report with custom context
        reportError(error, customContext);

        // FIXED: custom context is now sanitized
        const setAttributesCall = mockSpan.setAttributes.mock.calls[0];
        expect(setAttributesCall).toBeDefined();
        const attributes = setAttributesCall?.[0] as Record<string, unknown>;
        expect(attributes.creditCard).toContain("[REDACTED]");
        expect(attributes.creditCard).not.toContain("4111-1111-1111-1111");
        expect(attributes.apiKey).toContain("[REDACTED]");
        expect(attributes.apiKey).not.toContain("sk_live_secret123");
      });
    });
  });
});
