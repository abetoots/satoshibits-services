/**
 * Shared Instance Isolation Conformance Tests
 *
 * These tests verify that multiple client instances maintain proper isolation:
 * - Separate instrument caches
 * - No shared state between instances
 * - Independent configuration
 * - No test pollution
 *
 * Why this file exists:
 * - Nearly identical isolation tests are duplicated across platform test files
 * - This is "essential duplication" - the same isolation guarantees verified repeatedly
 * - Refactoring accepted by Gemini 2.5 Pro review (see REFACTORING-ADVISOR-SYNTHESIS.md)
 *
 * Benefits:
 * - DRY: Common isolation guarantees tested from single source
 * - Conformance Suite: Ensures isolation works identically across platforms
 * - Bug Detection: Shared tests fail if isolation breaks in any environment
 * - Maintainability: Isolation contract updates once, applies everywhere
 *
 * Usage:
 * Platform-specific test files should import and run these tests:
 */

import { describe, expect, it } from "vitest";

import type { BaseClientConfig } from "../../config/client-config.mjs";
import type { TestContext } from "./setup-helpers.mjs";

/**
 * Configuration for running instance isolation tests
 */
export interface IsolationTestConfig {
  /** Environment being tested (for test naming) */
  environment: "node" | "browser";

  /** Function to create a new test client */
  createClient: (config: Partial<BaseClientConfig>) => Promise<TestContext>;

  /** Function to teardown a test client */
  teardownClient: (context: TestContext) => Promise<void>;

  /** Optional metric prefix for distinguishing test runs */
  metricPrefix?: string;
}

/**
 * Run shared instance isolation conformance tests
 *
 * @param config - Configuration for test execution
 *
 * @example
 * ```typescript
 * // In node-context.test.mts
 * describe("Instance Isolation", () => {
 *   runInstanceIsolationTests({
 *     environment: "node",
 *     createClient: setupNodeTestClient,
 *     teardownClient: teardownTestClient,
 *     metricPrefix: "node",
 *   });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // In browser-context.test.mts
 * describe("Instance Isolation", () => {
 *   runInstanceIsolationTests({
 *     environment: "browser",
 *     createClient: setupBrowserTestClient,
 *     teardownClient: teardownTestClient,
 *     metricPrefix: "browser",
 *   });
 * });
 * ```
 */
export function runInstanceIsolationTests(config: IsolationTestConfig) {
  const prefix = config.metricPrefix ?? config.environment;

  describe("Instance Isolation (Shared Conformance)", () => {
    it("should create separate instrument caches for different client instances", async () => {
      // create first client
      const context1 = await config.createClient({
        serviceName: `${prefix}-isolation-1`,
      });
      const cache1 = context1.client.getInstrumentCache();

      // shutdown first client
      await config.teardownClient(context1);

      // create second client
      const context2 = await config.createClient({
        serviceName: `${prefix}-isolation-2`,
      });
      const cache2 = context2.client.getInstrumentCache();

      // verify caches are different instances
      expect(cache1).not.toBe(cache2);

      // cleanup
      await config.teardownClient(context2);
    });

    it("should not share cached instruments between client instances", async () => {
      // create first client and use a metric
      const context1 = await config.createClient({
        serviceName: `${prefix}-no-sharing`,
      });
      context1.client.metrics.increment("test_counter_instance_a", 1);

      const cache1 = context1.client.getInstrumentCache();
      const cache1Size = cache1.size;
      expect(cache1Size).toBeGreaterThan(0);

      // shutdown first client
      await config.teardownClient(context1);

      // create second client with different service name
      const context2 = await config.createClient({
        serviceName: `${prefix}-no-sharing-second`,
      });

      // second client's cache should be empty (no pollution)
      const cache2 = context2.client.getInstrumentCache();
      expect(cache2.size).toBe(0);

      // use different metric on second client
      context2.client.metrics.increment("test_counter_instance_b", 1);
      expect(cache2.size).toBeGreaterThan(0);

      // verify second client doesn't have first client's instrument
      const key1 = `service.${prefix}-no-sharing-second|counter|test_counter_instance_a`;
      expect(cache2.has(key1)).toBe(false);

      // cleanup
      await config.teardownClient(context2);
    });

    it("should configure cache size independently per client instance", async () => {
      // create client with custom cache size
      const context = await config.createClient({
        serviceName: `${prefix}-cache-config`,
        maxCachedInstruments: 500, // custom cache size
      });

      // get cache and verify it exists
      const cache = context.client.getInstrumentCache();
      expect(cache).toBeDefined();

      // create many instruments to test cache
      for (let i = 0; i < 10; i++) {
        context.client.metrics.increment(`test_counter_${i}`, 1);
      }

      // cache should have instruments
      expect(cache.size).toBe(10);

      // cleanup
      await config.teardownClient(context);
    });

    it("should prevent test pollution between client instances", async () => {
      // create first client
      const context1 = await config.createClient({
        serviceName: `${prefix}-pollution-test`,
      });

      // record initial cache state
      const initialCacheSize = context1.client.getInstrumentCache().size;

      // use some metrics
      context1.client.metrics.increment("pollution_test_1", 1);
      context1.client.metrics.gauge("pollution_test_2", 42);

      const cache1Size = context1.client.getInstrumentCache().size;
      expect(cache1Size).toBeGreaterThan(initialCacheSize);

      // shutdown first client
      await config.teardownClient(context1);

      // create new client
      const context2 = await config.createClient({
        serviceName: `${prefix}-no-pollution`,
      });

      // new client should start with empty cache
      const cache2 = context2.client.getInstrumentCache();
      expect(cache2.size).toBe(0);

      // verify no pollution from first client's instruments
      const pollutionKey1 = `service.${prefix}-no-pollution|counter|pollution_test_1`;
      const pollutionKey2 = `service.${prefix}-no-pollution|gauge|pollution_test_2`;
      expect(cache2.has(pollutionKey1)).toBe(false);
      expect(cache2.has(pollutionKey2)).toBe(false);

      // cleanup
      await config.teardownClient(context2);
    });
  });
}
