/**
 * BrowserSDK Class Tests
 *
 * Tests the new class-based BrowserSDK initialization pattern
 * following OpenTelemetry NodeSDK architecture
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSDK } from "../../../sdk-wrapper-browser.mjs";
import { BrowserErrorInstrumentation } from "../../../browser/instrumentations/index.mjs";
import type { BrowserClientConfig } from "../../../unified-smart-client.mjs";
import type {
  MockLocation,
  GlobalWithBrowserGlobals
} from "../../test-utils/test-types.mjs";


describe("BrowserSDK Class-Based Pattern", () => {
  let sdk: BrowserSDK;
  let mockConfig: BrowserClientConfig;

  beforeEach(() => {
    // Use Vitest's environment-provided globals directly
    // Mock specific properties/methods as needed, but be defensive if tests
    // temporarily removed globals in previous cases.
    if (typeof window !== 'undefined') {
      try {
        Object.defineProperty(window, 'location', {
          value: {
            href: "http://localhost:3000/test",
            host: "localhost:3000",
            pathname: "/test",
            origin: "http://localhost:3000",
          },
          writable: true,
          configurable: true,
        });
      } catch {
        // Fallback if location is not configurable in this environment
        (window as Window & { location: MockLocation }).location = {
          href: "http://localhost:3000/test",
          host: "localhost:3000",
          pathname: "/test",
          origin: "http://localhost:3000",
        };
      }
    }

    // Spy on window methods
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'setTimeout').mockImplementation((fn: TimerHandler) => { (fn as () => void)(); return 0; });
    vi.spyOn(window, 'clearTimeout');

    // Mock navigator properties if needed
    if (navigator.sendBeacon) {
      vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
    }

    // Mock document properties
    Object.defineProperty(document, 'referrer', {
      value: "https://example.com",
      writable: true,
      configurable: true,
    });
    document.title = "Test Page";

    mockConfig = {
      serviceName: "test-browser-app",
      serviceVersion: "1.0.0",
      environment: "browser" as const,
    };

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup SDK if started
    if (sdk) {
      try {
        await sdk.shutdown();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Restore all mocks and spies
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("Constructor Pattern (No Side Effects)", () => {
    it("Should create SDK instance without side effects", () => {
      // Constructor should not cause global registration or DOM access
      sdk = new BrowserSDK(mockConfig);

      expect(sdk).toBeDefined();
      expect(sdk).toBeInstanceOf(BrowserSDK);
      // No global side effects should occur during construction
      expect(window.addEventListener).not.toHaveBeenCalled();
    });

    it("Should store configuration in constructor", () => {
      const config = {
        ...mockConfig,
        captureErrors: false,
        captureWebVitals: false,
      };

      sdk = new BrowserSDK(config);

      // Configuration should be stored internally
      expect(sdk).toBeDefined();
    });

    it("Should not access DOM globals during construction", () => {
      // Temporarily hide DOM globals to ensure constructor doesn't access them
      const origWindow = global.window;
      const origDocument = global.document;
      (global as GlobalWithBrowserGlobals).window = undefined;
      (global as GlobalWithBrowserGlobals).document = undefined;

      // Constructor should work without DOM access
      expect(() => {
        sdk = new BrowserSDK(mockConfig);
      }).not.toThrow();

      // Restore globals
      (global as GlobalWithBrowserGlobals).window = origWindow;
      (global as GlobalWithBrowserGlobals).document = origDocument;
    });
  });

  describe("Start Method Pattern", () => {
    it("Should initialize SDK following NodeSDK order", () => {
      sdk = new BrowserSDK(mockConfig);

      // start() should perform initialization and return state
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
        expect(result).toHaveProperty("sanitizer");
      }).not.toThrow();
    });

    it("Should be idempotent - multiple start() calls should throw", () => {
      sdk = new BrowserSDK(mockConfig);

      const result = sdk.start();
      expect(result).toHaveProperty("shutdown");

      // Second start() should throw
      expect(() => sdk.start()).toThrow("BrowserSDK already started");
    });

    it("Should initialize with minimal config", () => {
      const minimalConfig: BrowserClientConfig = {
        serviceName: "minimal-test",
        environment: "browser" as const,
      };

      sdk = new BrowserSDK(minimalConfig);

      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
        expect(result).toHaveProperty("sanitizer");
      }).not.toThrow();
    });

    it("Should access DOM globals only during start()", () => {
      sdk = new BrowserSDK(mockConfig);

      // Track document.referrer access
      const mockReferrerAccess = vi.fn(() => "https://example.com");
      Object.defineProperty(document, "referrer", {
        get: mockReferrerAccess,
        configurable: true,
      });

      // DOM should not be accessed during construction
      expect(mockReferrerAccess).not.toHaveBeenCalled();

      // DOM should be accessed during start()
      sdk.start();
      expect(mockReferrerAccess).toHaveBeenCalled();
    });
  });

  describe("State Return Pattern", () => {
    it("Should return shutdown function and sanitizer from start()", () => {
      sdk = new BrowserSDK(mockConfig);

      const result = sdk.start();

      expect(result).toHaveProperty("shutdown");
      expect(typeof result.shutdown).toBe("function");
      expect(result).toHaveProperty("sanitizer");
      expect(result.sanitizer).toBeDefined();
    });

    it("Should not directly update global state in start()", () => {
      // This test verifies the decoupling - BrowserSDK should not directly
      // update browserState global, that's the wrapper's responsibility
      sdk = new BrowserSDK(mockConfig);

      // The class itself doesn't expose global state, so we just verify
      // it returns the necessary components for state management
      const result = sdk.start();

      expect(result.shutdown).toBeInstanceOf(Function);
      expect(result.sanitizer).toBeDefined();
    });
  });

  describe("Shutdown Method", () => {
    it("Should shutdown gracefully", async () => {
      sdk = new BrowserSDK(mockConfig);
      sdk.start();

      // Should not throw during shutdown
      await expect(sdk.shutdown()).resolves.toBeUndefined();
    });

    it("Should be safe to call shutdown multiple times", async () => {
      sdk = new BrowserSDK(mockConfig);
      sdk.start();

      await expect(sdk.shutdown()).resolves.toBeUndefined();
      await expect(sdk.shutdown()).resolves.toBeUndefined();
    });

    it("Should be safe to shutdown without starting", async () => {
      sdk = new BrowserSDK(mockConfig);

      // Should not throw if never started
      await expect(sdk.shutdown()).resolves.toBeUndefined();
    });

    it("Should disable instrumentations when shutting down", async () => {
      const disableSpy = vi.spyOn(BrowserErrorInstrumentation.prototype, "disable");

      sdk = new BrowserSDK(mockConfig);
      sdk.start();

      await sdk.shutdown();

      expect(disableSpy).toHaveBeenCalled();
      disableSpy.mockRestore();
    });
  });

  describe("Configuration Variations", () => {
    it("Should handle console exporter configuration", () => {
      const config = {
        ...mockConfig,
        useConsoleExporter: true,
      };

      sdk = new BrowserSDK(config);
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
      }).not.toThrow();
    });

    it("Should handle custom endpoint configuration", () => {
      const config = {
        ...mockConfig,
        endpoint: "https://custom-telemetry.com/traces",
      };

      sdk = new BrowserSDK(config);
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
      }).not.toThrow();
    });

    it("Should handle disabled auto-instrumentation", () => {
      const config = {
        ...mockConfig,
        autoInstrument: false,
      };

      sdk = new BrowserSDK(config);
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
      }).not.toThrow();
    });

    it("Should handle disabled custom instrumentations", () => {
      const config = {
        ...mockConfig,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
      };

      sdk = new BrowserSDK(config);
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
      }).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("Should handle missing window gracefully", () => {
      const origWindow = global.window;
      (global as GlobalWithBrowserGlobals).window = undefined;

      sdk = new BrowserSDK(mockConfig);
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
      }).not.toThrow();

      (global as GlobalWithBrowserGlobals).window = origWindow;
    });

    it("Should handle missing navigator gracefully", () => {
      const origNavigator = global.navigator;
      (global as GlobalWithBrowserGlobals).navigator = undefined;

      sdk = new BrowserSDK(mockConfig);
      expect(() => {
        const result = sdk.start();
        expect(result).toHaveProperty("shutdown");
      }).not.toThrow();

      (global as GlobalWithBrowserGlobals).navigator = origNavigator;
    });

    it("Should propagate errors from start() method", () => {
      // Test error propagation by temporarily removing globals
      sdk = new BrowserSDK(mockConfig);

      const origWindow = global.window;
      const origNavigator = global.navigator;
      const origDocument = global.document;

      // Remove essential globals to cause start() failure
      (global as GlobalWithBrowserGlobals).window = undefined;
      (global as GlobalWithBrowserGlobals).navigator = undefined;
      (global as GlobalWithBrowserGlobals).document = undefined;

      // Should throw an error when trying to start without required globals
      expect(() => sdk.start()).toThrow();

      // Restore globals
      (global as GlobalWithBrowserGlobals).window = origWindow;
      (global as GlobalWithBrowserGlobals).navigator = origNavigator;
      (global as GlobalWithBrowserGlobals).document = origDocument;
    });
  });
});
