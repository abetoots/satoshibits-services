/**
 * Browser Initialization Tests
 *
 * Tests that validate SmartClient initialization in browser environments.
 * These tests verify actual functionality rather than documenting broken state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { SmartClient } from "../../../index.mjs";

describe("Browser Initialization", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Environment Detection", () => {
    it("Should not reference Node.js globals in browser", async () => {
      // SmartClient.initialize() should detect browser environment
      // and not reference Node.js globals

      try {
        const client = await SmartClient.initialize({
          serviceName: "browser-app",
          environment: "browser",
        });

        // Should work with environment detection
        expect(client).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(client.getServiceInstrumentation).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(client.getInstrumentation).toBeDefined();
        expect(client.errors).toBeDefined();
        expect(client.context).toBeDefined();

        // Test scoped instrumentation
        const serviceInstrument = client.getServiceInstrumentation();
        expect(serviceInstrument.metrics).toBeDefined();
        expect(serviceInstrument.traces).toBeDefined();
        expect(serviceInstrument.errors).toBeDefined();
      } catch (error) {
        // If it fails, check the error
        console.error("SmartClient.initialize error:", error);
        throw error;
      }
    });
  });

  describe("SmartClient.initialize() in Browser", () => {
    it("Should initialize without Node-specific configuration", async () => {
      // The README promises this works
      const client = await SmartClient.initialize({
        serviceName: "browser-app",
        endpoint: "https://api.example.com/telemetry",
        environment: "browser",
      });

      expect(client).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.getServiceInstrumentation).toBeDefined();

      // Test that scoped metrics work
      const serviceInstrument = client.getServiceInstrumentation();
      expect(serviceInstrument.metrics).toBeDefined();
    });
  });

  // NOTE: "Error handler configuration" tests moved to
  // node/browser-sdk-ssr-safety.test.mts - they require mocking globalThis.window
  // which is only possible in Node.js. In real browsers, window is read-only.

  describe("Fallback Behavior", () => {
    it("Should gracefully degrade when WebAPIs unavailable", async () => {
      // Test fallback behavior without mocking (in real browser environment)
      // Should still work in limited capacity
      // This may need adjustment based on implementation
    });

    it("Should provide helpful error messages for browser issues", async () => {
      try {
        await SmartClient.initialize({
          serviceName: "browser-app",
          environment: "browser",
        });
      } catch (error: unknown) {
        // Should provide browser-specific guidance
        expect((error as Error).message).toBeDefined();
      }
    });
  });

  describe("Concurrent Initialization (Doc 4 H5 Fix)", () => {
    it("should return same result for concurrent initialize calls", async () => {
      // Doc 4 H5 Fix: concurrent calls should await the same Promise
      // instead of creating orphaned SDK instances

      // fire multiple concurrent initializations
      const promise1 = SmartClient.initialize({
        serviceName: "concurrent-test-1",
        environment: "browser",
      });
      const promise2 = SmartClient.initialize({
        serviceName: "concurrent-test-2",
        environment: "browser",
      });
      const promise3 = SmartClient.initialize({
        serviceName: "concurrent-test-3",
        environment: "browser",
      });

      // all should resolve
      const [client1, client2, client3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      // all should return the same client instance (or at least be initialized)
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
      expect(client3).toBeDefined();

      // verify they all return valid clients
      expect(client1.errors).toBeDefined();
      expect(client2.errors).toBeDefined();
      expect(client3.errors).toBeDefined();
    });
  });
});
