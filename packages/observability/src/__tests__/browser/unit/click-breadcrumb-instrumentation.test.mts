/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { BrowserClickBreadcrumbInstrumentation } from "../../../browser/instrumentations/click-breadcrumb-instrumentation.mjs";

// mock addBreadcrumb
vi.mock("../../../enrichment/context.mjs", () => ({
  addBreadcrumb: vi.fn(),
}));

import { addBreadcrumb } from "../../../enrichment/context.mjs";

describe("BrowserClickBreadcrumbInstrumentation", () => {
  let instrumentation: BrowserClickBreadcrumbInstrumentation;
  let container: HTMLDivElement;
  let interactionHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    interactionHandler = vi.fn();

    container = document.createElement("div");
    container.id = "test-container";
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (instrumentation) {
      instrumentation.disable();
    }
    container.remove();
  });

  describe("enable/disable", () => {
    it("should start disabled", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation();
      expect(instrumentation.isEnabled()).toBe(false);
    });

    it("should enable and track state", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation();
      instrumentation.enable();
      expect(instrumentation.isEnabled()).toBe(true);
    });

    it("should disable and track state", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation();
      instrumentation.enable();
      instrumentation.disable();
      expect(instrumentation.isEnabled()).toBe(false);
    });

    it("should be idempotent for enable", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation();
      instrumentation.enable();
      instrumentation.enable();
      expect(instrumentation.isEnabled()).toBe(true);
    });
  });

  describe("click capture", () => {
    it("should capture button clicks", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-button";
      button.textContent = "Click me";
      container.appendChild(button);

      button.click();

      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "action",
          level: "info",
          message: expect.stringContaining("button#test-button"),
        }),
      );
      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.click",
        expect.objectContaining({
          selector: expect.stringContaining("button#test-button"),
          tag: "button",
          text: "Click me",
        }),
      );
    });

    it("should capture link clicks", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const link = document.createElement("a");
      link.id = "test-link";
      link.href = "#";
      link.textContent = "Test Link";
      container.appendChild(link);

      link.click();

      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "action",
          message: expect.stringContaining("a#test-link"),
        }),
      );
    });

    it("should include role attribute in data", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const div = document.createElement("div");
      div.id = "test-div";
      div.setAttribute("role", "button");
      container.appendChild(div);

      div.click();

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.click",
        expect.objectContaining({
          role: "button",
        }),
      );
    });

    it("should include aria-label in data", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "icon-btn";
      button.setAttribute("aria-label", "Close dialog");
      container.appendChild(button);

      button.click();

      // aria-label is sanitized (spaces → underscores, truncated to 50 chars)
      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.click",
        expect.objectContaining({
          ariaLabel: "Close_dialog",
        }),
      );
    });
  });

  describe("sensitive element blocking", () => {
    it("should not capture clicks on password inputs", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const input = document.createElement("input");
      input.type = "password";
      container.appendChild(input);

      input.click();

      expect(addBreadcrumb).not.toHaveBeenCalled();
      expect(interactionHandler).not.toHaveBeenCalled();
    });

    it("should not capture clicks on elements with data-observability-block", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const div = document.createElement("div");
      div.setAttribute("data-observability-block", "");
      container.appendChild(div);

      div.click();

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should not capture clicks on children of blocked elements", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const parent = document.createElement("div");
      parent.setAttribute("data-observability-block", "");
      const button = document.createElement("button");
      button.textContent = "Secret";
      parent.appendChild(button);
      container.appendChild(parent);

      button.click();

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("blockedSelectors config", () => {
    it("should respect string blockedSelectors", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        blockedSelectors: [".payment"],
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.className = "payment-submit";
      container.appendChild(button);

      button.click();

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should respect regex blockedSelectors", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        blockedSelectors: [/admin/i],
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "admin-action";
      container.appendChild(button);

      button.click();

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("sampling", () => {
    it("should respect sampleRate of 0", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        sampleRate: 0,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // click multiple times
      for (let i = 0; i < 10; i++) {
        button.click();
      }

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should capture all clicks with sampleRate of 1", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        sampleRate: 1.0,
        throttleMs: 0, // disable throttle for this test
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      button.click();
      button.click();

      expect(addBreadcrumb).toHaveBeenCalledTimes(3);
    });
  });

  describe("throttling", () => {
    it("should throttle rapid clicks on same element", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        throttleMs: 1000, // 1 second throttle
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // rapid clicks
      button.click();
      button.click();
      button.click();

      // only first should be captured due to throttle
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    });

    it("should allow clicks on different elements", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        throttleMs: 1000,
      });
      instrumentation.enable();

      const button1 = document.createElement("button");
      button1.id = "btn-1";
      container.appendChild(button1);

      const button2 = document.createElement("button");
      button2.id = "btn-2";
      container.appendChild(button2);

      button1.click();
      button2.click();

      // both should be captured (different elements)
      expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    });

    it("should allow clicks after throttle window expires", async () => {
      vi.useFakeTimers();

      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        throttleMs: 100,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);

      // advance time past throttle
      vi.advanceTimersByTime(150);

      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe("cleanup", () => {
    it("should not capture clicks after disable", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();
      instrumentation.disable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should clear throttle state on disable", () => {
      instrumentation = new BrowserClickBreadcrumbInstrumentation({
        interactionHandler,
        throttleMs: 10000, // long throttle
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);

      // disable and re-enable
      instrumentation.disable();
      instrumentation.enable();

      // should capture again since state was cleared
      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    });
  });
});
