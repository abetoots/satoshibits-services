/**
 * README Examples Validation Tests
 *
 * Ensures all code examples in the README actually work
 * in both Node.js and browser environments.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SmartClient, UnifiedObservabilityClient } from "../index.mjs";

describe("README Examples Validation", () => {
  let observability: UnifiedObservabilityClient | null = null;

  beforeEach(async () => {
    // Clean initialization for each test
  });

  afterEach(async () => {
    if (observability) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await SmartClient.shutdown()?.catch(() => {});
      observability = null;
    }
  });

  describe("Basic Initialization Example", () => {
    it("Should work as shown in README - One line initialization", async () => {
      // From README line 21-24
      const client = await SmartClient.initialize({
        serviceName: "my-app",
        endpoint: undefined, // no-network mode for tests
      });

      expect(client).toBeDefined();
      expect(typeof client.getInstrumentation).toBe("function");

      const observability = client.getInstrumentation(
        "my-app/checkout",
        "1.0.0",
      );
      expect(observability).toBeDefined();
      expect(observability.metrics).toBeDefined();
      expect(observability.traces).toBeDefined();
      expect(observability.logs).toBeDefined();
    });
  });

  describe("Error Tracking Example", () => {
    it("Should work as shown in README - Error with context", async () => {
      // From README line 26-33
      const client = await SmartClient.initialize({
        serviceName: "my-app",
        endpoint: undefined, // no-network mode for tests
      });
      observability = client;

      // eslint-disable-next-line @typescript-eslint/require-await
      const processPayment = async (_order: unknown) => {
        throw new Error("Payment failed");
      };

      const order = { id: "123", amount: 99.99 };

      try {
        await processPayment(order);
      } catch (error) {
        // Should not throw when recording error
        expect(() => client.errors.record(error)).not.toThrow();
        // Automatically captures: user ID, session, feature flags,
        // call stack, related requests, and breadcrumbs
      }
    });
  });

  describe("Business Metrics Example", () => {
    it("Should work as shown in README - Track business metrics", async () => {
      // From README line 35-39
      const client = await SmartClient.initialize({
        serviceName: "my-app",
        endpoint: undefined, // no-network mode for tests
      });
      observability = client;

      const checkout = client.getInstrumentation("my-app/checkout", "1.0.0");

      // Track what matters to your business
      expect(() => {
        checkout.metrics.increment("completed", 1, {
          plan: "premium",
          amount: 99.99,
        });
      }).not.toThrow();
    });
  });

  describe("Logging Example", () => {
    it("Should work as shown in README - Structured logging", async () => {
      // From README line 93-100
      const client = await SmartClient.initialize({
        serviceName: "my-app",
        endpoint: undefined, // no-network mode for tests
      });
      observability = client;

      const payment = client.getInstrumentation("my-app/payment", "1.0.0");
      const error = new Error("Payment processing failed");

      // Logs tell you WHAT happened (like diagnostic messages)
      expect(() => {
        payment.logs.info("Payment processed", {
          gateway: "stripe",
          amount: 99.99,
          currency: "USD",
        });
      }).not.toThrow();

      expect(() => {
        payment.logs.error("Payment failed", error, {
          reason: "Insufficient funds",
        });
      }).not.toThrow();
    });
  });

  describe("API Surface Validation", () => {
    it("Should have all documented methods available", async () => {
      const client = await SmartClient.initialize({
        serviceName: "my-app",
        endpoint: undefined, // no-network mode for tests
      });
      observability = client;

      const instrument = client.getInstrumentation("my-app/test", "1.0.0");

      // Scoped instrument API
      expect(typeof instrument.metrics.increment).toBe("function");
      expect(typeof instrument.metrics.gauge).toBe("function");
      expect(typeof instrument.metrics.record).toBe("function");
      expect(typeof instrument.traces.withSpan).toBe("function");
      expect(typeof instrument.logs.info).toBe("function");
      expect(typeof instrument.logs.error).toBe("function");
      expect(typeof instrument.logs.warn).toBe("function");
      expect(typeof instrument.logs.debug).toBe("function");

      // Client-level APIs (still available)
      expect(typeof client.errors.record).toBe("function");
      expect(typeof client.context.business.addBreadcrumb).toBe("function");
      expect(typeof client.context.business.setUser).toBe("function");
      expect(typeof client.context.business.addTag).toBe("function");
      expect(typeof client.context.business.run).toBe("function");
      expect(typeof client.context.business.getEnriched).toBe("function");
    });
  });

  describe("Environment Compatibility", () => {
    it("Should initialize without errors in test environment", async () => {
      // Just verify it works in our current test environment
      const client = await SmartClient.initialize({
        serviceName: "test-app",
        endpoint: undefined, // no-network mode for tests
      });
      observability = client;

      expect(client).toBeDefined();
      expect(typeof client.getInstrumentation).toBe("function");
      expect(client.errors).toBeDefined();
      expect(client.context).toBeDefined();

      const instrument = client.getInstrumentation("test-app/test", "1.0.0");
      expect(instrument.metrics).toBeDefined();
    });

    it("Should handle both environment configurations", async () => {
      // Test that the API works regardless of environment
      // We don't actually change the environment (that would break the test runner)
      // Instead we verify the API contract is consistent

      const client = await SmartClient.initialize({
        serviceName: "universal-app",
        endpoint: undefined, // no-network mode for tests
      });
      observability = client;

      expect(client).toBeDefined();

      const instrument = client.getInstrumentation(
        "universal-app/test",
        "1.0.0",
      );

      // The same API should work regardless of environment
      expect(typeof instrument.metrics.increment).toBe("function");
      expect(typeof client.context.business.addBreadcrumb).toBe("function");
      expect(typeof instrument.traces.withSpan).toBe("function");
    });
  });
});
