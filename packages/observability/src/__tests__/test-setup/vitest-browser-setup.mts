/**
 * Browser Test Environment Setup
 *
 * Provides environment-specific polyfills and configurations for browser tests.
 * This file is loaded before all browser tests via vitest.config.mts setupFiles.
 */

/**
 * Process Polyfill for Browser Tests
 *
 * OpenTelemetry and Vitest both try to access process even in browser builds.
 * This minimal polyfill prevents crashes while maintaining browser-like behavior.
 *
 * Context: The observability package uses OpenTelemetry's browser SDK, which
 * has some code paths that check for process.env. In a real browser, process
 * doesn't exist. In our test environment (jsdom running in Node), process exists
 * by default, which can cause the code to take Node-specific paths instead of
 * browser paths. This polyfill provides a minimal process object that prevents
 * crashes while keeping behavior browser-like.
 */
if (typeof globalThis.process === "undefined") {
  (globalThis as { process?: unknown }).process = {
    env: {},
    listeners: () => [],
    removeListener: () => {},
  };
}
