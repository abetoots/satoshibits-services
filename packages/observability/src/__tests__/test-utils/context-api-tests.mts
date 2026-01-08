/**
 * Shared Context API Conformance Tests
 *
 * These tests verify the public Context API contract which must be identical
 * across browser and node environments. They ensure consistent behavior of:
 * - Business context management
 * - Trace context access
 * - Combined context API
 *
 * Why this file exists:
 * - Nearly identical Context API tests are duplicated across platform test files
 * - This is "essential duplication" - the same API contract verified repeatedly
 * - Refactoring accepted by Gemini 2.5 Pro review (see REFACTORING-ADVISOR-SYNTHESIS.md)
 *
 * Benefits:
 * - DRY: Common API contract tested from single source
 * - Conformance Suite: Ensures API behaves identically across platforms
 * - Bug Detection: Shared tests fail if platform implementations drift
 * - Maintainability: API changes update once, apply everywhere
 *
 * Usage:
 * Platform-specific test files should:
 * 1. Keep their unique tests (e.g., AsyncLocalStorage, Web Workers)
 * 2. Import and run these shared tests for API conformance
 */

import { describe, expect, it } from "vitest";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

/**
 * Check if async context propagation is available.
 * - Node.js: Always available via AsyncLocalStorage
 * - Browser: Requires Zone.js to be loaded BEFORE SDK initialization
 *
 * Note: In browser tests, Zone.js must be loaded before the SDK is imported.
 * Due to Vitest browser mode's module loading order, this can be tricky.
 * Tests that require async context propagation should skip if not available.
 */
const hasAsyncContextPropagation = (): boolean => {
  // in Node.js, AsyncLocalStorage is always available
  if (typeof window === "undefined") {
    return true;
  }
  // in browser, check if Zone.js is loaded
  return typeof Zone !== "undefined" && Zone?.current !== undefined;
};

/**
 * Run shared Context API conformance tests
 *
 * @param getClient - Function that returns the client instance for testing
 *
 * @example
 * ```typescript
 * // In node-context.test.mts
 * describe("Context API Separation", () => {
 *   runSharedContextAPITests(() => client);
 * });
 * ```
 *
 * @example
 * ```typescript
 * // In browser-context.test.mts
 * describe("Context API Separation", () => {
 *   runSharedContextAPITests(() => client);
 * });
 * ```
 */
export function runSharedContextAPITests(
  getClient: () => UnifiedObservabilityClient,
) {
  describe("Business Context API (Shared Conformance)", () => {
    it("should run code with business context using context.business.run()", async () => {
      const client = getClient();
      await client.context.business.run(
        {
          userId: "user-123",
          tenantId: "tenant-456",
        },
        () => {
          const ctx = client.context.business.get();
          expect(ctx.userId).toBe("user-123");
          expect(ctx.tenantId).toBe("tenant-456");
        },
      );
    });

    it("should set user information using context.business.setUser()", () => {
      const client = getClient();

      // setUser() should accept user ID and attributes
      expect(() => {
        client.context.business.setUser("user-789", {
          email: "test@example.com",
          tier: "premium",
        });
      }).not.toThrow();

      // alternative object form should also work
      expect(() => {
        client.context.business.setUser({
          id: "user-456",
          email: "user@example.com",
          username: "testuser",
        });
      }).not.toThrow();

      // clean up
      client.context.business.clear();
    });

    it("should add breadcrumbs using context.business.addBreadcrumb()", async () => {
      const client = getClient();
      await client.context.business.run({}, () => {
        client.context.business.addBreadcrumb("User logged in");
        client.context.business.addBreadcrumb("Navigated to dashboard", {
          path: "/dashboard",
        });

        const breadcrumbs = client.context.business.getBreadcrumbs();
        expect(breadcrumbs).toHaveLength(2);
        expect(breadcrumbs[0]!.message).toBe("User logged in");
        expect(breadcrumbs[1]!.message).toBe("Navigated to dashboard");
        expect(breadcrumbs[1]!.data).toEqual({ path: "/dashboard" });
      });
    });

    it("should add tags using context.business.addTag()", async () => {
      const client = getClient();
      await client.context.business.run({}, () => {
        client.context.business.addTag("environment", "production");
        client.context.business.addTag("version", "1.2.3");
        client.context.business.addTag("build", 12345);

        const enriched = client.context.business.getEnriched();
        // tags are stored as enriched context
        expect(enriched).toBeDefined();
      });
    });

    // note: this test requires async context propagation (Zone.js in browser, AsyncLocalStorage in Node)
    // skip in browser if Zone.js wasn't loaded before SDK initialization
    it.skipIf(!hasAsyncContextPropagation())(
      "should create nested contexts using context.business.withAdditional()",
      async () => {
        const client = getClient();
        await client.context.business.run({ userId: "user-123" }, async () => {
          const outerCtx = client.context.business.get();
          expect(outerCtx.userId).toBe("user-123");
          expect(outerCtx.sessionId).toBeUndefined();

          await client.context.business.withAdditional(
            { sessionId: "session-456" },
            () => {
              const innerCtx = client.context.business.get();
              expect(innerCtx.userId).toBe("user-123");
              expect(innerCtx.sessionId).toBe("session-456");
            },
          );

          // back to outer context
          const finalCtx = client.context.business.get();
          expect(finalCtx.userId).toBe("user-123");
          expect(finalCtx.sessionId).toBeUndefined();
        });
      },
    );

    it("should clear business context using context.business.clear()", () => {
      const client = getClient();

      // set up some global context
      client.context.business.setUser("user-123", {
        email: "test@example.com",
      });
      client.context.business.addBreadcrumb("Test breadcrumb");
      client.context.business.addTag("test", "value");

      // verify breadcrumbs exist before clear
      const before = client.context.business.getBreadcrumbs();
      expect(before.length).toBeGreaterThan(0);

      // clear should not throw
      expect(() => {
        client.context.business.clear();
      }).not.toThrow();

      // verify breadcrumbs are cleared
      const breadcrumbs = client.context.business.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(0);
    });
  });

  describe("Trace Context API (Shared Conformance)", () => {
    it("should get trace ID from active span using context.trace.getTraceId()", async () => {
      const client = getClient();
      // eslint-disable-next-line @typescript-eslint/require-await
      await client.traces.withSpan("test-span", async () => {
        const traceId = client.context.trace.getTraceId();
        expect(traceId).toBeDefined();
        expect(typeof traceId).toBe("string");
        expect(traceId?.length).toBeGreaterThan(0);
      });
    });

    it("should get span ID from active span using context.trace.getSpanId()", async () => {
      const client = getClient();
      // eslint-disable-next-line @typescript-eslint/require-await
      await client.traces.withSpan("test-span", async () => {
        const spanId = client.context.trace.getSpanId();
        expect(spanId).toBeDefined();
        expect(typeof spanId).toBe("string");
        expect(spanId?.length).toBeGreaterThan(0);
      });
    });

    it("should get span context using context.trace.getSpanContext()", async () => {
      const client = getClient();
      // eslint-disable-next-line @typescript-eslint/require-await
      await client.traces.withSpan("test-span", async () => {
        const spanContext = client.context.trace.getSpanContext();
        expect(spanContext).toBeDefined();
        expect(spanContext?.traceId).toBeDefined();
        expect(spanContext?.spanId).toBeDefined();
      });
    });

    it("should check for active span using context.trace.hasActiveSpan()", async () => {
      const client = getClient();

      // no active span outside of withSpan
      expect(client.context.trace.hasActiveSpan()).toBe(false);

      // eslint-disable-next-line @typescript-eslint/require-await
      await client.traces.withSpan("test-span", async () => {
        // active span inside withSpan
        expect(client.context.trace.hasActiveSpan()).toBe(true);
      });

      // no active span after withSpan
      expect(client.context.trace.hasActiveSpan()).toBe(false);
    });

    it("should return undefined when no active span", () => {
      const client = getClient();

      const traceId = client.context.trace.getTraceId();
      const spanId = client.context.trace.getSpanId();
      const spanContext = client.context.trace.getSpanContext();

      expect(traceId).toBeUndefined();
      expect(spanId).toBeUndefined();
      expect(spanContext).toBeUndefined();
    });
  });

  describe("Combined Context API (Shared Conformance)", () => {
    it("should merge business and trace context using context.getAll()", async () => {
      const client = getClient();
      await client.context.business.run(
        { userId: "user-123", tenantId: "tenant-456" },
        async () => {
          // eslint-disable-next-line @typescript-eslint/require-await
          await client.traces.withSpan("test-span", async () => {
            const allContext = client.context.getAll();

            // should have business context
            expect(allContext.userId).toBe("user-123");
            expect(allContext.tenantId).toBe("tenant-456");

            // should have trace context
            expect(allContext.traceId).toBeDefined();
            expect(allContext.spanId).toBeDefined();
          });
        },
      );
    });

    it("should separate business and trace concerns", async () => {
      const client = getClient();
      await client.context.business.run({ userId: "user-123" }, async () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        await client.traces.withSpan("test-span", async () => {
          // business context should not have trace fields
          const businessCtx = client.context.business.get();
          expect(businessCtx.userId).toBe("user-123");
          expect(businessCtx.traceId).toBeUndefined();
          expect(businessCtx.spanId).toBeUndefined();

          // trace context methods should not have business fields
          const traceId = client.context.trace.getTraceId();
          const spanId = client.context.trace.getSpanId();
          expect(traceId).toBeDefined();
          expect(spanId).toBeDefined();

          // getAll() should have both
          const allCtx = client.context.getAll();
          expect(allCtx.userId).toBe("user-123");
          expect(allCtx.traceId).toBeDefined();
          expect(allCtx.spanId).toBeDefined();
        });
      });
    });
  });

  describe("Context Inheritance via run() (Shared Conformance)", () => {
    // note: this test requires async context propagation (Zone.js in browser, AsyncLocalStorage in Node)
    // skip in browser if Zone.js wasn't loaded before SDK initialization
    it.skipIf(!hasAsyncContextPropagation())(
      "should allow nesting contexts to add values without affecting outer scope",
      async () => {
        const client = getClient();
        await client.context.business.run({ base: "value1" }, async () => {
          // outer scope has only base value
          const outerCtx = client.context.business.get();
          expect(outerCtx.base).toBe("value1");
          expect(outerCtx.additional).toBeUndefined();

          // create nested context with additional value
          const currentCtx = client.context.business.get();
          await client.context.business.run(
            { ...currentCtx, additional: "value2" },
            () => {
              // inner scope has both values
              const innerCtx = client.context.business.get();
              expect(innerCtx.base).toBe("value1");
              expect(innerCtx.additional).toBe("value2");
            },
          );

          // back in outer scope, additional is gone
          const finalCtx = client.context.business.get();
          expect(finalCtx.base).toBe("value1");
          expect(finalCtx.additional).toBeUndefined();
        });
      },
    );

    it("should set context properties via run() (immutable pattern)", async () => {
      const client = getClient();
      // immutable pattern: context properties can be set when creating context
      await client.context.business.run(
        {
          userId: "user-123",
          userEmail: "user@example.com",
          userPlan: "premium",
          environment: "production",
          region: "us-east-1",
        },
        () => {
          const ctx = client.context.business.get();
          expect(ctx.userId).toBe("user-123");
          expect(ctx.userEmail).toBe("user@example.com");
          expect(ctx.environment).toBe("production");
          expect(ctx.region).toBe("us-east-1");
        },
      );
    });
  });
}
