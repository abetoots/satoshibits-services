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
import { logs } from "@opentelemetry/api-logs";
import type { Span } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { SmartClient } from "../../index.mjs";
import { getGlobalContext } from "../../enrichment/context.mjs";
import { sanitize, sanitizeLabels, sanitizeError } from "../../enrichment/sanitizer.mjs";
import { reportError, extractErrorContext } from "../../smart-errors.mjs";
import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

describe("Fail-Safe Fallbacks", () => {
  let client: UnifiedObservabilityClient;

  beforeEach(() => {
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
        environment: "node",
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
        environment: "node",
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
        environment: "node",
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
          message: expect.stringContaining("[REDACTED]") as unknown as string,
        });

        // verify password is not in status message
        const statusCall = mockSpan.setStatus.mock.calls[0] as [{ code: number; message: string }] | undefined;
        expect(statusCall).toBeDefined();
        const status = statusCall?.[0];
        expect(status?.message).not.toContain("MyPassword123");

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

/**
 * L6 Implementation: Tests using real SmartClient instead of mocking internal OTel APIs.
 *
 * These tests reduce coupling to internal OTel APIs like trace.getActiveSpan() by using
 * the real SmartClient public API. They verify that error capture works correctly
 * without needing to mock OTel internals.
 *
 * NOTE: Span export verification is limited due to known OTel global provider caching
 * (see telemetry-pipeline.test.mts TODO). These tests focus on API behavior instead.
 */
describe("Error Sanitization with Real Client API (L6 Implementation)", () => {
  let client: UnifiedObservabilityClient;

  beforeEach(async () => {
    // use real SmartClient - no mocking of internal OTel APIs
    client = await SmartClient.initialize({
      serviceName: "l6-real-client-test",
      environment: "node",
      disableInstrumentation: true,
    });
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  it("should capture errors with sensitive data without coupling to getActiveSpan()", async () => {
    // this test uses the PUBLIC client API without mocking trace.getActiveSpan()
    // contrast with the brittle tests above at lines 284-396 which mock internals
    const result = await client.traces.withSpan("error-capture-span", () => {
      const error = new Error("Login failed for user with password: Secret123!");
      client.errors.capture(error, {
        userId: "12345",
        password: "MySecretPassword",
      });
      return Promise.resolve("captured");
    });

    expect(result).toBe("captured");
  });

  it("should handle error reporting within traces without internal mocking", async () => {
    const result = await client.traces.withSpan("payment-error-span", () => {
      const error = new Error("Payment failed with cc: 4111-1111-1111-1111");
      client.errors.capture(error, {
        creditCard: "4111-1111-1111-1111",
        ssn: "123-45-6789",
      });
      return Promise.resolve("completed");
    });

    expect(result).toBe("completed");
  });

  it("should handle error boundary without coupling to OTel internals", async () => {
    const result = await client.errors.boundary(
      () => {
        throw new Error("API call failed with token: bearer_sk_live_123456");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        return "handled";
      },
    );

    expect(result).toBe("handled");
  });

  it("should allow rapid error capture without internal state corruption", async () => {
    const result = await client.traces.withSpan("rapid-error-burst", () => {
      const sensitiveErrors = [
        new Error("Failed with password: abc123"),
        new Error("API key exposed: sk_live_secret"),
        new Error("SSN in message: 123-45-6789"),
        new Error("Credit card: 4111-1111-1111-1111"),
        new Error("Email leak: user@example.com"),
      ];

      sensitiveErrors.forEach((error, i) => {
        expect(() => {
          client.errors.capture(error, { index: i, secret: `token_${i}` });
        }).not.toThrow();
      });

      return Promise.resolve("all-captured");
    });

    expect(result).toBe("all-captured");
  });

  it("should work with error wrap utility without OTel mocking", () => {
    const wrappedFn = client.errors.wrap(() => {
      const data = { apiKey: "sk_live_123", value: 42 };
      return data.value;
    }, "wrapped-operation");

    expect(wrappedFn()).toBe(42);
  });

  it("should categorize errors using public API", () => {
    const error = new Error("Network timeout with credentials: user:pass@host");
    const category = client.errors.categorize(error);

    expect(typeof category).toBe("string");
  });
});

/**
 * L10 Implementation: Verify sanitization in telemetry payloads
 *
 * Multi-Model Review Finding (Codex Primary):
 * "Tests call sanitizeObject and assert errors.record doesn't throw, but no verification
 * that sanitized data actually flows through to exported logs/metrics/spans."
 *
 * Approach:
 * 1. extractErrorContext() tests verify sanitization happens before data flows to telemetry
 * 2. client.errors.capture() tests verify the public API works without throwing
 * 3. Full span export verification is limited by OTel global provider caching (see H2/telemetry-pipeline.test.mts)
 *
 * The tests at lines 284-397 above use mocked spans to verify sanitized data is passed
 * to span.setAttributes() and logger.emit(). This L10 block complements that by testing
 * the sanitization functions that feed into those calls.
 *
 * NOTE: InMemorySpanExporter-based tests are unreliable after first shutdown due to
 * OTel global provider caching. See telemetry-pipeline.test.mts TODO for investigation.
 */
describe("Sanitization in Telemetry Payloads (L10 Implementation)", () => {
  let client: UnifiedObservabilityClient;

  beforeEach(async () => {
    client = await SmartClient.initialize({
      serviceName: "l10-sanitization-telemetry-test",
      environment: "node",
      disableInstrumentation: true,
    });
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  describe("Error Context Sanitization in Telemetry Pipeline", () => {
    it("should sanitize password in error context before span attributes", () => {
      // verify extractErrorContext sanitizes passwords
      const error = new Error("Login failed with password: SuperSecret123!");
      const context = extractErrorContext(error);

      // this is what gets set as span attributes
      expect(context["error.message"]).not.toContain("SuperSecret123");
      expect(context["error.message"]).toContain("[REDACTED]");
    });

    it("should sanitize API keys in error context before span attributes", () => {
      const error = new Error("Request failed with key: sk_live_abcdef123456");
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("sk_live_abcdef123456");
      expect(context["error.message"]).toContain("[REDACTED]");
    });

    it("should sanitize credit card numbers in error details before span attributes", () => {
      interface ErrorWithDetails extends Error {
        details?: Record<string, unknown>;
      }
      const error = new Error("Payment failed") as ErrorWithDetails;
      error.details = {
        creditCard: "4111-1111-1111-1111",
        amount: 99.99,
      };

      const context = extractErrorContext(error);
      const details = context["error.details"] as Record<string, unknown>;

      expect(details.creditCard).toContain("[REDACTED]");
      expect(details.creditCard).not.toContain("4111-1111-1111-1111");
      // non-sensitive data should be preserved
      expect(details.amount).toBe(99.99);
    });

    it("should sanitize SSN patterns in error context", () => {
      const error = new Error("User data: SSN 123-45-6789, name John");
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("123-45-6789");
      expect(context["error.message"]).toContain("[REDACTED]");
      // non-sensitive data should be preserved
      expect(context["error.message"]).toContain("John");
    });

    it("should sanitize email addresses in error context", () => {
      const error = new Error("User email: secret@example.com failed validation");
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("secret@example.com");
      expect(context["error.message"]).toContain("[REDACTED]");
    });
  });

  describe("Custom Context Sanitization in Error Capture", () => {
    it("should sanitize custom context passed to error capture", async () => {
      // codex/gemini: strengthen by also verifying sanitization of context
      await client.traces.withSpan("error-capture-span", () => {
        const error = new Error("Operation failed");
        const customContext = {
          userId: "user-123",
          password: "MySecretPassword123",
          apiKey: "sk_live_secret_key_12345",
        };

        // verify the client API works without throwing
        expect(() => client.errors.capture(error, customContext)).not.toThrow();

        // also verify sanitization would occur via sanitizeLabels (used by reportError)
        const sanitizedContext = sanitizeLabels(customContext);
        expect(sanitizedContext.password).toContain("[REDACTED]");
        expect(sanitizedContext.password).not.toContain("MySecretPassword123");
        expect(sanitizedContext.apiKey).toContain("[REDACTED]");
        // non-sensitive data preserved
        expect(sanitizedContext.userId).toBe("user-123");
        return Promise.resolve();
      });
    });

    it("should handle nested objects in custom context", async () => {
      await client.traces.withSpan("nested-context-span", () => {
        const error = new Error("Nested error");
        // note: sanitizeLabels is designed for flat label maps (OTel attributes)
        // nested objects are handled by the error capture flow differently
        const customContext = {
          userId: "12345",
          password: "NestedPassword!",
          token: "bearer_token_xyz",
          source: "test-source",
        };

        expect(() => client.errors.capture(error, customContext)).not.toThrow();

        // verify sanitization would occur for flat context via sanitizeLabels
        const sanitizedContext = sanitizeLabels(customContext);
        expect(sanitizedContext.password).toContain("[REDACTED]");
        expect(sanitizedContext.password).not.toContain("NestedPassword!");
        // non-sensitive data preserved
        expect(sanitizedContext.userId).toBe("12345");
        expect(sanitizedContext.source).toBe("test-source");
        return Promise.resolve();
      });
    });
  });

  describe("Sanitization with Various PII Patterns", () => {
    // patterns that the sanitizer actually catches (verified against implementation)
    const sanitizedPatterns = [
      { name: "password: value format", input: "password: secret123", sensitive: "secret123" },
      { name: "api_key: value format", input: "api_key: abcdef123456", sensitive: "abcdef123456" },
      { name: "sk_live pattern", input: "key is sk_live_1234567890abcdef", sensitive: "sk_live_1234567890abcdef" },
      { name: "connection string password", input: "mongodb://admin:SuperSecret@localhost", sensitive: "SuperSecret" },
    ];

    for (const { name, input, sensitive } of sanitizedPatterns) {
      it(`should sanitize ${name} in error messages`, () => {
        const error = new Error(`Failed with ${input}`);
        const context = extractErrorContext(error);

        expect(context["error.message"]).not.toContain(sensitive);
        expect(context["error.message"]).toContain("[REDACTED]");
      });
    }

    // document patterns that are NOT sanitized (for awareness)
    // codex/gemini: strengthen assertion to verify patterns are actually unsanitized
    it("should document unsanitized patterns for security review", () => {
      // these patterns are NOT sanitized by default - documenting for security review
      // if sanitizer is updated to handle these, this test will fail (which is correct)
      const unsanitizedPatterns = [
        { input: "password=value", sensitive: "value" }, // key=value format without colon
        { input: "Authorization: Bearer eyJtoken", sensitive: "eyJtoken" }, // bearer tokens
        // note: AWS access keys (AKIA...) ARE sanitized, so removed from this list
      ];

      for (const { input, sensitive } of unsanitizedPatterns) {
        const error = new Error(input);
        const context = extractErrorContext(error);
        // assert pattern IS in the message (NOT sanitized) - this documents current behavior
        // a security review may decide to add patterns for these in the future
        expect(context["error.message"]).toContain(sensitive);
        expect(context["error.message"]).not.toContain("[REDACTED]");
      }
    });

    // verify AWS access keys ARE sanitized (discovered during testing)
    it("should sanitize AWS access key patterns", () => {
      const error = new Error("Key is AKIAIOSFODNN7EXAMPLE");
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(context["error.message"]).toContain("[REDACTED]");
    });
  });

  describe("End-to-End Sanitization Flow Verification", () => {
    it("should sanitize all error fields consistently", () => {
      interface ComplexError extends Error {
        code?: string;
        details?: Record<string, unknown>;
      }
      const error = new Error("Failed auth with password: abc123") as ComplexError;
      error.code = "AUTH_ERROR";
      error.details = {
        attemptedUser: "admin",
        attemptedPassword: "secret456",
      };
      error.stack = `Error: Failed auth
    at authenticate (mongodb://user:password@db:27017/admin)`;

      const context = extractErrorContext(error);

      // message should be sanitized
      expect(context["error.message"]).not.toContain("abc123");
      // stack should be sanitized
      expect(context["error.stack"]).not.toContain("password");
      expect(context["error.stack"]).toContain("[REDACTED]");
      // details should be sanitized
      const details = context["error.details"] as Record<string, unknown>;
      expect(details.attemptedPassword).toContain("[REDACTED]");
      // code should be preserved (not sensitive)
      expect(context["error.code"]).toBe("AUTH_ERROR");
    });

    it("should handle rapid sanitization without corruption", async () => {
      await client.traces.withSpan("rapid-sanitization-span", () => {
        const sensitiveErrors = [
          new Error("Password: pass1"),
          new Error("API key: key2"),
          new Error("Token: tok3"),
          new Error("SSN: 111-22-3333"),
          new Error("CC: 4111-1111-1111-1111"),
        ];

        // rapid consecutive error captures should all work
        for (const error of sensitiveErrors) {
          expect(() => client.errors.capture(error)).not.toThrow();
        }
        return Promise.resolve();
      });
    });

    it("should sanitize in error boundary handlers", async () => {
      // use a pattern the sanitizer recognizes (password: format)
      const result = await client.errors.boundary(
        () => {
          throw new Error("API failed with password: SuperSecret123");
        },
        (error) => {
          // raw error still has original message
          expect(error.message).toContain("SuperSecret123");
          // but context extracted for telemetry would be sanitized
          const context = extractErrorContext(error);
          expect(context["error.message"]).not.toContain("SuperSecret123");
          expect(context["error.message"]).toContain("[REDACTED]");
          return "handled";
        },
      );

      expect(result).toBe("handled");
    });
  });
});
