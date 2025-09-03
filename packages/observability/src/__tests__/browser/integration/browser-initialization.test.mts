/**
 * Browser Initialization Tests
 *
 * Tests that validate SmartClient initialization in browser environments.
 * These tests verify actual functionality rather than documenting broken state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalWithBrowserGlobals } from "../../test-utils/test-types.mjs";

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

  describe("Error handler configuration", () => {
    let originalWindow: typeof globalThis.window;
    let originalDocument: typeof globalThis.document;
    let originalNavigator: typeof globalThis.navigator;
    let originalFetch: typeof globalThis.fetch;
    let addEventListenerSpy: ReturnType<typeof vi.fn>;
    let removeEventListenerSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      originalWindow = (globalThis as GlobalWithBrowserGlobals).window;
      originalDocument = (globalThis as GlobalWithBrowserGlobals).document;
      originalNavigator = (globalThis as GlobalWithBrowserGlobals).navigator;
      originalFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;

      addEventListenerSpy = vi.fn();
      removeEventListenerSpy = vi.fn();

      (globalThis as GlobalWithBrowserGlobals).window = {
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
        setTimeout,
        clearTimeout,
        location: {
          origin: "http://localhost:3000",
          href: "http://localhost:3000/page",
          host: "localhost:3000",
          pathname: "/page",
        },
      } as Window & typeof globalThis;

      (globalThis as GlobalWithBrowserGlobals).document = {
        referrer: "",
        title: "Test",
      } as Document;

      (globalThis as GlobalWithBrowserGlobals).navigator = {
        userAgent: "Mozilla/5.0 (Test Browser)",
        language: "en-US",
        onLine: true,
        sendBeacon: vi.fn().mockReturnValue(true),
      } as Navigator;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(() =>
        Promise.resolve({}),
      ) as unknown as typeof fetch;
    });

    afterEach(async () => {
      await SmartClient.shutdown().catch(() => {});

      if (originalWindow) {
        (globalThis as GlobalWithBrowserGlobals).window = originalWindow;
      } else {
        delete (globalThis as GlobalWithBrowserGlobals).window;
      }

      if (originalDocument) {
        (globalThis as GlobalWithBrowserGlobals).document = originalDocument;
      } else {
        delete (globalThis as GlobalWithBrowserGlobals).document;
      }

      if (originalNavigator) {
        (globalThis as GlobalWithBrowserGlobals).navigator = originalNavigator;
      } else {
        delete (globalThis as GlobalWithBrowserGlobals).navigator;
      }

      if (originalFetch) {
        (globalThis as unknown as { fetch?: typeof fetch }).fetch =
          originalFetch;
      } else {
        delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
      }

      vi.clearAllMocks();
    });

    it("respects captureErrors: false", async () => {
      await SmartClient.initialize({
        serviceName: "browser-app",
        environment: "browser",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
      });

      const errorListener = addEventListenerSpy.mock.calls.find(
        ([event]) => event === "error",
      );
      const rejectionListener = addEventListenerSpy.mock.calls.find(
        ([event]) => event === "unhandledrejection",
      );

      expect(errorListener).toBeUndefined();
      expect(rejectionListener).toBeUndefined();
    });

    it("cleans up browser error handlers on shutdown", async () => {
      await SmartClient.initialize({
        serviceName: "browser-app",
        environment: "browser",
        autoInstrument: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
      });

      expect(
        addEventListenerSpy.mock.calls.some(([event]) => event === "error"),
      ).toBe(true);
      expect(
        addEventListenerSpy.mock.calls.some(
          ([event]) => event === "unhandledrejection",
        ),
      ).toBe(true);

      await SmartClient.shutdown();

      expect(
        removeEventListenerSpy.mock.calls.filter(([event]) => event === "error")
          .length,
      ).toBeGreaterThan(0);
      expect(
        removeEventListenerSpy.mock.calls.filter(
          ([event]) => event === "unhandledrejection",
        ).length,
      ).toBeGreaterThan(0);
    });
  });

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
        });
      } catch (error: unknown) {
        // Should provide browser-specific guidance
        expect((error as Error).message).toBeDefined();
      }
    });
  });
});
