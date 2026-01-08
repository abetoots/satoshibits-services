/**
 * Browser entrypoint tests to ensure custom handlers are wired when using the browser build.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialize } from "../../browser.mjs";
import { shutdownBrowserSdk } from "../../sdk-wrapper-browser.mjs";

describe("Browser entrypoint", () => {
  beforeEach(() => {
    // spy on existing window methods - keeps jsdom environment intact
    // restoreMocks: true in vitest.config automatically cleans up after each test
    vi.spyOn(window, "addEventListener");
    vi.spyOn(window, "removeEventListener");
  });

  afterEach(async () => {
    await shutdownBrowserSdk().catch(() => undefined);
    // restoreMocks: true automatically handles spy cleanup
  });

  it("registers and cleans up browser error listeners", async () => {
    // H3 fix: environment is now automatically injected by the entry point
    // captureErrors is opt-in by default (API Boundary Fix Issue #6)
    await initialize({
      serviceName: "browser-entrypoint-test",
      autoInstrument: false,
      captureErrors: true,
    });

    // verify that error listeners were registered
    expect(window.addEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));

    await shutdownBrowserSdk();

    // verify that error listeners were cleaned up
    expect(window.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });
});
