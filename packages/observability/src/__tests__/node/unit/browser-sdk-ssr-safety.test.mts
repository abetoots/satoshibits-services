/**
 * BrowserSDK SSR Safety Tests
 *
 * These tests verify that the BrowserSDK can be safely imported and used
 * in Node.js/SSR environments (Next.js, Nuxt, Remix, etc.) where browser
 * globals may not exist.
 *
 * IMPORTANT: These tests MUST run in Node.js, not in a real browser,
 * because they test scenarios where window/document/navigator are missing.
 * In real browsers, these globals always exist and cannot be removed.
 *
 * NOTE: Uses vi.stubGlobal() to handle Node.js 18+ where navigator/window
 * may be getter-only properties as part of web compatibility.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSDK } from "../../../sdk-wrapper-browser.mjs";
import type { BrowserClientConfig } from "../../../unified-smart-client.mjs";

describe("BrowserSDK SSR Safety (Node.js Environment)", () => {
  let sdk: BrowserSDK;
  let mockConfig: BrowserClientConfig;

  beforeEach(() => {
    mockConfig = {
      serviceName: "test-browser-app",
      serviceVersion: "1.0.0",
      environment: "browser" as const,
    };

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // cleanup SDK if started
    if (sdk) {
      try {
        await sdk.shutdown();
      } catch {
        // ignore cleanup errors
      }
    }

    // vitest automatically restores stubbed globals due to restoreMocks config
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("Constructor SSR Safety", () => {
    it("should not access DOM globals during construction", () => {
      // temporarily hide DOM globals to ensure constructor doesn't access them
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("document", undefined);

      // constructor should work without DOM access
      expect(() => {
        sdk = new BrowserSDK(mockConfig);
      }).not.toThrow();

      expect(sdk).toBeDefined();
      expect(sdk).toBeInstanceOf(BrowserSDK);
    });

    it("should store configuration without accessing browser APIs", () => {
      // remove all browser globals
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("document", undefined);
      vi.stubGlobal("navigator", undefined);

      const config = {
        ...mockConfig,
        captureErrors: false,
        captureWebVitals: false,
      };

      // constructor should not throw
      expect(() => {
        sdk = new BrowserSDK(config);
      }).not.toThrow();

      expect(sdk).toBeDefined();
    });
  });

  describe("Start Method Requires Browser Globals", () => {
    // note: SDK constructor is SSR-safe (doesn't access globals)
    // but start() requires browser globals to function

    it("should throw when window is missing during start()", () => {
      vi.stubGlobal("window", undefined);

      sdk = new BrowserSDK(mockConfig);
      expect(() => sdk.start()).toThrow(/DOM globals|window/i);
    });

    it("should throw when navigator is missing during start()", () => {
      vi.stubGlobal("navigator", undefined);

      sdk = new BrowserSDK(mockConfig);
      expect(() => sdk.start()).toThrow(/DOM globals|navigator/i);
    });

    it("should throw descriptive error when all globals missing", () => {
      sdk = new BrowserSDK(mockConfig);

      // remove essential globals
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("navigator", undefined);
      vi.stubGlobal("document", undefined);

      // should throw a clear error message
      expect(() => sdk.start()).toThrow("BrowserSDK cannot start without DOM globals");
    });
  });

  describe("Error Handler Configuration (SSR)", () => {
    let addEventListenerSpy: ReturnType<typeof vi.fn>;
    let removeEventListenerSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      addEventListenerSpy = vi.fn();
      removeEventListenerSpy = vi.fn();

      // mock browser globals for testing event listener registration
      vi.stubGlobal("window", {
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
      });

      vi.stubGlobal("document", {
        referrer: "",
        title: "Test",
      });

      vi.stubGlobal("navigator", {
        userAgent: "Mozilla/5.0 (Test Browser)",
        language: "en-US",
        onLine: true,
        sendBeacon: vi.fn().mockReturnValue(true),
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({})),
      );
    });

    it("should respect captureErrors: false configuration", () => {
      sdk = new BrowserSDK({
        ...mockConfig,
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
      });

      void sdk.start();

      const errorListener = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "error",
      );
      const rejectionListener = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "unhandledrejection",
      );

      expect(errorListener).toBeUndefined();
      expect(rejectionListener).toBeUndefined();
    });

    it("should clean up browser error handlers on shutdown", async () => {
      sdk = new BrowserSDK({
        ...mockConfig,
        autoInstrument: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
      });

      void sdk.start();

      expect(
        addEventListenerSpy.mock.calls.some(
          (call) => call[0] === "error",
        ),
      ).toBe(true);
      expect(
        addEventListenerSpy.mock.calls.some(
          (call) => call[0] === "unhandledrejection",
        ),
      ).toBe(true);

      await sdk.shutdown();

      expect(
        removeEventListenerSpy.mock.calls.filter(
          (call) => call[0] === "error",
        ).length,
      ).toBeGreaterThan(0);
      expect(
        removeEventListenerSpy.mock.calls.filter(
          (call) => call[0] === "unhandledrejection",
        ).length,
      ).toBeGreaterThan(0);
    });
  });
});
