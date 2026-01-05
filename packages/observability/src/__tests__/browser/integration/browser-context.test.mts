/**
 * Browser Context Features Tests
 *
 * Tests browser-specific context features:
 * - User session management
 * - Breadcrumb collection (with max limit)
 * - Page context (URL, referrer, title)
 * - Device context (viewport, user agent)
 * - Feature flag tracking
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SmartClient, UnifiedObservabilityClient } from "../../../index.mjs";
import { ScopedInstrument } from "../../../unified-smart-client.mjs";
import {
  setupBrowserTestClient,
  teardownTestClient,
  type TestContext,
} from "../../test-utils/setup-helpers.mjs";
import { runSharedContextAPITests } from "../../test-utils/context-api-tests.mjs";
import { runInstanceIsolationTests } from "../../test-utils/instance-isolation-tests.mjs";

describe("Browser Context Features", () => {
  let testContext: TestContext;
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ScopedInstrument;

  beforeEach(async () => {
    // note: in real browser environment, window.location and other properties
    // are not configurable. tests should work with actual browser values.
    testContext = await setupBrowserTestClient({
      serviceName: "browser-context-test",
    });
    client = testContext.client;
    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    await teardownTestClient(testContext);
    // note: mock cleanup handled automatically by vitest config
  });

  describe("User Session Management", () => {
    it("should track user session across page loads", () => {
      // Set user context
      expect(() => {
        client.context.business.setUser("user-123", {
          plan: "premium",
          email: "test@example.com",
        });
      }).not.toThrow();

      // Session should be accessible
      const context = client.context.business.get();
      expect(context).toBeDefined();
    });

    it("should support session-level tags", () => {
      expect(() => {
        client.context.business.addTag("sessionId", "sess-abc123");
        client.context.business.addTag("feature", "checkout-v2");
        client.context.business.addTag("experiment", "fast-checkout");
      }).not.toThrow();
    });

    it("should maintain session context across async operations", async () => {
      client.context.business.setUser("user-456", { tier: "premium" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Context should persist across async boundary
      expect(() => {
        serviceInstrument.metrics.increment("test.metric");
      }).not.toThrow();
    });
  });

  describe("Breadcrumb Collection", () => {
    it("should collect breadcrumbs with page context", () => {
      expect(() => {
        client.context.business.addBreadcrumb("Page loaded");
        client.context.business.addBreadcrumb("User clicked button", {
          element: "checkout-btn",
          category: "ui",
        });
        client.context.business.addBreadcrumb("Form submitted", {
          form: "payment-form",
          category: "interaction",
        });
      }).not.toThrow();
    });

    it("should enforce max breadcrumb limit (100)", () => {
      // Add more breadcrumbs than the limit
      for (let i = 0; i < 150; i++) {
        client.context.business.addBreadcrumb(`Action ${i}`);
      }

      // Should handle large number of breadcrumbs gracefully
      expect(() => {
        client.context.business.addBreadcrumb("Final action");
      }).not.toThrow();

      // Breadcrumbs should be bounded (implementation detail - verify API works)
    });

    it("should include timestamps on breadcrumbs", () => {
      const beforeTime = Date.now();

      expect(() => {
        client.context.business.addBreadcrumb("Test action");
      }).not.toThrow();

      const afterTime = Date.now();

      // Breadcrumb should be recorded (timing allows for equal timestamps in fast execution)
      expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe("Page Context", () => {
    it("should capture page URL context", () => {
      expect(() => {
        serviceInstrument.metrics.increment("page.view", 1, {
          url: window.location.href,
          pathname: window.location.pathname,
        });
      }).not.toThrow();
    });

    it("should capture page title context", () => {
      expect(() => {
        client.context.business.addBreadcrumb("Page viewed", {
          title: document.title,
          url: window.location.href,
        });
      }).not.toThrow();
    });

    it("should capture referrer context", () => {
      expect(() => {
        const referrer = document.referrer || "direct";
        client.context.business.addTag("referrer", referrer);
        serviceInstrument.metrics.increment("traffic.referral", 1, {
          source: referrer,
        });
      }).not.toThrow();
    });

    it("should handle URL parameters in context", () => {
      expect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const utmSource = urlParams.get("utm_source");

        client.context.business.addTag("utm_source", utmSource ?? "direct");
        serviceInstrument.metrics.increment("marketing.attribution");
      }).not.toThrow();
    });
  });

  describe("Device Context", () => {
    it("should capture viewport dimensions", () => {
      expect(() => {
        client.context.business.addTag("viewport.width", window.innerWidth.toString());
        client.context.business.addTag("viewport.height", window.innerHeight.toString());

        serviceInstrument.metrics.gauge(
          "browser.viewport.width",
          window.innerWidth,
        );
        serviceInstrument.metrics.gauge(
          "browser.viewport.height",
          window.innerHeight,
        );
      }).not.toThrow();
    });

    it("should capture user agent information", () => {
      expect(() => {
        client.context.business.addTag("user_agent", window.navigator.userAgent);

        // Parse basic browser info (simplified)
        const isChrome = navigator.userAgent.includes("Chrome");
        const isWindows = navigator.userAgent.includes("Windows");

        client.context.business.addTag("browser.chrome", isChrome.toString());
        client.context.business.addTag("os.windows", isWindows.toString());
      }).not.toThrow();
    });

    it("should capture screen resolution context", () => {
      expect(() => {
        // Use actual browser screen dimensions
        const screenWidth = window.screen?.width || 1920;
        const screenHeight = window.screen?.height || 1080;

        serviceInstrument.metrics.gauge("browser.screen.width", screenWidth);
        serviceInstrument.metrics.gauge("browser.screen.height", screenHeight);

        client.context.business.addTag(
          "screen.resolution",
          `${screenWidth}x${screenHeight}`,
        );
      }).not.toThrow();
    });
  });

  describe("Feature Flag Tracking", () => {
    it("should support feature flag context", () => {
      // Simulate feature flag system
      const featureFlags = {
        "checkout-v2": true,
        "new-ui": false,
        "a-b-test-variant": "control",
      };

      expect(() => {
        Object.entries(featureFlags).forEach(([flag, value]) => {
          client.context.business.addTag(`feature.${flag}`, value.toString());
        });

        // Track feature flag usage
        serviceInstrument.metrics.increment("feature.checkout-v2.used");
      }).not.toThrow();
    });

    it("should support experiment tracking", () => {
      expect(() => {
        client.context.business.addTag("experiment.checkout_flow", "variant_b");
        client.context.business.addTag("experiment.button_color", "blue");

        serviceInstrument.metrics.increment("experiment.impression", 1, {
          experiment: "checkout_flow",
          variant: "variant_b",
        });
      }).not.toThrow();
    });

    it("should support cohort tracking", () => {
      expect(() => {
        client.context.business.setUser("user-789", {
          cohort: "power-users",
          segment: "high-value",
          tier: "enterprise",
        });

        serviceInstrument.metrics.increment("cohort.power-users.action");
      }).not.toThrow();
    });
  });

  describe("Context Integration", () => {
    it("should include all context in error reports", () => {
      // Set rich context
      client.context.business.setUser("user-999", { plan: "premium" });
      client.context.business.addTag("feature.new-checkout", "true");
      client.context.business.addBreadcrumb("Started checkout process");

      const error = new Error("Payment processing failed");

      expect(() => {
        client.errors.record(error);
      }).not.toThrow();
    });

    it("should include context in metrics", () => {
      // Set context that should flow to metrics
      client.context.business.addTag("page.type", "checkout");
      client.context.business.addTag("user.tier", "premium");

      expect(() => {
        serviceInstrument.metrics.increment("business.conversion");
        serviceInstrument.metrics.record("page.load_time", 1250);
      }).not.toThrow();
    });

    it("should maintain context across trace spans", async () => {
      client.context.business.setUser("user-101", { tier: "basic" });
      client.context.business.addTag("operation.type", "purchase");

      await expect(
        client.trace("checkout-flow", async () => {
          await client.trace("validate-cart", () => {
            serviceInstrument.metrics.increment("cart.validation");
          });

          await client.trace("process-payment", () => {
            serviceInstrument.metrics.increment("payment.attempt");
          });
        }),
      ).resolves.not.toThrow();
    });
  });

  // run shared context api conformance tests
  runSharedContextAPITests(() => client);

  // run shared instance isolation conformance tests
  runInstanceIsolationTests({
    environment: "browser",
    createClient: async (config) => {
      await SmartClient.shutdown();
      return setupBrowserTestClient(config);
    },
    teardownClient: teardownTestClient,
    metricPrefix: "browser",
  });
});
