/**
 * @vitest-environment jsdom
 *
 * Integration tests for browser interaction breadcrumb instrumentations.
 * Tests the full SDK integration with click, form, and rage click instrumentation.
 *
 * Uses interactionHandler to verify instrumentation behavior since we can't
 * spy on ESM exports in the browser environment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { BrowserSDK } from "../../../sdk-wrapper-browser.mjs";
import type { BrowserClientConfig } from "../../../config/client-config.mjs";

describe("Browser Interaction Breadcrumbs Integration", () => {
  let sdk: BrowserSDK | undefined;
  let container: HTMLDivElement;
  let interactionHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    interactionHandler = vi.fn();

    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (sdk) {
      await sdk.shutdown();
      sdk = undefined;
    }
    container?.remove();
  });

  describe("SDK Configuration", () => {
    it("should not enable click breadcrumbs by default", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        interactionHandler,
        // note: captureClickBreadcrumbs not set (defaults to false)
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();

      // interactionHandler not called because click capture is off by default
      expect(interactionHandler).not.toHaveBeenCalledWith(
        "ui.click",
        expect.anything(),
      );
    });

    it("should enable click breadcrumbs when configured", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureClickBreadcrumbs: true,
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.click",
        expect.objectContaining({
          selector: expect.stringContaining("button#test-btn") as unknown as string,
          tag: "button",
        }),
      );
    });

    it("should enable form breadcrumbs when configured", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureFormBreadcrumbs: true,
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const form = document.createElement("form");
      form.id = "test-form";
      form.method = "POST";
      container.appendChild(form);

      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.objectContaining({
          formId: "test-form",
          method: "POST",
        }),
      );
    });

    it("should enable rage click detection when configured", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        detectRageClicks: true,
        rageClickThreshold: 3,
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.id = "rage-btn";
      container.appendChild(button);

      // rapid clicks
      button.click();
      button.click();
      button.click();

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.rage_click",
        expect.objectContaining({
          clickCount: 3,
          threshold: 3,
        }),
      );
    });
  });

  describe("Configuration Options", () => {
    it("should respect blockedSelectors config", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureClickBreadcrumbs: true,
        blockedSelectors: [".secret"],
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.className = "secret-action";
      container.appendChild(button);

      button.click();

      expect(interactionHandler).not.toHaveBeenCalledWith(
        "ui.click",
        expect.anything(),
      );
    });

    it("should respect clickBreadcrumbSampleRate config", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureClickBreadcrumbs: true,
        clickBreadcrumbSampleRate: 0, // no sampling
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();

      expect(interactionHandler).not.toHaveBeenCalledWith(
        "ui.click",
        expect.anything(),
      );
    });

    it("should respect clickThrottleMs config", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureClickBreadcrumbs: true,
        clickThrottleMs: 10000, // very long throttle
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      button.click();
      button.click();

      // only first click captured due to throttle
      const clickCalls = interactionHandler.mock.calls.filter(
        (call) => call[0] === "ui.click",
      );
      expect(clickCalls).toHaveLength(1);
    });

    it("should respect rageClickWindowMs config", async () => {
      vi.useFakeTimers();

      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        detectRageClicks: true,
        rageClickThreshold: 3,
        rageClickWindowMs: 100, // very short window
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      vi.advanceTimersByTime(150); // exceed window
      button.click();
      vi.advanceTimersByTime(150);
      button.click();

      // no rage click because clicks are outside window
      expect(interactionHandler).not.toHaveBeenCalledWith(
        "ui.rage_click",
        expect.anything(),
      );

      vi.useRealTimers();
    });
  });

  describe("Multiple Instrumentations", () => {
    it("should enable multiple breadcrumb types simultaneously", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureClickBreadcrumbs: true,
        captureFormBreadcrumbs: true,
        detectRageClicks: true,
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      // test click
      const button = document.createElement("button");
      button.id = "multi-btn";
      container.appendChild(button);
      button.click();

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.click",
        expect.anything(),
      );

      // test form
      const form = document.createElement("form");
      form.id = "multi-form";
      container.appendChild(form);
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.form_submit",
        expect.anything(),
      );
    });
  });

  describe("Shutdown Behavior", () => {
    it("should stop capturing after shutdown", async () => {
      const config: BrowserClientConfig = {
        environment: "browser",
        serviceName: "test-app",
        autoInstrument: false,
        captureErrors: false,
        captureConsoleErrors: false,
        captureNavigation: false,
        captureWebVitals: false,
        captureClickBreadcrumbs: true,
        interactionHandler,
      };

      sdk = new BrowserSDK(config);
      await sdk.start();

      await sdk.shutdown();
      sdk = undefined;

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);
      button.click();

      expect(interactionHandler).not.toHaveBeenCalledWith(
        "ui.click",
        expect.anything(),
      );
    });
  });
});
