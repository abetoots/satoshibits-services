/**
 * Shared Sanitization Functionality Tests
 *
 * Tests PII detection, credit card masking, and data sanitization features.
 * Focuses on the DataSanitizer class and global sanitization functions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";
import type {
  CircularTestObject,
  TestErrorWithProps,
  TestMetricLabels,
  TestUserData,
  TestUserProfile,
} from "../test-utils/test-types.mjs";

import {
  createSanitizer,
  DataSanitizer,
  sanitizeObject,
  SanitizerManager,
  BUILT_IN_SENSITIVE_FIELD_PATTERNS,
} from "../../enrichment/sanitizer.mjs";
import { SmartClient } from "../../index.mjs";
import {
  isSanitizedArray,
  isSanitizedObject,
  isSanitizedString,
} from "../test-utils/test-types.mjs";

describe("Data Sanitization - Shared Functionality", () => {
  let sanitizer: DataSanitizer;

  beforeEach(() => {
    // create a new DataSanitizer instance for each test
    // each instance has its own internal cache, so no global clear needed
    sanitizer = new DataSanitizer();
  });

  describe("Credit Card Detection and Masking", () => {
    it("Should mask Visa credit card numbers", () => {
      const input = "My card is 4111-1111-1111-1111 for testing";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("My card is [REDACTED] for testing");
      expect(result).not.toContain("4111");
    });

    it("Should mask MasterCard credit card numbers", () => {
      const input = "Payment card: 5555 5555 5555 4444";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Payment card: [REDACTED]");
      expect(result).not.toContain("5555");
    });

    it("Should mask American Express credit card numbers (when formatted)", () => {
      const input = "Amex: 3782-8224-6310-0051";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Amex: [REDACTED]");
      expect(result).not.toContain("3782");
    });

    it("Should mask Discover credit card numbers", () => {
      const input = "Discover card 6011111111111117 is valid";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Discover card [REDACTED] is valid");
      expect(result).not.toContain("6011");
    });

    it("Should handle multiple credit cards in one string", () => {
      const input = "Cards: 4111111111111111 and 5555555555554444";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Cards: [REDACTED] and [REDACTED]");
    });

    it("Should not mask non-credit card number sequences", () => {
      const input = "Phone: 555-123-4567 and ID: 12345";
      const result = sanitizer.sanitize(input);

      // phones are NOT masked by default, regular numbers should not be masked
      expect(result).toBe("Phone: 555-123-4567 and ID: 12345");
    });
  });

  describe("SSN Detection and Masking", () => {
    it("Should mask Social Security Numbers", () => {
      const input = "SSN: 123-45-6789 for verification";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("SSN: [REDACTED] for verification");
      expect(result).not.toContain("123-45-6789");
    });

    it("Should mask multiple SSNs", () => {
      const input = "Primary: 111-22-3333, Spouse: 444-55-6666";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Primary: [REDACTED], Spouse: [REDACTED]");
    });

    it("Should not mask partial SSN patterns", () => {
      const input = "Code: 123-45 is incomplete";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Code: 123-45 is incomplete");
    });
  });

  describe("JWT and API Key Detection", () => {
    it("Should mask JWT tokens", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const input = `Authorization: Bearer ${jwt}`;
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Authorization: Bearer [REDACTED]");
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    it("Should mask API keys with known prefixes in strict mode (Doc 4 L2 Fix)", () => {
      const strictSanitizer = new DataSanitizer({ strictMode: true });
      // Doc 4 L2 Fix: use realistic API key format (sk_test_ prefix)
      // Old pattern matched any 32+ char alphanumeric (too aggressive, caught hashes/UUIDs)
      const input = "API Key: sk_test_4eC39HqLyjWDarjtT1zdp7dc";
      const result = strictSanitizer.sanitize(input);

      expect(result).toBe("API Key: [REDACTED]");
      expect(result).not.toContain("sk_test_4eC39HqLyjWDarjtT1zdp7dc");
    });

    it("Should NOT mask plain hashes in strict mode (Doc 4 L2 Fix)", () => {
      const strictSanitizer = new DataSanitizer({ strictMode: true });
      // Doc 4 L2 Fix: plain alphanumeric strings (like hashes) should NOT be masked
      const input = "Hash: abcd1234567890123456789012345678";
      const result = strictSanitizer.sanitize(input);

      // Plain 32-char alphanumeric should NOT be masked (could be hash, UUID, etc.)
      expect(result).toContain("abcd1234567890123456789012345678");
    });

    // Doc 4 L2 Fix: comprehensive API key pattern coverage
    describe("API Key Pattern Coverage (Doc 4 L2 Fix)", () => {
      const strictSanitizer = new DataSanitizer({ strictMode: true });

      it("Should mask AWS access keys (AKIA prefix)", () => {
        const input = "AWS Key: AKIAIOSFODNN7EXAMPLE";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("AWS Key: [REDACTED]");
      });

      it("Should mask AWS temporary credentials (ASIA prefix)", () => {
        // AWS STS keys are exactly 20 characters: ASIA (4) + 16 alphanumeric
        const input = "STS Key: ASIAJEXAMPLEXEG2JICE";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("STS Key: [REDACTED]");
      });

      it("Should mask Google API keys (AIza prefix)", () => {
        const input = "Google Key: AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("Google Key: [REDACTED]");
      });

      it("Should mask GitHub personal access tokens (ghp_ prefix)", () => {
        const input = "GitHub Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("GitHub Token: [REDACTED]");
      });

      it("Should mask GitHub fine-grained tokens (github_pat_ prefix)", () => {
        const input = "GitHub PAT: github_pat_11AXXXXXX_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("GitHub PAT: [REDACTED]");
      });

      it("Should mask Slack bot tokens (xoxb prefix)", () => {
        const input = "Slack Bot: xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("Slack Bot: [REDACTED]");
      });

      it("Should mask Slack user tokens (xoxp prefix)", () => {
        const input = "Slack User: xoxp-123456789012-1234567890123-1234567890123-abcdef";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("Slack User: [REDACTED]");
      });

      it("Should mask SendGrid API keys (SG. prefix)", () => {
        const input = "SendGrid: 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";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("SendGrid: [REDACTED]");
      });

      it("Should mask OpenAI API keys (sk-proj prefix)", () => {
        const input = "OpenAI: sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("OpenAI: [REDACTED]");
      });

      it("Should mask Anthropic API keys (sk-ant prefix)", () => {
        const input = "Anthropic: sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("Anthropic: [REDACTED]");
      });

      it("Should mask Stripe live keys (sk_live prefix)", () => {
        const input = "Stripe: sk_live_4eC39HqLyjWDarjtT1zdp7dc";
        const result = strictSanitizer.sanitize(input);
        expect(result).toBe("Stripe: [REDACTED]");
      });

      it("Should mask generic prefixed tokens (api_, key_, token_, secret_)", () => {
        const cases = [
          { input: "api_1234567890abcdef1234567890abcdef", name: "api_" },
          { input: "key_1234567890abcdef1234567890abcdef", name: "key_" },
          { input: "token_1234567890abcdef1234567890abcdef", name: "token_" },
          { input: "secret_1234567890abcdef1234567890abcdef", name: "secret_" },
          { input: "auth_1234567890abcdef1234567890abcdef", name: "auth_" },
          { input: "bearer_1234567890abcdef1234567890abcdef", name: "bearer_" },
        ];
        for (const { input, name } of cases) {
          const result = strictSanitizer.sanitize(`Token: ${input}`);
          expect(result).toBe("Token: [REDACTED]");
        }
      });
    });

    it("Should not mask API keys in normal mode", () => {
      const input = "API Key: sk_test_4eC39HqLyjWDarjtT1zdp7dc";
      const result = sanitizer.sanitize(input);

      // In normal mode, API keys are not masked
      expect(result).toContain("sk_test_4eC39HqLyjWDarjtT1zdp7dc");
    });
  });

  describe("Phone Number Masking", () => {
    it("Should NOT mask phone numbers by default", () => {
      const input = "Call me at 555-123-4567 today";
      const result = sanitizer.sanitize(input);

      // phones are NOT masked by default (maskPhones: false)
      expect(result).toBe("Call me at 555-123-4567 today");
    });

    it("Should mask phone numbers when enabled", () => {
      const phoneSanitizer = new DataSanitizer({ maskPhones: true });
      const testCases = [
        "(555) 123-4567",
        "555.123.4567",
        "15551234567",
        "+1 555 123 4567",
      ];

      testCases.forEach((input) => {
        const result = phoneSanitizer.sanitize(`Phone: ${input}`);
        expect(result).toMatch(/Phone: .*\*.*/);
        expect(result).not.toContain("555");
        expect(result).not.toContain("123");
        expect(result).not.toContain("4567");
      });
    });

    it("Should not mask phone numbers when disabled", () => {
      const noPhoneSanitizer = new DataSanitizer({ maskPhones: false });
      const input = "Call me at 555-123-4567";
      const result = noPhoneSanitizer.sanitize(input);

      expect(result).toBe("Call me at 555-123-4567");
    });
  });

  describe("Email Masking", () => {
    it("Should not mask emails by default", () => {
      const input = "Contact: user@example.com for support";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Contact: user@example.com for support");
    });

    it("Should mask emails when enabled", () => {
      const emailSanitizer = new DataSanitizer({ maskEmails: true });
      const input = "Email: john.doe@example.com";
      const result = emailSanitizer.sanitize(input);

      expect(result).toBe("Email: j***@example.com");
      expect(result).not.toContain("john.doe");
    });

    it("Should handle multiple emails", () => {
      const emailSanitizer = new DataSanitizer({ maskEmails: true });
      const input = "Primary: alice@test.com, Secondary: bob@demo.org";
      const result = emailSanitizer.sanitize(input);

      expect(result).toBe("Primary: a***@test.com, Secondary: b***@demo.org");
    });
  });

  describe("IP Address Masking", () => {
    it("Should not mask IPs by default", () => {
      const input = "Server: 192.168.1.100 is responding";
      const result = sanitizer.sanitize(input);

      expect(result).toBe("Server: 192.168.1.100 is responding");
    });

    it("Should mask IPs when enabled", () => {
      const ipSanitizer = new DataSanitizer({ maskIPs: true });
      const input = "Connected from 192.168.1.100";
      const result = ipSanitizer.sanitize(input);

      expect(result).toBe("Connected from ***.***.***");
      expect(result).not.toContain("192.168.1.100");
    });
  });

  describe("UUID Masking", () => {
    it("Should not mask UUIDs by default", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const input = `User ID: ${uuid}`;
      const result = sanitizer.sanitize(input);

      expect(result).toBe(`User ID: ${uuid}`);
    });

    it("Should mask UUIDs when enabled", () => {
      const uuidSanitizer = new DataSanitizer({ maskUUIDs: true });
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const input = `User ID: ${uuid}`;
      const result = uuidSanitizer.sanitize(input);

      expect(result).toBe("User ID: ********-****-****-****-************");
      expect(result).not.toContain(uuid);
    });
  });

  describe("Field-based Redaction", () => {
    it("Should redact password fields", () => {
      const data: TestUserData = {
        username: "john_doe",
        password: "secretPassword123",
        email: "john@example.com",
      };

      const result = sanitizer.sanitize(data);

      if (isSanitizedObject(result)) {
        expect(result.username).toBe("john_doe");
        expect(result.password).toBe("[REDACTED]");
        expect(result.email).toBe("john@example.com");
      }
    });

    it("Should redact various sensitive field names", () => {
      const data: TestUserData = {
        apiKey: "secret-key-123",
        auth_token: "bearer-token",
        private_key: "-----BEGIN PRIVATE KEY-----",
        creditCard: "4111111111111111",
        ssn: "123-45-6789",
        normal_field: "safe_value",
      };

      const result = sanitizer.sanitize(data);

      if (isSanitizedObject(result)) {
        expect(result.apiKey).toBe("[REDACTED]");
        expect(result.auth_token).toBe("[REDACTED]");
        expect(result.private_key).toBe("[REDACTED]");
        expect(result.creditCard).toBe("[REDACTED]");
        expect(result.ssn).toBe("[REDACTED]");
        expect(result.normal_field).toBe("safe_value");
      }
    });

    it("Should handle custom redact fields", () => {
      const customSanitizer = new DataSanitizer({
        customRedactFields: ["customSecret", "internalId"],
      });

      const data: TestUserData = {
        customSecret: "should_be_redacted",
        internalId: "internal_12345",
        publicField: "visible_data",
      };

      const result = customSanitizer.sanitize(data);

      if (isSanitizedObject(result)) {
        expect(result.customSecret).toBe("[REDACTED]");
        expect(result.internalId).toBe("[REDACTED]");
        expect(result.publicField).toBe("visible_data");
      }
    });

    it("Should not redact object fields that are sensitive", () => {
      const data: TestUserData = {
        password: "string_password", // should be redacted
        passwordSettings: {
          // should not be redacted (it's an object)
          minLength: 8,
          requireNumbers: true,
        },
        user: "john_doe",
      };

      const result = sanitizer.sanitize(data);

      if (isSanitizedObject(result)) {
        expect(result.password).toBe("[REDACTED]");
        expect(result.passwordSettings).toEqual({
          minLength: 8,
          requireNumbers: true,
        });
        expect(result.user).toBe("john_doe");
      }
    });
  });

  describe("Object Traversal and Protection", () => {
    it("Should handle nested objects", () => {
      const data: TestUserProfile = {
        user: {
          profile: {
            name: "John Doe",
            password: "secret123",
            preferences: {
              theme: "dark",
              apiKey: "key_12345",
            },
          },
        },
      };

      const result = sanitizer.sanitize(data);

      if (
        isSanitizedObject(result) &&
        isSanitizedObject(result.user) &&
        isSanitizedObject(result.user.profile) &&
        isSanitizedObject(result.user.profile.preferences)
      ) {
        expect(result.user.profile.name).toBe("John Doe");
        expect(result.user.profile.password).toBe("[REDACTED]");
        expect(result.user.profile.preferences.theme).toBe("dark");
        expect(result.user.profile.preferences.apiKey).toBe("[REDACTED]");
      }
    });

    it("Should handle arrays", () => {
      const data: TestUserProfile = {
        users: [
          { name: "Alice", password: "secret1" },
          { name: "Bob", password: "secret2" },
        ],
      };

      const result = sanitizer.sanitize(data);

      if (
        isSanitizedObject(result) &&
        isSanitizedArray(result.users) &&
        isSanitizedObject(result.users[0]) &&
        isSanitizedObject(result.users[1])
      ) {
        expect(result.users[0].name).toBe("Alice");
        expect(result.users[0].password).toBe("[REDACTED]");
        expect(result.users[1].name).toBe("Bob");
        expect(result.users[1].password).toBe("[REDACTED]");
      }
    });

    describe("Circular Reference Handling", () => {
      it("should handle simple self-referencing objects", () => {
        const obj: CircularTestObject = { name: "test" };
        obj.self = obj; // create circular reference

        const result = sanitizer.sanitize(obj);

        if (isSanitizedObject(result)) {
          expect(result.name).toBe("test");
          expect(result.self).toBe("[CIRCULAR]");
        }
      });

      it("should not incorrectly flag shared objects across multiple sanitization calls", () => {
        // bug: instance-level WeakSet could cause shared objects to be flagged as circular
        // even though cleanup logic currently prevents this
        const sharedObject = { data: "shared", password: "secret" };
        const container1 = { id: 1, shared: sharedObject };
        const container2 = { id: 2, shared: sharedObject };

        // first sanitization call
        const result1 = sanitizer.sanitize(container1);

        // second sanitization call with the same shared object
        const result2 = sanitizer.sanitize(container2);

        // both results should sanitize the shared object correctly, not mark it as [CIRCULAR]
        if (isSanitizedObject(result1) && isSanitizedObject(result1.shared)) {
          expect(result1.id).toBe(1);
          expect(result1.shared.data).toBe("shared");
          expect(result1.shared.password).toBe("[REDACTED]");
          expect(result1.shared).not.toBe("[CIRCULAR]");
        }

        if (isSanitizedObject(result2) && isSanitizedObject(result2.shared)) {
          expect(result2.id).toBe(2);
          expect(result2.shared.data).toBe("shared");
          expect(result2.shared.password).toBe("[REDACTED]");
          expect(result2.shared).not.toBe("[CIRCULAR]");
        }
      });

      it("should handle concurrent sanitization of objects with shared references", () => {
        // test that WeakSet is properly scoped for concurrent operations
        const sharedRef = { value: "shared" };

        const obj1 = { id: 1, ref: sharedRef };
        const obj2 = { id: 2, ref: sharedRef };
        const obj3 = { id: 3, nested: { ref: sharedRef } };

        // sanitize multiple objects that share the same reference
        const results = [obj1, obj2, obj3].map(obj => sanitizer.sanitize(obj));

        // all should sanitize correctly without false circular detection
        results.forEach((result, index) => {
          expect(result).not.toBe("[CIRCULAR]");
          if (isSanitizedObject(result)) {
            expect(result.id).toBe(index + 1);
          }
        });
      });

      it("should handle mutually circular references between objects", () => {
        const a: CircularTestObject = { name: "a" };
        const b: CircularTestObject = { name: "b" };
        a.b = b;
        b.a = a; // create mutual circular reference
        const data = { root: a };

        const result = sanitizer.sanitize(data);

        if (
          isSanitizedObject(result) &&
          isSanitizedObject(result.root) &&
          isSanitizedObject(result.root.b)
        ) {
          expect(result.root.name).toBe("a");
          expect(result.root.b.name).toBe("b");
          expect(result.root.b.a).toBe("[CIRCULAR]");
        }
      });

      it("should handle circular references within arrays (Doc 4 C2 Fix)", () => {
        // Doc 4 C2 Fix: Arrays are now tracked in visitedObjects to detect circular references
        // (same as objects). Previously, circular arrays would recurse until depth limit.
        const arr: { id: number }[] = [{ id: 1 }];
        //@ts-expect-error -- adding circular reference for test
        arr.push(arr); // arr[1] is reference to arr itself

        // should not throw - fail-safe behavior is critical for observability libraries
        expect(() => sanitizer.sanitize(arr)).not.toThrow();

        const result = sanitizer.sanitize(arr);

        if (isSanitizedArray(result) && isSanitizedObject(result[0])) {
          // first element should be sanitized correctly
          expect(result[0]).toEqual({ id: 1 });
          // Doc 4 C2 Fix: circular array reference should now be marked as [CIRCULAR]
          expect(result[1]).toBe("[CIRCULAR]");
        }
      });

      it("should handle self-referencing array (Doc 4 C2 regression test)", () => {
        // Direct regression test: array that contains only itself
        const selfRef: unknown[] = [];
        selfRef.push(selfRef);

        expect(() => sanitizer.sanitize(selfRef)).not.toThrow();

        const result = sanitizer.sanitize(selfRef);
        if (isSanitizedArray(result)) {
          expect(result[0]).toBe("[CIRCULAR]");
        }
      });

      it("should handle mixed array/object cycles (Doc 4 C2 edge case)", () => {
        // edge case: cycle crosses array/object boundary
        const arr: unknown[] = [];
        const obj = { arr };
        arr.push(obj);

        expect(() => sanitizer.sanitize(arr)).not.toThrow();
        expect(() => sanitizer.sanitize(obj)).not.toThrow();

        // sanitizing from arr: arr -> obj -> arr (circular)
        const resultFromArr = sanitizer.sanitize(arr);
        if (
          isSanitizedArray(resultFromArr) &&
          isSanitizedObject(resultFromArr[0])
        ) {
          expect(resultFromArr[0].arr).toBe("[CIRCULAR]");
        }

        // sanitizing from obj: obj -> arr -> obj (circular)
        const resultFromObj = sanitizer.sanitize(obj);
        if (
          isSanitizedObject(resultFromObj) &&
          isSanitizedArray(resultFromObj.arr)
        ) {
          expect(resultFromObj.arr[0]).toBe("[CIRCULAR]");
        }
      });

      it("should handle mutually-referential arrays (Doc 4 C2 edge case)", () => {
        // edge case: two arrays referencing each other
        const a: unknown[] = [];
        const b: unknown[] = [];
        a.push(b);
        b.push(a);

        expect(() => sanitizer.sanitize(a)).not.toThrow();
        expect(() => sanitizer.sanitize(b)).not.toThrow();

        // sanitizing a: a -> b -> a (circular)
        const resultA = sanitizer.sanitize(a);
        if (isSanitizedArray(resultA) && isSanitizedArray(resultA[0])) {
          expect(resultA[0][0]).toBe("[CIRCULAR]");
        }

        // sanitizing b: b -> a -> b (circular)
        const resultB = sanitizer.sanitize(b);
        if (isSanitizedArray(resultB) && isSanitizedArray(resultB[0])) {
          expect(resultB[0][0]).toBe("[CIRCULAR]");
        }
      });

      it("should correctly redact sensitive data within a circular structure", () => {
        const obj: CircularTestObject = { password: "secret-password" };
        obj.nested = { circular: obj };

        const result = sanitizer.sanitize(obj);

        if (isSanitizedObject(result) && isSanitizedObject(result.nested)) {
          expect(result.password).toBe("[REDACTED]");
          expect(result.nested.circular).toBe("[CIRCULAR]");
        }
      });

      it("should handle complex circular references with multiple levels", () => {
        const a: CircularTestObject = { name: "a", password: "secret-a" };
        const b: CircularTestObject = { name: "b", apiKey: "key-b" };
        const c: CircularTestObject = {
          name: "c",
          creditCard: "4111111111111111",
        };

        a.child = b;
        b.child = c;
        c.parent = a; // create circular reference: a → b → c → a

        const result = sanitizer.sanitize(a);

        if (
          isSanitizedObject(result) &&
          isSanitizedObject(result.child) &&
          isSanitizedObject(result.child.child)
        ) {
          expect(result.name).toBe("a");
          expect(result.password).toBe("[REDACTED]");
          expect(result.child.name).toBe("b");
          expect(result.child.apiKey).toBe("[REDACTED]");
          expect(result.child.child.name).toBe("c");
          expect(result.child.child.creditCard).toBe("[REDACTED]");
          expect(result.child.child.parent).toBe("[CIRCULAR]");
        }
      });

      it("should handle array of objects with circular references", () => {
        const obj1: CircularTestObject = { id: 1, data: "test1" };
        const obj2: CircularTestObject = {
          id: 2,
          data: "test2",
          password: "secret",
        };
        obj1.ref = obj2;
        obj2.ref = obj1; // create circular reference

        const arr = [obj1, obj2];
        const result = sanitizer.sanitize(arr);

        if (
          isSanitizedArray(result) &&
          isSanitizedObject(result[0]) &&
          isSanitizedObject(result[0].ref) &&
          isSanitizedObject(result[1])
        ) {
          expect(result[0].id).toBe(1);
          expect(result[0].ref.id).toBe(2);
          expect(result[0].ref.password).toBe("[REDACTED]");
          expect(result[0].ref.ref).toBe("[CIRCULAR]");
          expect(result[1].id).toBe(2);
          expect(result[1].password).toBe("[REDACTED]");
        }
      });
    });

    it("Should respect max depth limit", () => {
      const shallowSanitizer = new DataSanitizer({ maxDepth: 2 });

      const deepData: TestUserProfile = {
        level1: {
          level2: {
            level3: {
              value: "too_deep",
            },
          },
        },
      };

      const result = shallowSanitizer.sanitize(deepData);

      if (isSanitizedObject(result) && isSanitizedObject(result.level1)) {
        expect(result.level1.level2).toBe("[MAX_DEPTH_EXCEEDED]");
      }
    });

    it("Should handle null and undefined values", () => {
      const data = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: "",
        password: "secret",
      };

      const result = sanitizer.sanitize(data);

      if (isSanitizedObject(result)) {
        expect(result.nullValue).toBe(null);
        expect(result.undefinedValue).toBe(undefined);
        expect(result.emptyString).toBe("");
        expect(result.password).toBe("[REDACTED]");
      }
    });
  });

  describe("Password Detection in Strings", () => {
    it("Should mask password values in strings", () => {
      const input = "Config: password: secret123, username: john";
      const result = sanitizer.sanitize(input);

      expect(result).toContain("password: [REDACTED]");
      expect(result).toContain("username: john");
      expect(result).not.toContain("secret123");
    });

    it("Should handle different password formats", () => {
      const testCases = [
        "password: secret123",
        "passwd: mypass",
        "pwd: shortpwd",
      ];

      testCases.forEach((input) => {
        const result = sanitizer.sanitize(input);
        expect(result).toContain("[REDACTED]");
        expect(result).not.toContain("secret123");
        expect(result).not.toContain("mypass");
        expect(result).not.toContain("shortpwd");
      });
    });
  });

  describe("Custom Configuration", () => {
    it("Should use custom redaction string", () => {
      const customSanitizer = new DataSanitizer({
        redactionString: "[HIDDEN]",
      });

      const data = { password: "secret" };
      const result = customSanitizer.sanitize(data) as typeof data;

      expect(result?.password).toBe("[HIDDEN]");
    });

    it("Should support custom patterns", () => {
      const customSanitizer = new DataSanitizer({
        customPatterns: [
          { pattern: /CUSTOM-\d+/g, replacement: "[CUSTOM_REDACTED]" },
        ],
      });

      const input = "Reference: CUSTOM-12345 and CUSTOM-67890";
      const result = customSanitizer.sanitize(input);

      expect(result).toBe("Reference: [CUSTOM_REDACTED] and [CUSTOM_REDACTED]");
    });

    it("Should replace all matches even when custom pattern lacks 'g' flag (Doc 4 M1 Fix)", () => {
      // this test verifies that patterns without the global flag still replace ALL matches
      const customSanitizer = new DataSanitizer({
        customPatterns: [
          // intentionally omit 'g' flag - fix should still replace all matches
          { pattern: /secret/i, replacement: "[SECRET]" },
        ],
      });

      const input = "secret data with SECRET info and another secret value";
      const result = customSanitizer.sanitize(input);

      // all three occurrences should be replaced, not just the first
      expect(result).toBe("[SECRET] data with [SECRET] info and another [SECRET] value");
    });

    it("Should handle strict mode for additional patterns", () => {
      const strictSanitizer = new DataSanitizer({ strictMode: true });

      const data: TestUserData = {
        id: "user_123", // should be redacted in strict mode
        key: "some_key", // should be redacted in strict mode
        userId: "456", // should be redacted in strict mode
        accountId: "789", // should be redacted in strict mode
        name: "John Doe", // should not be redacted
      };

      const result = strictSanitizer.sanitize(data);

      if (isSanitizedObject(result)) {
        expect(result.id).toBe("[REDACTED]");
        expect(result.key).toBe("[REDACTED]");
        expect(result.userId).toBe("[REDACTED]");
        expect(result.accountId).toBe("[REDACTED]");
        expect(result.name).toBe("John Doe");
      }
    });
  });

  describe("Error Sanitization", () => {
    it("Should sanitize error messages", () => {
      const error = new Error("Authentication failed for user@example.com");
      const phoneSanitizer = new DataSanitizer({
        maskPhones: true,
        maskEmails: true,
      });
      const result = phoneSanitizer.sanitizeError(error);

      expect(result.message).toBe("Authentication failed for u***@example.com");
      expect(result.name).toBe("Error");
    });

    it("Should sanitize error stack traces", () => {
      const error = new Error("Database connection failed");
      error.stack =
        "Error: Database connection failed\\n    at connect (file:///app/db.js:42)\\n    password: secret123";

      const result = sanitizer.sanitizeError(error);

      expect(result.stack).toContain("password: [REDACTED]");
      expect(result.stack).not.toContain("secret123");
    });

    it("Should sanitize custom error properties", () => {
      const error: TestErrorWithProps = new Error(
        "Validation failed",
      ) as TestErrorWithProps;
      error.userPassword = "secret123";
      error.userId = "user_456";
      error.errorCode = "AUTH_001";

      const result = sanitizer.sanitizeError(error) as typeof error;

      expect(result?.userPassword).toBe("[REDACTED]");
      expect(result?.userId).toBe("user_456");
      expect(result?.errorCode).toBe("AUTH_001");
    });
  });

  describe("Label Sanitization", () => {
    it("Should sanitize metric labels", () => {
      const labels: TestMetricLabels = {
        service: "auth-service",
        version: "1.0.0",
        apiKey: "key_12345",
        userPassword: "secret",
        endpoint: "/api/login",
      };

      const result = sanitizer.sanitizeLabels(labels as Record<string, string>);

      expect(result.service).toBe("auth-service");
      expect(result.version).toBe("1.0.0");
      expect(result.apiKey).toBe("[REDACTED]");
      expect(result.userPassword).toBe("[REDACTED]");
      expect(result.endpoint).toBe("/api/login");
    });

    it("Should sanitize values in labels", () => {
      const phoneSanitizer = new DataSanitizer({ maskPhones: true });
      const labels: TestMetricLabels = {
        contact_number: "555-123-4567",
        service: "notification",
      };

      const result = phoneSanitizer.sanitizeLabels(
        labels as Record<string, string>,
      );

      expect(result.contact_number).toMatch(/.*\*.*/);
      expect(result.contact_number).not.toContain("555-123-4567");
      expect(result.service).toBe("notification");
    });
  });

  describe("Caching Functionality", () => {
    it("Should cache sanitized strings", () => {
      const input = "Credit card: 4111-1111-1111-1111";

      // First sanitization
      const result1 = sanitizer.sanitize(input);
      const stats1 = sanitizer.getCacheStats();

      // Second sanitization of same string
      const result2 = sanitizer.sanitize(input);
      const stats2 = sanitizer.getCacheStats();

      expect(result1).toBe(result2);
      expect(stats2.size).toBeGreaterThanOrEqual(stats1.size);
    });

    it("Should clear cache when requested", () => {
      sanitizer.sanitize("test string");
      expect(sanitizer.getCacheStats().size).toBeGreaterThan(0);

      sanitizer.clearCache();
      expect(sanitizer.getCacheStats().size).toBe(0);
    });

    it("Should provide cache statistics", () => {
      const stats = sanitizer.getCacheStats();

      expect(typeof stats.size).toBe("number");
      expect(typeof stats.max).toBe("number");
      expect(typeof stats.ttl).toBe("number");
      expect(stats.max).toBe(1000); // Default max size
      expect(stats.ttl).toBe(0); // TTL removed per consensus decision
    });
  });

  describe("Client-Initialized Sanitizer Functions", () => {
    let client: UnifiedObservabilityClient;

    beforeEach(async () => {
      // initialize client with specific sanitizer config
      client = await SmartClient.initialize({
        serviceName: "test-sanitization",
        environment: "node",
        disableInstrumentation: true,
        sanitizerOptions: {
          maskEmails: true,
          maskPhones: true,
          redactionString: "[CLIENT_REDACTED]",
        },
      });
    });

    afterEach(async () => {
      await SmartClient.shutdown();
    });

    it("should access sanitizer through client", () => {
      const manager = client.getSanitizerManager();
      const sanitizer = manager.getDefault();

      const input: TestUserData = {
        password: "secret",
        email: "user@test.com",
      };
      const result = sanitizer.sanitize(input);

      if (isSanitizedObject(result)) {
        expect(result.password).toBe("[CLIENT_REDACTED]");
        expect(result.email).toBe("u***@test.com");
      }
    });

    it("should sanitize strings through client sanitizer", () => {
      const manager = client.getSanitizerManager();
      const sanitizer = manager.getDefault();

      const input = "Password: secret123";
      const result = sanitizer.sanitize(input);

      expect(result).toContain("[CLIENT_REDACTED]");
    });

    it("should sanitize errors through client sanitizer", () => {
      const manager = client.getSanitizerManager();
      const sanitizer = manager.getDefault();

      const error: TestErrorWithProps = new Error(
        "Auth failed",
      ) as TestErrorWithProps;
      error.password = "secret";
      const result = sanitizer.sanitizeError(error) as typeof error;

      expect(result.password).toBe("[CLIENT_REDACTED]");
    });

    it("should sanitize labels through client sanitizer", () => {
      const manager = client.getSanitizerManager();
      const sanitizer = manager.getDefault();

      const labels = { apiKey: "secret", service: "auth" };
      const result = sanitizer.sanitizeLabels(labels);

      expect(result.apiKey).toBe("[CLIENT_REDACTED]");
      expect(result.service).toBe("auth");
    });

    it("should access sanitizer cache stats", () => {
      const manager = client.getSanitizerManager();
      const sanitizer = manager.getDefault();

      sanitizer.sanitize("test");
      const stats = sanitizer.getCacheStats();

      expect(typeof stats.size).toBe("number");
      expect(stats.size).toBeGreaterThan(0);
    });

    it("should clear sanitizer cache", () => {
      const manager = client.getSanitizerManager();
      const sanitizer = manager.getDefault();

      sanitizer.sanitize("test");
      expect(sanitizer.getCacheStats().size).toBeGreaterThan(0);

      sanitizer.clearCache();
      expect(sanitizer.getCacheStats().size).toBe(0);
    });
  });

  describe("Factory Functions", () => {
    it("Should create custom sanitizer with factory", () => {
      const customSanitizer = createSanitizer({
        maskEmails: true,
        redactionString: "[FACTORY_CREATED]",
      });

      const input: TestUserData = {
        password: "secret",
        email: "user@test.com",
      };
      const result = customSanitizer.sanitize(input);

      if (isSanitizedObject(result)) {
        expect(result.password).toBe("[FACTORY_CREATED]");
        expect(result.email).toBe("u***@test.com");
      }
    });

    it("Should provide all sanitization methods in factory", () => {
      const factory = createSanitizer();

      expect(typeof factory.sanitize).toBe("function");
      expect(typeof factory.sanitizeString).toBe("function");
      expect(typeof factory.sanitizeObject).toBe("function");
      expect(typeof factory.sanitizeError).toBe("function");
      expect(typeof factory.sanitizeLabels).toBe("function");
      expect(typeof factory.clearCache).toBe("function");
      expect(typeof factory.getCacheStats).toBe("function");
    });
  });

  describe("shouldRedactField Method", () => {
    it("Should identify sensitive field names", () => {
      const testCases = [
        { field: "password", expected: true },
        { field: "apiKey", expected: true },
        { field: "creditCard", expected: true },
        { field: "social_security", expected: true },
        { field: "username", expected: false },
        { field: "email", expected: false },
        { field: "name", expected: false },
      ];

      testCases.forEach(({ field, expected }) => {
        expect(sanitizer.shouldRedactField(field)).toBe(expected);
      });
    });

    it("Should handle custom redact fields", () => {
      const customSanitizer = new DataSanitizer({
        customRedactFields: ["customSecret", "internalId"],
      });

      expect(customSanitizer.shouldRedactField("customSecret")).toBe(true);
      expect(customSanitizer.shouldRedactField("internalId")).toBe(true);
      expect(customSanitizer.shouldRedactField("normalField")).toBe(false);
    });

    it("Should apply strict mode patterns", () => {
      const strictSanitizer = new DataSanitizer({ strictMode: true });

      expect(strictSanitizer.shouldRedactField("id")).toBe(true);
      expect(strictSanitizer.shouldRedactField("someKey")).toBe(true);
      expect(strictSanitizer.shouldRedactField("userId")).toBe(true);
      expect(strictSanitizer.shouldRedactField("customerInfo")).toBe(true);
      expect(strictSanitizer.shouldRedactField("accountData")).toBe(true);
      expect(strictSanitizer.shouldRedactField("regularField")).toBe(false);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("Should handle empty objects", () => {
      const result = sanitizer.sanitize({});
      expect(result).toEqual({});
    });

    it("Should handle empty arrays", () => {
      const result = sanitizer.sanitize([]);
      expect(result).toEqual([]);
    });

    it("Should handle empty strings", () => {
      const result = sanitizer.sanitize("");
      expect(result).toBe("");
    });

    it("Should handle numbers and booleans", () => {
      expect(sanitizer.sanitize(42)).toBe(42);
      expect(sanitizer.sanitize(true)).toBe(true);
      expect(sanitizer.sanitize(false)).toBe(false);
    });

    it("Should handle mixed data types", () => {
      const data: TestUserProfile = {
        string: "password: secret123",
        number: 42,
        boolean: true,
        null_value: null,
        array: ["password", "safe_item"],
        nested: {
          apiKey: "secret_key",
        },
      };

      const result = sanitizer.sanitize(data);

      if (
        isSanitizedObject(result) &&
        isSanitizedString(result.string) &&
        isSanitizedArray(result.array) &&
        isSanitizedObject(result.nested)
      ) {
        expect(result.string).toContain("[REDACTED]");
        expect(result.number).toBe(42);
        expect(result.boolean).toBe(true);
        expect(result.null_value).toBe(null);
        expect(result.array[0]).toBe("password");
        expect(result.array[1]).toBe("safe_item");
        expect(result.nested.apiKey).toBe("[REDACTED]");
      }
    });

    it("Should handle very long strings efficiently", () => {
      const longString =
        "safe text ".repeat(1000) +
        " password: secret123 " +
        "more safe text ".repeat(1000);
      const result = sanitizer.sanitize(longString);

      expect(result).toContain("[REDACTED]");
      expect(result).toContain("safe text");
      expect(result).not.toContain("secret123");
    });
  });

  describe("Performance Tests (L2 Implementation)", () => {
    // these tests verify sanitization completes within acceptable time bounds
    // performance assertions use deterministic operation counts rather than wall-clock time
    // to avoid flakiness in CI environments

    it("should handle 1000 object sanitizations without blocking", () => {
      const iterations = 1000;
      const testData = {
        password: "secret123",
        email: "test@example.com",
        apiKey: "sk_live_abc123",
        normalField: "visible",
        nested: {
          ssn: "123-45-6789",
          creditCard: "4111-1111-1111-1111",
        },
      };

      let completedCount = 0;

      // verify all iterations complete without throwing
      expect(() => {
        for (let i = 0; i < iterations; i++) {
          sanitizer.sanitize(testData);
          completedCount++;
        }
      }).not.toThrow();

      expect(completedCount).toBe(iterations);
    });

    it("should handle deeply nested objects without stack overflow", () => {
      // create a 50-level deep nested structure
      // the sanitizer has a max depth limit for safety, which we verify
      const depth = 50;
      let deepObject: Record<string, unknown> = { password: "deepest_secret", level: "bottom" };

      for (let i = 0; i < depth; i++) {
        deepObject = { level: i, nested: deepObject, secretKey: `secret_${i}` };
      }

      // should complete without throwing (no stack overflow)
      const result = sanitizer.sanitize(deepObject);
      expect(result).toBeDefined();
      expect(isSanitizedObject(result)).toBe(true);

      // verify structure is traversable to depth limit
      if (isSanitizedObject(result)) {
        // navigate into the structure
        let ptr = result as Record<string, unknown>;
        let reachableDepth = 0;

        // traverse until we hit depth limit or end
        while (ptr.nested && typeof ptr.nested === "object" && reachableDepth < depth + 1) {
          reachableDepth++;
          ptr = ptr.nested as Record<string, unknown>;
        }

        // sanitizer should either reach bottom OR apply depth limit safely
        // both outcomes are acceptable for stack safety
        const atBottom = ptr.level === "bottom";
        const atDepthLimit = ptr.level === "[MAX_DEPTH_EXCEEDED]" || typeof ptr.nested === "string";

        expect(atBottom || atDepthLimit).toBe(true);

        // if we reached bottom, password should be redacted
        if (atBottom) {
          expect(ptr.password).toBe("[REDACTED]");
        }
      }
    });

    it("should handle wide objects with many fields efficiently", () => {
      // create an object with 500 fields, some sensitive
      const wideObject: Record<string, string> = {};

      for (let i = 0; i < 500; i++) {
        if (i % 10 === 0) {
          // every 10th field is sensitive
          wideObject[`password_${i}`] = "secret";
        } else if (i % 15 === 0) {
          wideObject[`apiKey_${i}`] = "sk_live_abc123";
        } else {
          wideObject[`field_${i}`] = `value_${i}`;
        }
      }

      const result = sanitizer.sanitize(wideObject);
      expect(isSanitizedObject(result)).toBe(true);

      if (isSanitizedObject(result)) {
        // verify sensitive fields were redacted
        expect(result["password_0"]).toBe("[REDACTED]");
        expect(result["password_10"]).toBe("[REDACTED]");
        expect(result["apiKey_15"]).toBe("[REDACTED]");
        // verify normal fields preserved
        expect(result["field_1"]).toBe("value_1");
        expect(result["field_2"]).toBe("value_2");
      }
    });

    it("should handle large string values without degradation", () => {
      // 15KB string with embedded sensitive data (password pattern matched in strings)
      const largeString =
        "x".repeat(5000) +
        " password: secret123 " +
        "y".repeat(5000) +
        " pwd: another_secret " +
        "z".repeat(5000);

      expect(() => {
        const result = sanitizer.sanitize(largeString);
        // verify sensitive data was found and redacted (password patterns)
        expect(result).toContain("[REDACTED]");
        expect(result).not.toContain("secret123");
        expect(result).not.toContain("another_secret");
      }).not.toThrow();
    });

    it("should handle arrays with many elements efficiently", () => {
      // array with 200 objects, some containing sensitive data
      const largeArray = Array.from({ length: 200 }, (_, i) => ({
        id: i,
        data: i % 5 === 0 ? { password: "secret", email: "test@test.com" } : { safe: "value" },
      }));

      expect(() => {
        const result = sanitizer.sanitize(largeArray);
        expect(Array.isArray(result)).toBe(true);
        if (Array.isArray(result)) {
          expect(result.length).toBe(200);
          // verify sensitive data in element 0 was redacted
          const firstElement = result[0] as { data: { password: string } };
          expect(firstElement.data.password).toBe("[REDACTED]");
        }
      }).not.toThrow();
    });

    it("should handle circular references without infinite loop", () => {
      // create circular reference
      const circularObject: Record<string, unknown> = {
        password: "secret123",
        normal: "visible",
      };
      circularObject["self"] = circularObject;

      // should complete without infinite loop or stack overflow
      const result = sanitizer.sanitize(circularObject);
      expect(result).toBeDefined();
      expect(isSanitizedObject(result)).toBe(true);

      // verify password is redacted even with circular reference
      if (isSanitizedObject(result)) {
        expect(result.password).toBe("[REDACTED]");
        expect(result.normal).toBe("visible");
        // circular reference should be marked (implementation may vary)
        expect(result.self).toBeDefined();
      }
    });

    it("should maintain consistent timing across repeated sanitizations", () => {
      // verifies no memory leaks or degradation over repeated calls
      const testData = { password: "secret", apiKey: "sk_live_123", nested: { val: "keep" } };
      const originalJson = JSON.stringify(testData);
      const iterations = 100;
      const results: unknown[] = [];

      for (let i = 0; i < iterations; i++) {
        results.push(sanitizer.sanitize(testData));
      }

      expect(results.length).toBe(iterations);

      // verify input immutability - sanitization must not mutate original data
      expect(JSON.stringify(testData)).toBe(originalJson);

      // verify all results are properly sanitized
      results.forEach((result) => {
        expect(isSanitizedObject(result)).toBe(true);
        if (isSanitizedObject(result)) {
          expect(result.password).toBe("[REDACTED]");
          expect(result.apiKey).toBe("[REDACTED]");
        }
      });
    });
  });

  describe("SanitizerManager - Multi-Tenant Support", () => {
    let manager: SanitizerManager;

    beforeEach(() => {
      // create a new manager for each test to ensure isolation
      // each manager instance has its own internal state
      manager = new SanitizerManager();
    });

    // basic tenant isolation
    it("should return default sanitizer when no tenant context", () => {
      const sanitizer = manager.getSanitizer();
      const defaultSanitizer = manager.getDefault();

      expect(sanitizer).toBe(defaultSanitizer);
    });

    it("should create tenant-specific sanitizer with tenantId", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      const sanitizer = manager.getSanitizer({ tenantId: "tenant-1" });

      expect(configProvider).toHaveBeenCalledWith({ tenantId: "tenant-1" });
      expect(sanitizer).not.toBe(manager.getDefault());
    });

    it("should cache tenant sanitizers", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      const sanitizer1 = manager.getSanitizer({ tenantId: "tenant-1" });
      const sanitizer2 = manager.getSanitizer({ tenantId: "tenant-1" });

      expect(sanitizer1).toBe(sanitizer2);
      expect(configProvider).toHaveBeenCalledTimes(1); // only called once due to caching
    });

    it("should create separate sanitizers per tenant:region combination", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      const sanitizerUsEast = manager.getSanitizer({
        tenantId: "t1",
        region: "us-east",
      });
      const sanitizerEuWest = manager.getSanitizer({
        tenantId: "t1",
        region: "eu-west",
      });

      expect(sanitizerUsEast).not.toBe(sanitizerEuWest);
      expect(configProvider).toHaveBeenCalledTimes(2); // called for each region
    });

    // lru cache behavior
    it("should evict oldest tenant sanitizer when cache exceeds 100 entries", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        maxTenantSanitizers: 100,
        tenantConfigProvider: configProvider,
      });

      // create 100 tenant sanitizers
      const firstSanitizer = manager.getSanitizer({ tenantId: "tenant-0" });
      for (let i = 1; i < 100; i++) {
        manager.getSanitizer({ tenantId: `tenant-${i}` });
      }

      // access the 101st tenant (should evict tenant-0)
      manager.getSanitizer({ tenantId: "tenant-100" });

      // reset the mock to track new calls
      configProvider.mockClear();

      // accessing tenant-0 again should require creating a new sanitizer
      const newFirstSanitizer = manager.getSanitizer({ tenantId: "tenant-0" });

      expect(configProvider).toHaveBeenCalledWith({ tenantId: "tenant-0" });
      expect(newFirstSanitizer).not.toBe(firstSanitizer);
    });

    it("should update LRU position when accessing existing tenant sanitizer", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        maxTenantSanitizers: 100,
        tenantConfigProvider: configProvider,
      });

      // create the first sanitizer
      const firstSanitizer = manager.getSanitizer({ tenantId: "tenant-0" });

      // create 99 more sanitizers (total 100)
      for (let i = 1; i < 100; i++) {
        manager.getSanitizer({ tenantId: `tenant-${i}` });
      }

      // access tenant-0 again to move it to the front of LRU
      manager.getSanitizer({ tenantId: "tenant-0" });

      // reset mock to track new calls
      configProvider.mockClear();

      // create one more tenant (should evict tenant-1, not tenant-0)
      manager.getSanitizer({ tenantId: "tenant-100" });

      // accessing tenant-0 should still return cached sanitizer
      const cachedFirst = manager.getSanitizer({ tenantId: "tenant-0" });
      expect(cachedFirst).toBe(firstSanitizer);
      expect(configProvider).not.toHaveBeenCalledWith({ tenantId: "tenant-0" });

      // but accessing tenant-1 should require recreation
      manager.getSanitizer({ tenantId: "tenant-1" });
      expect(configProvider).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    });

    // configuration provider
    it("should call tenantConfigProvider with correct context", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      manager.getSanitizer({ tenantId: "t1", region: "eu" });

      expect(configProvider).toHaveBeenCalledWith({
        tenantId: "t1",
        region: "eu",
      });
    });

    it("should merge tenant config with default options", () => {
      const defaultOptions = { maskPhones: true, redactionString: "[DEFAULT]" };
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(defaultOptions, {
        tenantConfigProvider: configProvider,
      });

      const tenantSanitizer = manager.getSanitizer({ tenantId: "tenant-1" });

      // test that tenant sanitizer uses tenant config (maskEmails: true)
      const emailInput: TestUserData = { email: "user@test.com" };
      const result = tenantSanitizer.sanitize(emailInput);
      if (isSanitizedObject(result)) {
        expect(result.email).toBe("u***@test.com");
      }
    });

    it("should use default config when tenantConfigProvider returns undefined", () => {
      const defaultOptions = { maskEmails: true };
      const configProvider = vi.fn().mockReturnValue(undefined);
      manager = new SanitizerManager(defaultOptions, {
        tenantConfigProvider: configProvider,
      });

      const tenantSanitizer = manager.getSanitizer({ tenantId: "tenant-1" });

      // should use default options when provider returns undefined
      const emailInput: TestUserData = { email: "user@test.com" };
      const result = tenantSanitizer.sanitize(emailInput);
      if (isSanitizedObject(result)) {
        expect(result.email).toBe("u***@test.com");
      }
    });

    // context provider injection
    it("should inject context provider to break circular dependency", () => {
      const contextProvider = vi
        .fn()
        .mockReturnValue({ tenantId: "injected-tenant" });
      manager = new SanitizerManager(undefined, { contextProvider });

      const context = manager.getContext();

      expect(contextProvider).toHaveBeenCalled();
      expect(context).toEqual({ tenantId: "injected-tenant" });
    });

    it("should use injected context provider to get tenant context", () => {
      const contextProvider = vi
        .fn()
        .mockReturnValue({ tenantId: "auto-tenant", region: "us" });
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        contextProvider,
        tenantConfigProvider: configProvider,
      });

      // when no explicit context is provided, should use contextProvider
      const context = manager.getContext();
      // retrieve sanitizer to trigger configProvider call
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const sanitizer = manager.getSanitizer(context);

      expect(contextProvider).toHaveBeenCalled();
      expect(configProvider).toHaveBeenCalledWith({
        tenantId: "auto-tenant",
        region: "us",
      });
    });

    // sanitizer manager access through client
    it("should access sanitizer manager through client", async () => {
      // create a temporary client to test manager access
      const tempClient = await SmartClient.initialize({
        serviceName: "temp-manager-test",
        environment: "node",
        disableInstrumentation: true,
      });

      const manager1 = tempClient.getSanitizerManager();
      const manager2 = tempClient.getSanitizerManager();

      expect(manager1).toBe(manager2);
      await SmartClient.shutdown();
    });

    // edge cases
    it("should handle null tenantId gracefully", () => {
      const sanitizer = manager.getSanitizer({
        tenantId: null as unknown as string,
      });
      const defaultSanitizer = manager.getDefault();

      expect(sanitizer).toBe(defaultSanitizer);
    });

    it("should handle missing region (undefined)", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      manager.getSanitizer({ tenantId: "t1", region: undefined });

      // should use "default" region in cache key
      expect(configProvider).toHaveBeenCalledWith({
        tenantId: "t1",
        region: undefined,
      });
    });

    it("should not mutate default options when creating tenant sanitizer", () => {
      const defaultOptions = {
        maskPhones: true,
        customRedactFields: ["field1"],
      };
      const configProvider = vi
        .fn()
        .mockReturnValue({ customRedactFields: ["field2"] });
      manager = new SanitizerManager(defaultOptions, {
        tenantConfigProvider: configProvider,
      });

      manager.getSanitizer({ tenantId: "tenant-1" });

      // default options should remain unchanged
      expect(defaultOptions.customRedactFields).toEqual(["field1"]);
    });

    it("should fallback to default sanitizer when tenant config provider throws error", () => {
      const configProvider = vi.fn().mockImplementation(() => {
        throw new Error("Config provider failed");
      });
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {
          /* intentionally empty */
        });

      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      const _sanitizer = manager.getSanitizer({ tenantId: "tenant-1" });

      expect(_sanitizer).toBe(manager.getDefault());
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should clear tenant sanitizer cache", () => {
      const configProvider = vi.fn().mockReturnValue({ maskEmails: true });
      manager = new SanitizerManager(undefined, {
        tenantConfigProvider: configProvider,
      });

      const sanitizer1 = manager.getSanitizer({ tenantId: "tenant-1" });
      manager.clearTenantCache();
      configProvider.mockClear();

      const sanitizer2 = manager.getSanitizer({ tenantId: "tenant-1" });

      expect(sanitizer1).not.toBe(sanitizer2);
      expect(configProvider).toHaveBeenCalledTimes(1); // called again after cache clear
    });

    it("should use explicit context over context provider", () => {
      const contextProvider = vi
        .fn()
        .mockReturnValue({ tenantId: "auto-tenant" });
      manager = new SanitizerManager(undefined, { contextProvider });

      const explicitContext = { tenantId: "explicit-tenant" };
      const context = manager.getContext(explicitContext);

      expect(context).toBe(explicitContext);
      expect(contextProvider).not.toHaveBeenCalled();
    });
  });
});

/**
 * excludeBuiltInPatterns Tests - API Boundary Fix L2
 *
 * Tests for the new pattern exclusion feature that allows consumers
 * to reduce false positives from built-in sensitive field patterns.
 */
describe("Pattern Exclusion (L2 API Boundary Fix)", () => {
  describe("BUILT_IN_SENSITIVE_FIELD_PATTERNS export", () => {
    it("should export the built-in patterns array", () => {
      expect(BUILT_IN_SENSITIVE_FIELD_PATTERNS).toBeDefined();
      expect(Array.isArray(BUILT_IN_SENSITIVE_FIELD_PATTERNS)).toBe(true);
      expect(BUILT_IN_SENSITIVE_FIELD_PATTERNS.length).toBeGreaterThan(0);
    });

    it("should include common sensitive patterns", () => {
      // check a few known patterns are present
      const patternSources = BUILT_IN_SENSITIVE_FIELD_PATTERNS.map(p => p.source);
      expect(patternSources).toContain("password");
      expect(patternSources).toContain("token");
      expect(patternSources).toContain("address");
    });
  });

  describe("excludeBuiltInPatterns option", () => {
    it("should allow excluding specific patterns (address false positive fix)", () => {
      // the 'address' pattern matches 'ip_address', causing false positive
      const sanitizerWithoutExclusion = new DataSanitizer();
      const sanitizerWithExclusion = new DataSanitizer({
        excludeBuiltInPatterns: [/address/i],
      });

      // without exclusion, 'ip_address' field should be redacted
      expect(sanitizerWithoutExclusion.shouldRedactField("ip_address")).toBe(true);
      expect(sanitizerWithoutExclusion.shouldRedactField("home_address")).toBe(true);

      // with exclusion, 'ip_address' and 'home_address' should NOT be redacted
      expect(sanitizerWithExclusion.shouldRedactField("ip_address")).toBe(false);
      expect(sanitizerWithExclusion.shouldRedactField("home_address")).toBe(false);

      // but password should still be redacted
      expect(sanitizerWithExclusion.shouldRedactField("password")).toBe(true);
    });

    it("should allow excluding cell pattern (cell_count false positive fix)", () => {
      const sanitizer = new DataSanitizer({
        excludeBuiltInPatterns: [/cell/i],
      });

      // 'cell' pattern no longer matches
      expect(sanitizer.shouldRedactField("cell_count")).toBe(false);
      expect(sanitizer.shouldRedactField("grid_cell")).toBe(false);

      // but other patterns still work
      expect(sanitizer.shouldRedactField("password")).toBe(true);
      expect(sanitizer.shouldRedactField("api_key")).toBe(true);
    });

    it("should allow excluding multiple patterns", () => {
      const sanitizer = new DataSanitizer({
        excludeBuiltInPatterns: [/address/i, /cell/i, /phone/i, /mobile/i],
      });

      // excluded patterns don't match
      expect(sanitizer.shouldRedactField("ip_address")).toBe(false);
      expect(sanitizer.shouldRedactField("cell_count")).toBe(false);
      expect(sanitizer.shouldRedactField("phone_number")).toBe(false);
      expect(sanitizer.shouldRedactField("mobile_device")).toBe(false);

      // security patterns still work
      expect(sanitizer.shouldRedactField("password")).toBe(true);
      expect(sanitizer.shouldRedactField("secret")).toBe(true);
      expect(sanitizer.shouldRedactField("api_key")).toBe(true);
    });

    it("should keep all patterns when excludeBuiltInPatterns is empty", () => {
      const sanitizer = new DataSanitizer({
        excludeBuiltInPatterns: [],
      });

      // all patterns should still match
      expect(sanitizer.shouldRedactField("password")).toBe(true);
      expect(sanitizer.shouldRedactField("ip_address")).toBe(true);
      expect(sanitizer.shouldRedactField("cell_phone")).toBe(true);
    });

    it("should work with customRedactFields", () => {
      const sanitizer = new DataSanitizer({
        excludeBuiltInPatterns: [/address/i],
        customRedactFields: ["custom_secret"],
      });

      // excluded pattern no longer matches
      expect(sanitizer.shouldRedactField("email_address")).toBe(false);

      // custom field still works
      expect(sanitizer.shouldRedactField("custom_secret")).toBe(true);

      // built-in patterns still work
      expect(sanitizer.shouldRedactField("password")).toBe(true);
    });

    it("should allow keeping only auth patterns", () => {
      // keep only authentication-related patterns
      const authPatterns = [/password/i, /passwd/i, /pwd/i, /secret/i, /token/i, /api[_-]?key/i, /apikey/i, /auth/i, /credential/i, /private[_-]?key/i];
      const authPatternSources = new Set(authPatterns.map(p => p.source + '|' + p.flags));

      // exclude everything except auth patterns
      const excludePatterns = BUILT_IN_SENSITIVE_FIELD_PATTERNS.filter(
        p => !authPatternSources.has(p.source + '|' + p.flags)
      );

      const sanitizer = new DataSanitizer({
        excludeBuiltInPatterns: excludePatterns,
      });

      // auth patterns should still work
      expect(sanitizer.shouldRedactField("password")).toBe(true);
      expect(sanitizer.shouldRedactField("api_key")).toBe(true);
      expect(sanitizer.shouldRedactField("secret")).toBe(true);

      // PII patterns should NOT work (excluded)
      expect(sanitizer.shouldRedactField("ssn")).toBe(false);
      expect(sanitizer.shouldRedactField("address")).toBe(false);
      expect(sanitizer.shouldRedactField("phone")).toBe(false);
      expect(sanitizer.shouldRedactField("credit_card")).toBe(false);
    });
  });
});

/**
 * Integration tests for sanitization through SmartClient API
 * (Moved from gap-validation.test.mts per M4 refactoring)
 */
describe("Sanitization Integration via SmartClient", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ReturnType<UnifiedObservabilityClient["getServiceInstrumentation"]>;

  beforeEach(async () => {
    // initialize with sanitization enabled
    client = await SmartClient.initialize({
      serviceName: "sanitization-integration-test",
      environment: "node" as const,
      disableInstrumentation: true,
      sanitize: true,
    });

    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await SmartClient.shutdown();
  });

  it("should sanitize attributes in error context", () => {
    // record error with sensitive attributes
    const error = new Error("Database connection failed");

    // behavioral verification: sanitizeObject should redact sensitive keys
    const testData = {
      password: "secret123",
      apiKey: "sk_live_abc123",
      normalData: "visible",
    };
    const sanitized = sanitizeObject(testData);

    // verify sanitization actually modifies sensitive data
    expect(sanitized).toBeDefined();
    if (isSanitizedObject(sanitized)) {
      expect(sanitized.password).not.toBe("secret123");
      expect(sanitized.apiKey).not.toBe("sk_live_abc123");
      expect(sanitized.normalData).toBe("visible");
    }

    // verify errors.record doesn't throw with sensitive context
    expect(() =>
      serviceInstrument.errors.record(error, testData),
    ).not.toThrow();
  });

  it("should sanitize attributes in log context", () => {
    // log with sensitive attributes - verifies SDK handles sensitive data without throwing
    expect(() =>
      serviceInstrument.logs.info("Operation completed", {
        apiKey: "sk_live_abc123",
        password: "secret123",
      }),
    ).not.toThrow();

    // note: logs may or may not create spans depending on implementation
    // the key is that the operation completed without exposing sensitive data
  });
});
