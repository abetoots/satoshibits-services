/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { BrowserRageClickInstrumentation } from "../../../browser/instrumentations/rage-click-instrumentation.mjs";

// mock addBreadcrumb
vi.mock("../../../enrichment/context.mjs", () => ({
  addBreadcrumb: vi.fn(),
}));

import { addBreadcrumb } from "../../../enrichment/context.mjs";

describe("BrowserRageClickInstrumentation", () => {
  let instrumentation: BrowserRageClickInstrumentation;
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
      instrumentation = new BrowserRageClickInstrumentation();
      expect(instrumentation.isEnabled()).toBe(false);
    });

    it("should enable and track state", () => {
      instrumentation = new BrowserRageClickInstrumentation();
      instrumentation.enable();
      expect(instrumentation.isEnabled()).toBe(true);
    });

    it("should disable and track state", () => {
      instrumentation = new BrowserRageClickInstrumentation();
      instrumentation.enable();
      instrumentation.disable();
      expect(instrumentation.isEnabled()).toBe(false);
    });

    it("should be idempotent for enable", () => {
      instrumentation = new BrowserRageClickInstrumentation();
      instrumentation.enable();
      instrumentation.enable();
      expect(instrumentation.isEnabled()).toBe(true);
    });
  });

  describe("rage click detection", () => {
    it("should detect rage clicks at default threshold (3)", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // first two clicks don't trigger
      button.click();
      button.click();
      expect(addBreadcrumb).not.toHaveBeenCalled();

      // third click triggers rage click
      button.click();
      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "action",
          level: "warning",
          message: expect.stringContaining("Rage click detected"),
        }),
      );
    });

    it("should include correct data in breadcrumb", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      button.click();
      button.click();

      expect(interactionHandler).toHaveBeenCalledWith(
        "ui.rage_click",
        expect.objectContaining({
          selector: expect.stringContaining("button#test-btn"),
          clickCount: 3,
          threshold: 3,
          windowMs: expect.any(Number),
        }),
      );
    });

    it("should respect custom threshold", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        threshold: 5,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // 4 clicks should not trigger
      for (let i = 0; i < 4; i++) {
        button.click();
      }
      expect(addBreadcrumb).not.toHaveBeenCalled();

      // 5th click should trigger
      button.click();
      expect(addBreadcrumb).toHaveBeenCalled();
    });

    it("should count continued clicks beyond threshold", () => {
      vi.useFakeTimers();

      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        threshold: 3,
        cooldownMs: 0, // disable cooldown for this test
        windowMs: 5000, // long window
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // click 5 times with small time gaps so cooldown can expire
      for (let i = 0; i < 5; i++) {
        button.click();
        vi.advanceTimersByTime(10); // advance time so cooldown check works
      }

      // should be called multiple times, last with clickCount = 5
      const lastCall =
        interactionHandler.mock.calls[
          interactionHandler.mock.calls.length - 1
        ] as [string, { clickCount?: number }] | undefined;
      expect(lastCall?.[1]?.clickCount).toBe(5);

      vi.useRealTimers();
    });
  });

  describe("window timing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should reset count when window expires", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        windowMs: 500,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // click twice
      button.click();
      button.click();

      // wait for window to expire
      vi.advanceTimersByTime(600);

      // click once more - should start new sequence
      button.click();

      // total of 3 clicks but not within window, so no rage click
      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should detect rage clicks within window", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        windowMs: 1000,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      button.click();
      vi.advanceTimersByTime(200);
      button.click();
      vi.advanceTimersByTime(200);
      button.click();

      expect(addBreadcrumb).toHaveBeenCalled();
    });
  });

  describe("cooldown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should apply cooldown after rage click detection", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        threshold: 3,
        cooldownMs: 2000,
        windowMs: 1000,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // trigger first rage click
      button.click();
      button.click();
      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);

      // more clicks during cooldown should not trigger
      button.click();
      button.click();
      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    });

    it("should emit again after cooldown expires", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        threshold: 3,
        cooldownMs: 1000,
        windowMs: 2000, // keep window open
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // trigger first rage click
      button.click();
      button.click();
      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);

      // wait for cooldown to expire
      vi.advanceTimersByTime(1100);

      // click again (still in window) - should trigger again
      button.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    });
  });

  describe("multiple elements", () => {
    it("should track rage clicks independently per element", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        threshold: 3,
      });
      instrumentation.enable();

      const button1 = document.createElement("button");
      button1.id = "btn-1";
      container.appendChild(button1);

      const button2 = document.createElement("button");
      button2.id = "btn-2";
      container.appendChild(button2);

      // click button1 twice
      button1.click();
      button1.click();

      // click button2 twice
      button2.click();
      button2.click();

      // no rage clicks yet
      expect(addBreadcrumb).not.toHaveBeenCalled();

      // third click on button1 triggers rage click
      button1.click();
      expect(addBreadcrumb).toHaveBeenCalledTimes(1);
      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("btn-1"),
        }),
      );
    });
  });

  describe("sensitive element blocking", () => {
    it("should not track rage clicks on password inputs", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const input = document.createElement("input");
      input.type = "password";
      container.appendChild(input);

      for (let i = 0; i < 5; i++) {
        input.click();
      }

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should not track rage clicks on blocked elements", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const div = document.createElement("div");
      div.setAttribute("data-observability-block", "");
      container.appendChild(div);

      for (let i = 0; i < 5; i++) {
        div.click();
      }

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("blockedSelectors config", () => {
    it("should respect string blockedSelectors", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        blockedSelectors: [".payment"],
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.className = "payment-btn";
      container.appendChild(button);

      for (let i = 0; i < 5; i++) {
        button.click();
      }

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should respect regex blockedSelectors", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
        blockedSelectors: [/admin/i],
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "admin-action";
      container.appendChild(button);

      for (let i = 0; i < 5; i++) {
        button.click();
      }

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("should not track rage clicks after disable", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();
      instrumentation.disable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      for (let i = 0; i < 5; i++) {
        button.click();
      }

      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it("should clear click state on disable", () => {
      instrumentation = new BrowserRageClickInstrumentation({
        interactionHandler,
      });
      instrumentation.enable();

      const button = document.createElement("button");
      button.id = "test-btn";
      container.appendChild(button);

      // click twice (not enough for rage click)
      button.click();
      button.click();

      // disable and re-enable
      instrumentation.disable();
      instrumentation.enable();

      // click once - should not trigger (state was cleared)
      button.click();
      expect(addBreadcrumb).not.toHaveBeenCalled();

      // need to click 2 more times to trigger
      button.click();
      button.click();
      expect(addBreadcrumb).toHaveBeenCalled();
    });
  });
});
