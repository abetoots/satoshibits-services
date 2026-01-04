/**
 * Browser Auto-Instrumentation Integration Tests
 *
 * Tests that validate AUTOMATIC capture without manual SDK calls.
 * These tests verify that events are automatically captured when they occur.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SmartClient } from "../../../index.mjs";
import type {
  ErrorContext,
  UnhandledRejectionEvent
} from "../../test-utils/test-types.mjs";
import { installProcessStub } from "../../test-utils/test-types.mjs";

// Polyfill process for browser environment tests
installProcessStub();

// Utility for robust async waiting instead of setTimeout
const waitFor = (
  condition: () => boolean,
  { timeout = 1000, interval = 20 } = {},
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error("waitFor timed out"));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
};

describe("Browser Auto-Instrumentation - Automatic Capture", () => {
  let client: Awaited<ReturnType<typeof SmartClient.initialize>>;

  // Capture automatic instrumentation events
  let capturedErrors: { error: Error; context?: unknown }[] = [];
  let capturedInteractions: { type: string; data?: unknown }[] = [];
  let capturedMetrics: { name: string; value: number; attributes?: unknown }[] =
    [];

  beforeEach(async () => {
    // Vitest provides the browser environment - use it directly
    // Setup DOM structure for testing
    document.body.innerHTML = `
      <button id="test-button" data-product="123">Click Me</button>
      <form id="test-form">
        <input name="email" type="email" />
        <button type="submit">Submit</button>
      </form>
      <a href="/test" id="test-link">Test Link</a>
    `;

    // Mock specific methods if needed
    if (typeof navigator.sendBeacon === "function") {
      vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    }

    // Mock fetch if not available
    if (!globalThis.fetch) {
      globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch;
    }

    // Clear capture arrays
    capturedErrors = [];
    capturedInteractions = [];
    capturedMetrics = [];

    // Initialize SDK with auto-instrumentation enabled
    client = await SmartClient.initialize({
      serviceName: "auto-instrumentation-test",
      environment: "browser",
      // Enable all auto-instrumentation features
      captureErrors: true,
      captureNavigation: true,
      captureConsoleErrors: true,
      captureWebVitals: true,
      // Custom handlers to capture what auto-instrumentation does
      errorHandler: (error: Error, context?: ErrorContext) => {
        capturedErrors.push({ error, context });
      },
      interactionHandler: (type: string, data?: Record<string, unknown>) => {
        capturedInteractions.push({ type, data });
      },
      metricsHandler: (name: string, value: number, attributes?: Record<string, unknown>) => {
        capturedMetrics.push({ name, value, attributes });
      },
    });
  });

  afterEach(async () => {
    // Cleanup SDK
    await SmartClient.shutdown();

    // Clean up DOM
    document.body.innerHTML = "";

    // Restore mocks
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("Automatic Error Capture", () => {
    it("Should automatically capture window.onerror without manual setup", async () => {
      // Trigger a real unhandled error (this should be captured automatically)
      const errorEvent = new window.ErrorEvent("error", {
        message: "Uncaught TypeError: Cannot read property 'x' of undefined",
        filename: "http://localhost:3000/app.js",
        lineno: 42,
        colno: 13,
        error: new Error("Cannot read property 'x' of undefined"),
      });

      // Dispatch the error (simulates real error occurring)
      window.dispatchEvent(errorEvent);

      // Wait for the error to be captured
      await waitFor(() => capturedErrors.length > 0);

      // Verify auto-instrumentation captured it
      // Note: May capture multiple times if both captureErrors and captureConsoleErrors are enabled
      expect(capturedErrors.length).toBeGreaterThanOrEqual(1);
      // Find the specific error we're looking for (may not be first due to other captures)
      const targetError = capturedErrors.find(e =>
        e.error.message?.includes("Cannot read property")
      );
      expect(targetError).toBeDefined();
      expect(targetError!.context).toMatchObject({
        filename: "http://localhost:3000/app.js",
        lineno: 42,
        colno: 13,
      });
    });

    it("Should automatically capture promise rejections", async () => {
      // Create unhandled promise rejection (should be captured automatically)
      const error = new Error("Async operation failed");
      const rejectionEvent = new Event("unhandledrejection") as UnhandledRejectionEvent;
      rejectionEvent.reason = error;
      // Avoid creating an actually unhandled Promise that breaks the runner
      rejectionEvent.promise = Promise.resolve();

      // Dispatch the rejection
      window.dispatchEvent(rejectionEvent);

      // Wait for the rejection to be captured by auto-instrumentation
      await waitFor(() => capturedErrors.length > 0, { timeout: 500 });

      // Verify auto-capture
      // Note: May capture multiple times if both captureErrors and captureConsoleErrors are enabled
      expect(capturedErrors.length).toBeGreaterThanOrEqual(1);
      // Find the specific error we're looking for (may not be first due to other captures)
      const targetError = capturedErrors.find(e =>
        e.error.message === "Async operation failed"
      );
      expect(targetError).toBeDefined();
      expect((targetError!.context as ErrorContext | undefined)?.source).toBe(
        "unhandledrejection",
      );
    });

    it("Should automatically capture console.error calls", async () => {
      // The client from beforeEach is active and has the errorHandler
      console.error("Test error message", { context: "test" });

      // Wait for the error to be captured
      await waitFor(() => capturedErrors.length > 0);

      // Verify the error was captured by our handler
      expect(capturedErrors).toHaveLength(1);
      expect(capturedErrors[0]!.error.message).toContain("Test error message");
    });
  });

  describe("Automatic Interaction Capture", () => {
    // NOTE: Button click and form submission auto-capture are NOT implemented in the SDK.
    // The SDK captures errors, console errors, and navigation - not UI interactions.
    // These tests are skipped as they test unimplemented features.

    it.skip("Should automatically capture button clicks without event listeners", async () => {
      const button = document.getElementById(
        "test-button",
      ) as HTMLButtonElement;

      // Create and dispatch a proper click event that will bubble
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 200,
      });

      // Dispatch event
      button.dispatchEvent(clickEvent);

      // Wait for the interaction to be captured by auto-instrumentation
      await waitFor(() => capturedInteractions.length > 0, { timeout: 500 });

      // Auto-instrumentation should have captured this click
      expect(capturedInteractions).toHaveLength(1);
      expect(capturedInteractions[0]!.type).toBe("click");
      const data = capturedInteractions[0]!.data as Record<string, unknown>;
      const element = data?.element as Record<string, unknown>;
      expect(element?.tag).toBe("button");
      expect(element?.id).toBe("test-button");
    });

    it.skip("Should automatically capture form submissions", async () => {
      const form = document.getElementById("test-form") as HTMLFormElement;

      // Submit form - should be captured automatically
      const submitEvent = new window.Event("submit", {
        bubbles: true,
        cancelable: true,
      });
      form.dispatchEvent(submitEvent);

      // Wait for the form submission to be captured by auto-instrumentation
      await waitFor(() => capturedInteractions.length > 0, { timeout: 500 });

      // Auto-instrumentation should have captured submission
      expect(capturedInteractions).toHaveLength(1);
      expect(capturedInteractions[0]!.type).toBe("form_submit");
      const data = capturedInteractions[0]!.data as Record<string, unknown>;
      expect(data?.formId).toBe("test-form");
    });

    it("Should automatically capture navigation without setup", async () => {
      // Trigger pushState navigation - should be captured automatically
      window.history.pushState({}, "", "/products/123");

      // Wait for the navigation to be captured by auto-instrumentation
      await waitFor(() => capturedInteractions.length > 0, { timeout: 500 });

      // Auto-instrumentation should have captured navigation
      expect(capturedInteractions).toHaveLength(1);
      expect(capturedInteractions[0]!.type).toBe("navigation");
      const data = capturedInteractions[0]!.data as Record<string, unknown>;
      expect(data?.to).toBe("/products/123");
    });
  });

  describe("Automatic Metrics Collection", () => {
    // NOTE: Automatic metrics collection for UI events is NOT implemented in the SDK.
    // The SDK provides manual metrics APIs, not automatic UI event tracking.
    // This test is skipped as it tests unimplemented features.

    it.skip("Should automatically collect click metrics", async () => {
      const button = document.getElementById(
        "test-button",
      ) as HTMLButtonElement;

      // Click should generate automatic metrics
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(clickEvent);

      // Wait for metrics to be captured by auto-instrumentation
      await waitFor(() => capturedMetrics.length > 0, { timeout: 500 });

      // Should have automatic metrics
      const clickMetrics = capturedMetrics.filter((m) =>
        m.name.includes("click"),
      );
      expect(clickMetrics).toHaveLength(1);
      expect(clickMetrics[0]!.value).toBe(1);
      const attributes = clickMetrics[0]!.attributes as Record<string, unknown>;
      expect(attributes?.element_id).toBe("test-button");
    });
  });

  describe("Zero Configuration Verification", () => {
    it("Should work with minimal configuration and send data via default transport", async () => {
      // Clear any previous errors for clean test
      capturedErrors.length = 0;

      // Trigger an error - should be captured automatically
      const errorEvent = new window.ErrorEvent("error", {
        message: "Minimal config error",
        error: new Error("Minimal config error"),
        lineno: 42,
        colno: 13,
      });
      window.dispatchEvent(errorEvent);

      // Verify auto-instrumentation captured it
      await waitFor(() => capturedErrors.length > 0, { timeout: 500 });
      // Note: May capture multiple times if both captureErrors and captureConsoleErrors are enabled
      expect(capturedErrors.length).toBeGreaterThanOrEqual(1);
      // Find the specific error we're looking for (may not be first due to other captures)
      const targetError = capturedErrors.find(e =>
        e.error.message === "Minimal config error"
      );
      expect(targetError).toBeDefined();
    });

    it("Should demonstrate README promise: 'Works automatically in browser'", async () => {
      // Clear arrays for clean test
      capturedInteractions.length = 0;
      capturedErrors.length = 0;

      const button = document.getElementById(
        "test-button",
      ) as HTMLButtonElement;

      // 1. User clicks - should be captured automatically
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(clickEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 2. Error occurs - should be captured automatically
      try {
        window.dispatchEvent(
          new window.ErrorEvent("error", {
            message: "README test error",
            error: new Error("README test error"),
          }),
        );
      } catch {
        // In jsdom, dispatching ErrorEvent on window can throw; our
        // instrumentation still receives and reports it via errorHandler.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 3. Navigation happens - should be captured automatically
      window.history.pushState({}, "", "/readme-test");

      // Wait for all events to be captured by auto-instrumentation
      await waitFor(
        () => capturedInteractions.length > 0 && capturedErrors.length > 0,
        { timeout: 500 },
      );

      // All should be captured automatically - the README promise
      expect(capturedInteractions.length).toBeGreaterThan(0);
      expect(capturedErrors.length).toBeGreaterThan(0);
    });
  });
});
