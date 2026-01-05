/**
 * Error Sanitizer Configuration Tests
 *
 * API Boundary Fix - Issue #3: Make ERROR_SANITIZER configurable
 * Verifies that consumers can customize error sanitization behavior
 * instead of being forced to use hardcoded GDPR/Stripe patterns.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  configureErrorSanitizer,
  resetErrorSanitizer,
  extractErrorContext,
} from "../../smart-errors.mjs";

describe("Error Sanitizer Configuration (API Boundary Fix)", () => {
  // reset to default after each test
  afterEach(() => {
    resetErrorSanitizer();
  });

  describe("preset selection", () => {
    it("should use strict preset by default", () => {
      // strict preset includes GDPR and vendor patterns
      const error = new Error(
        "Failed with sk_live_abc123 and user@example.com",
      );
      const context = extractErrorContext(error);

      // stripe key should be redacted
      expect(context["error.message"]).not.toContain("sk_live_abc123");
      expect(context["error.message"]).toContain("[REDACTED]");

      // email should be redacted with strict preset
      expect(context["error.message"]).not.toContain("user@example.com");
    });

    it("should support minimal preset (only obvious secrets)", () => {
      configureErrorSanitizer("minimal");

      const error = new Error(
        "api_key=secret123 and user@example.com and 192.168.1.1",
      );
      const context = extractErrorContext(error);

      // api_key pattern should be redacted (matches api[_-]?key pattern)
      expect(context["error.message"]).not.toContain("secret123");
      expect(context["error.message"]).toContain("[REDACTED]");

      // email should NOT be redacted with minimal preset
      expect(context["error.message"]).toContain("user@example.com");

      // IP should NOT be redacted with minimal preset
      expect(context["error.message"]).toContain("192.168.1.1");
    });

    it("should support none preset (no sanitization)", () => {
      configureErrorSanitizer("none");

      const error = new Error(
        "sk_live_abc123 user@example.com 192.168.1.1",
      );
      const context = extractErrorContext(error);

      // nothing should be redacted
      expect(context["error.message"]).toContain("sk_live_abc123");
      expect(context["error.message"]).toContain("user@example.com");
      expect(context["error.message"]).toContain("192.168.1.1");
    });
  });

  describe("custom patterns", () => {
    it("should allow adding custom vendor patterns", () => {
      configureErrorSanitizer("minimal", {
        customPatterns: [
          // custom vendor key pattern
          { pattern: /my-vendor-key-\w+/gi, replacement: "[VENDOR_KEY]" },
        ],
      });

      const error = new Error("Failed with my-vendor-key-abc123xyz");
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("my-vendor-key-abc123xyz");
      expect(context["error.message"]).toContain("[VENDOR_KEY]");
    });

    it("should merge custom patterns with preset patterns", () => {
      configureErrorSanitizer("strict", {
        customPatterns: [
          // custom internal token pattern
          { pattern: /internal-token-\d+/gi, replacement: "[INTERNAL_TOKEN]" },
        ],
      });

      const error = new Error(
        "Failed with sk_live_abc123 and internal-token-12345",
      );
      const context = extractErrorContext(error);

      // stripe key (from strict preset) should be redacted
      expect(context["error.message"]).not.toContain("sk_live_abc123");

      // custom pattern should also be redacted
      expect(context["error.message"]).not.toContain("internal-token-12345");
      expect(context["error.message"]).toContain("[INTERNAL_TOKEN]");
    });
  });

  describe("password sanitization", () => {
    it("should sanitize passwords in connection strings (strict)", () => {
      const error = new Error(
        "Connection failed: mongodb://user:secretpassword@host:27017/db",
      );
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("secretpassword");
      expect(context["error.message"]).toContain("[REDACTED]");
    });

    it("should sanitize passwords in connection strings (minimal)", () => {
      configureErrorSanitizer("minimal");

      const error = new Error(
        "Connection failed: postgresql://user:mypassword@host:5432/db",
      );
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("mypassword");
    });

    it("should sanitize passwords in URL parameters", () => {
      const error = new Error(
        "Request failed: https://api.example.com?password=supersecret",
      );
      const context = extractErrorContext(error);

      expect(context["error.message"]).not.toContain("supersecret");
    });
  });

  describe("stack trace sanitization", () => {
    it("should sanitize sensitive data in stack traces", () => {
      const error = new Error("Error with sk_live_test123");
      // simulate stack with sensitive data
      error.stack = `Error: Error with sk_live_test123
        at Connection.connect (mongodb://user:password123@host/db)
        at API.call (https://api.com?apikey=secret)`;

      const context = extractErrorContext(error);

      // message sanitized
      expect(context["error.message"]).not.toContain("sk_live_test123");

      // stack sanitized
      expect(context["error.stack"]).not.toContain("password123");
      expect(context["error.stack"]).not.toContain("sk_live_test123");
    });
  });

  describe("error details sanitization", () => {
    it("should sanitize nested error details", () => {
      interface ExtendedError extends Error {
        details?: Record<string, unknown>;
      }
      const error: ExtendedError = new Error("Operation failed");
      error.details = {
        apiKey: "sk_live_abc123",
        config: {
          password: "secret",
          connectionString: "mongodb://user:pass@host/db",
        },
      };

      const context = extractErrorContext(error);

      // details should be sanitized
      const details = context["error.details"] as Record<string, unknown>;
      expect(details).toBeDefined();
      // api_key field should be redacted
      expect(JSON.stringify(details)).not.toContain("sk_live_abc123");
    });
  });

  describe("reset functionality", () => {
    it("should reset to strict preset defaults", () => {
      // change to none
      configureErrorSanitizer("none");

      const errorBefore = new Error("sk_live_abc123");
      const contextBefore = extractErrorContext(errorBefore);
      expect(contextBefore["error.message"]).toContain("sk_live_abc123");

      // reset
      resetErrorSanitizer();

      const errorAfter = new Error("sk_live_abc123");
      const contextAfter = extractErrorContext(errorAfter);
      expect(contextAfter["error.message"]).not.toContain("sk_live_abc123");
    });
  });

  describe("compliance scenarios", () => {
    it("should support GDPR-compliant strict mode", () => {
      // strict preset includes GDPR patterns
      const error = new Error(
        "User john@example.com from 192.168.1.1 failed",
      );
      const context = extractErrorContext(error);

      // email should be redacted (GDPR)
      expect(context["error.message"]).not.toContain("john@example.com");

      // note: strict error sanitizer also includes IP patterns via GDPR base
      // IP may or may not be redacted depending on GDPR preset config
    });

    it("should support minimal mode for internal tools", () => {
      configureErrorSanitizer("minimal");

      const error = new Error(
        "Debug: user@internal.corp from 10.0.0.1 with API_KEY=secret",
      );
      const context = extractErrorContext(error);

      // only obvious secrets redacted
      expect(context["error.message"]).not.toContain("secret");

      // email visible for debugging
      expect(context["error.message"]).toContain("user@internal.corp");

      // IP visible for debugging
      expect(context["error.message"]).toContain("10.0.0.1");
    });
  });

  describe("unified sanitizer architecture (Doc 4 C3 Fix)", () => {
    // NOTE: The true regression test for the sdk-factory merge path is in:
    // src/__tests__/node/integration/node-api-integration.test.mts
    // "C3 Fix: Unified Sanitizer Architecture" describe block
    // That test exercises SmartClient.create() with sanitizerOptions to verify
    // the merge logic in sdk-factory.mts works correctly.

    it("should accept custom patterns in configureErrorSanitizer", () => {
      // Unit test: verifies configureErrorSanitizer accepts custom patterns correctly
      // (this tests the sanitizer API, not the sdk-factory merge logic)
      const customOptions = {
        customPatterns: [
          { pattern: /MY_API_KEY_\w+/gi, replacement: "[MY_API_KEY_REDACTED]" },
        ],
      };

      configureErrorSanitizer("strict", customOptions);

      const error = new Error("Failed with MY_API_KEY_abc123xyz");
      const context = extractErrorContext(error);

      // the custom pattern should be applied
      expect(context["error.message"]).not.toContain("MY_API_KEY_abc123xyz");
      expect(context["error.message"]).toContain("[MY_API_KEY_REDACTED]");
    });

    it("should apply both sanitizerOptions and errorSanitizerOptions patterns", () => {
      // tests that custom patterns from BOTH sources are applied to errors
      const sanitizerOptions = {
        customPatterns: [
          { pattern: /TENANT_SECRET_\w+/gi, replacement: "[TENANT_REDACTED]" },
        ],
      };

      const errorSanitizerOptions = {
        customPatterns: [
          { pattern: /ERROR_SECRET_\w+/gi, replacement: "[ERROR_REDACTED]" },
        ],
      };

      // merged options (as sdk-factory does)
      const mergedOptions = {
        ...sanitizerOptions,
        ...errorSanitizerOptions,
        customPatterns: [
          ...(errorSanitizerOptions.customPatterns ?? []),
          ...(sanitizerOptions.customPatterns ?? []),
        ],
      };

      configureErrorSanitizer("strict", mergedOptions);

      const error = new Error(
        "Failed with TENANT_SECRET_abc123 and ERROR_SECRET_xyz789",
      );
      const context = extractErrorContext(error);

      // both patterns should be redacted (proving unified sanitizer)
      expect(context["error.message"]).not.toContain("TENANT_SECRET_abc123");
      expect(context["error.message"]).toContain("[TENANT_REDACTED]");
      expect(context["error.message"]).not.toContain("ERROR_SECRET_xyz789");
      expect(context["error.message"]).toContain("[ERROR_REDACTED]");
    });

    it("should preserve error-specific patterns when sanitizerOptions overlap", () => {
      // if both have the same field, errorSanitizerOptions should take precedence
      // for simple properties, but arrays should merge
      const sanitizerOptions = {
        redactionString: "[GENERAL_REDACTED]",
        customPatterns: [
          { pattern: /SHARED_SECRET_\w+/gi, replacement: "[FROM_SANITIZER]" },
        ],
      };

      const errorSanitizerOptions = {
        redactionString: "[ERROR_REDACTED]", // should override
        customPatterns: [
          {
            pattern: /SHARED_SECRET_\w+/gi,
            replacement: "[FROM_ERROR_SANITIZER]",
          },
        ],
      };

      // error-specific patterns should run first (to take precedence)
      const mergedOptions = {
        ...sanitizerOptions,
        ...errorSanitizerOptions,
        customPatterns: [
          ...(errorSanitizerOptions.customPatterns ?? []),
          ...(sanitizerOptions.customPatterns ?? []),
        ],
      };

      configureErrorSanitizer("none", mergedOptions);

      const error = new Error("Failed with SHARED_SECRET_abc123");
      const context = extractErrorContext(error);

      // error-specific pattern runs first and matches, so its replacement wins
      expect(context["error.message"]).not.toContain("SHARED_SECRET_abc123");
      expect(context["error.message"]).toContain("[FROM_ERROR_SANITIZER]");
    });
  });
});
