/**
 * Browser Test Environment Setup
 *
 * Provides environment-specific polyfills and configurations for browser tests.
 * This file is loaded before all tests via vitest.config.mts setupFiles.
 */

/**
 * Zone.js for Async Context Propagation
 *
 * Zone.js is required for OpenTelemetry's ZoneContextManager to work in browsers.
 * Without Zone.js, async context propagation is disabled and context won't flow
 * through Promise chains, setTimeout, etc.
 *
 * IMPORTANT: Zone.js must be loaded BEFORE any OpenTelemetry code runs.
 * This enables tests that verify context inheritance across async boundaries.
 *
 * Zone.js is safe to import in Node.js - it will detect the environment
 * and apply only browser-relevant patches.
 */
import "zone.js";

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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    removeListener: () => {},
  };
}
