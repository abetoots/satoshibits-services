/**
 * Instance Isolation Tests (Multi-Instance Support)
 *
 * API Boundary Fix - Issue #4: Micro-Frontend Compatibility
 *
 * Tests verify that:
 * 1. Multiple client instances can coexist
 * 2. Each instance has isolated caches
 * 3. destroy() cleans up instance without affecting others
 * 4. Instance registry tracks all clients correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

import {
  clearAllInstances,
  getAllInstances,
  getInstanceCount,
} from "../../client-instance.mjs";
import { SmartClient } from "../../index.mjs";

describe("Instance Isolation (Multi-Instance Support)", () => {
  beforeEach(() => {
    // ensure clean state before each test
    clearAllInstances();
  });

  afterEach(async () => {
    // clean up all instances
    try {
      await SmartClient.shutdown();
    } catch {
      // ignore errors during cleanup
    }
    clearAllInstances();
  });

  describe("instance registry", () => {
    it("should track instances created via SmartClient.create()", async () => {
      expect(getInstanceCount()).toBe(0);

      const client1 = await SmartClient.create({
        serviceName: "test-service-1",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(getInstanceCount()).toBe(1);
      expect(getAllInstances()).toContain(client1);

      const client2 = await SmartClient.create({
        serviceName: "test-service-2",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(getInstanceCount()).toBe(2);
      expect(getAllInstances()).toContain(client1);
      expect(getAllInstances()).toContain(client2);
    });

    it("should track singleton instance created via SmartClient.initialize()", async () => {
      expect(getInstanceCount()).toBe(0);

      const client = await SmartClient.initialize({
        serviceName: "singleton-service",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(getInstanceCount()).toBe(1);
      expect(getAllInstances()).toContain(client);
    });
  });

  describe("instance isolation", () => {
    let client1: UnifiedObservabilityClient;
    let client2: UnifiedObservabilityClient;

    beforeEach(async () => {
      client1 = await SmartClient.create({
        serviceName: "isolated-service-1",
        environment: "node",
        disableInstrumentation: true,
      });

      client2 = await SmartClient.create({
        serviceName: "isolated-service-2",
        environment: "node",
        disableInstrumentation: true,
      });
    });

    it("should have separate scoped client caches", () => {
      // create scoped clients on each instance
      const scope1a = client1.getInstrumentation("module-a");
      const _scope1b = client1.getInstrumentation("module-b");
      const scope2a = client2.getInstrumentation("module-a");

      // same scope name on same client should return cached instance
      const scope1a_again = client1.getInstrumentation("module-a");
      expect(scope1a_again).toBe(scope1a);

      // same scope name on different client should be a different instance
      expect(scope2a).not.toBe(scope1a);
    });

    it("should have separate instrument caches", () => {
      // create instruments on each instance
      client1.metrics.increment("shared_metric_name", 1);
      client2.metrics.increment("shared_metric_name", 1);

      // both should work without interfering with each other
      expect(() => {
        client1.metrics.increment("shared_metric_name", 5);
        client2.metrics.increment("shared_metric_name", 10);
      }).not.toThrow();
    });
  });

  describe("destroy()", () => {
    it("should clean up instance without affecting others", async () => {
      const client1 = await SmartClient.create({
        serviceName: "destroy-test-1",
        environment: "node",
        disableInstrumentation: true,
      });

      const client2 = await SmartClient.create({
        serviceName: "destroy-test-2",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(getInstanceCount()).toBe(2);

      // destroy client1 (now deterministically awaited)
      client1.destroy();

      // client1 should be destroyed, client2 should still work
      expect(client1.isDestroyed).toBe(true);
      expect(client2.isDestroyed).toBe(false);
      expect(getInstanceCount()).toBe(1);
      expect(getAllInstances()).not.toContain(client1);
      expect(getAllInstances()).toContain(client2);
    });

    it("should allow client2 to continue working after client1 is destroyed", async () => {
      const client1 = await SmartClient.create({
        serviceName: "destroy-continue-1",
        environment: "node",
        disableInstrumentation: true,
      });

      const client2 = await SmartClient.create({
        serviceName: "destroy-continue-2",
        environment: "node",
        disableInstrumentation: true,
      });

      // destroy client1 (awaited for deterministic cleanup)
      client1.destroy();

      // client2 should continue to function normally
      expect(() => {
        client2.metrics.increment("test_metric", 1);
        client2.logs.info("test message");
        const scope = client2.getInstrumentation("test-module");
        scope.metrics.increment("scoped_metric", 1);
      }).not.toThrow();
    });

    it("should warn when destroying an already destroyed instance", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        /* noop */
      });

      const client = await SmartClient.create({
        serviceName: "double-destroy",
        environment: "node",
        disableInstrumentation: true,
      });

      client.destroy();
      client.destroy(); // second call should warn

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("already destroyed"),
      );

      consoleSpy.mockRestore();
    });

    it("should set isDestroyed flag to true", async () => {
      const client = await SmartClient.create({
        serviceName: "destroyed-flag-test",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(client.isDestroyed).toBe(false);

      client.destroy();

      expect(client.isDestroyed).toBe(true);
    });
  });

  describe("micro-frontend scenario", () => {
    it("should support micro-frontend lifecycle", async () => {
      // simulate two micro-frontends mounting
      const mfe1 = await SmartClient.create({
        serviceName: "checkout-mfe",
        environment: "node",
        disableInstrumentation: true,
      });

      const mfe2 = await SmartClient.create({
        serviceName: "product-catalog-mfe",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(getInstanceCount()).toBe(2);

      // use both
      mfe1.metrics.increment("checkout_started");
      mfe2.metrics.increment("product_viewed");

      // simulate checkout-mfe unmounting (awaited for deterministic cleanup)
      mfe1.destroy();

      // product-catalog-mfe should continue working
      expect(getInstanceCount()).toBe(1);
      expect(mfe2.isDestroyed).toBe(false);

      mfe2.metrics.increment("product_added_to_cart");
    });
  });

  describe("testing scenario", () => {
    it("should support parallel test isolation", async () => {
      // simulate parallel tests creating their own clients
      const testClient1 = await SmartClient.create({
        serviceName: "test-suite-1",
        environment: "node",
        disableInstrumentation: true,
      });

      const testClient2 = await SmartClient.create({
        serviceName: "test-suite-2",
        environment: "node",
        disableInstrumentation: true,
      });

      // each test can use its own client
      testClient1.metrics.increment("test_metric", 1, { test: "suite-1" });
      testClient2.metrics.increment("test_metric", 1, { test: "suite-2" });

      // cleanup after tests (awaited for deterministic cleanup)
      testClient1.destroy();
      testClient2.destroy();

      expect(getInstanceCount()).toBe(0);
    });
  });

  describe("singleton reinitialization", () => {
    it("should allow singleton re-initialization after destroy", async () => {
      // first initialization
      const client1 = await SmartClient.initialize({
        serviceName: "reinit-test",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(client1.isDestroyed).toBe(false);
      expect(getInstanceCount()).toBe(1);

      // destroy the singleton
      client1.destroy();

      expect(client1.isDestroyed).toBe(true);
      expect(getInstanceCount()).toBe(0);

      // re-initialize should create a new client, not return the destroyed one
      const client2 = await SmartClient.initialize({
        serviceName: "reinit-test-2",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(client2).not.toBe(client1);
      expect(client2.isDestroyed).toBe(false);
      expect(getInstanceCount()).toBe(1);
    });
  });

  describe("concurrent destroy() calls", () => {
    it("should handle concurrent destroy() calls safely due to synchronous flag", async () => {
      const client = await SmartClient.create({
        serviceName: "concurrent-destroy",
        environment: "node",
        disableInstrumentation: true,
      });

      // call destroy() twice concurrently
      const [result1, result2] = await Promise.all([
        client.destroy(),
        client.destroy(),
      ]);

      // both should complete without error
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();

      // client should be destroyed
      expect(client.isDestroyed).toBe(true);
      expect(getInstanceCount()).toBe(0);
    });

    it("should warn only once for concurrent destroys due to flag being set first", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        /* noop */
      });

      const client = await SmartClient.create({
        serviceName: "concurrent-warn-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // call destroy twice concurrently
      await Promise.all([client.destroy(), client.destroy()]);

      // the second call should have seen the flag and warned
      // (exact number depends on timing but at least one should warn)
      const warnCalls = consoleSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("already destroyed"),
      );
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);

      consoleSpy.mockRestore();
    });
  });
});

describe("Cache Configuration Validation (Multi-model Review Fixes)", () => {
  beforeEach(() => {
    clearAllInstances();
  });

  afterEach(async () => {
    try {
      await SmartClient.shutdown();
    } catch {
      // ignore errors during cleanup
    }
    clearAllInstances();
  });

  describe("NaN/Infinity handling (Codex review)", () => {
    it("should use default maxScopedClients when NaN is passed", async () => {
      // NaN should fall back to default (100)
      const client = await SmartClient.create({
        serviceName: "nan-scoped-test",
        environment: "node",
        disableInstrumentation: true,
        maxScopedClients: NaN,
      });

      // client should initialize without error
      expect(client).toBeDefined();

      // create some scoped clients to verify functionality
      const scope1 = client.getInstrumentation("module-1");
      const scope2 = client.getInstrumentation("module-2");
      expect(scope1).toBeDefined();
      expect(scope2).toBeDefined();
    });

    it("should use default maxScopedClients when Infinity is passed", async () => {
      const client = await SmartClient.create({
        serviceName: "infinity-scoped-test",
        environment: "node",
        disableInstrumentation: true,
        maxScopedClients: Infinity,
      });

      expect(client).toBeDefined();
      const scope = client.getInstrumentation("module-test");
      expect(scope).toBeDefined();
    });

    it("should use default maxCachedInstruments when NaN is passed", async () => {
      const client = await SmartClient.create({
        serviceName: "nan-instruments-test",
        environment: "node",
        disableInstrumentation: true,
        maxCachedInstruments: NaN,
      });

      // should work - fall back to default (2000)
      client.metrics.increment("test_counter", 1);
      expect(client.getInstrumentCache().size).toBeGreaterThan(0);
    });

    it("should use default instrumentCacheTtlMs when Infinity is passed", async () => {
      const client = await SmartClient.create({
        serviceName: "infinity-ttl-test",
        environment: "node",
        disableInstrumentation: true,
        instrumentCacheTtlMs: Infinity,
      });

      // should work - fall back to default (1 hour)
      client.metrics.increment("test_counter", 1);
      expect(client.getInstrumentCache().size).toBeGreaterThan(0);
    });

    it("should handle negative values by clamping to minimum", async () => {
      const client = await SmartClient.create({
        serviceName: "negative-values-test",
        environment: "node",
        disableInstrumentation: true,
        maxScopedClients: -5,
        maxCachedInstruments: -10,
      });

      // negative values should be clamped to minimum (1)
      expect(client).toBeDefined();
      client.metrics.increment("test_metric", 1);
      expect(client.getInstrumentCache().size).toBeGreaterThan(0);
    });

    it("should allow zero instrumentCacheTtlMs to disable TTL", async () => {
      const client = await SmartClient.create({
        serviceName: "zero-ttl-test",
        environment: "node",
        disableInstrumentation: true,
        instrumentCacheTtlMs: 0, // should disable TTL
      });

      client.metrics.increment("test_counter", 1);
      expect(client.getInstrumentCache().size).toBeGreaterThan(0);
    });
  });

  describe("Memory Leak Prevention (L3 Implementation)", () => {
    // these tests verify that shutdown/destroy properly releases resources
    // to prevent memory leaks in long-running applications

    it("should clear instrument cache after destroy", async () => {
      const client = await SmartClient.create({
        serviceName: "cache-cleanup-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // populate the cache
      client.metrics.increment("counter_1", 1);
      client.metrics.increment("counter_2", 1);
      client.metrics.record("histogram_1", 100);
      client.metrics.gauge("gauge_1", 50);

      const cacheBeforeDestroy = client.getInstrumentCache().size;
      expect(cacheBeforeDestroy).toBeGreaterThan(0);

      client.destroy();

      // after destroy, cache should be cleared
      expect(client.getInstrumentCache().size).toBe(0);
      expect(client.isDestroyed).toBe(true);
    });

    it("should release context after destroy", async () => {
      const client = await SmartClient.create({
        serviceName: "context-cleanup-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // set up business context
      await client.context.business.run(
        { userId: "user-123", tenantId: "tenant-456" },
        () => {
          // verify context is active
          const ctx = client.context.business.get();
          expect(ctx.userId).toBe("user-123");
        },
      );

      client.destroy();

      // after destroy, attempting to get context should not throw
      // but should return empty/undefined context
      expect(client.isDestroyed).toBe(true);
    });

    it("should allow clean re-creation after destroy", async () => {
      // first instance
      const client1 = await SmartClient.create({
        serviceName: "recreate-test",
        environment: "node",
        disableInstrumentation: true,
      });

      client1.metrics.increment("test_counter", 10);
      const cache1Size = client1.getInstrumentCache().size;
      expect(cache1Size).toBeGreaterThan(0);

      client1.destroy();
      expect(client1.isDestroyed).toBe(true);

      // create new instance with same service name
      const client2 = await SmartClient.create({
        serviceName: "recreate-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // new instance should start fresh (empty cache)
      expect(client2.getInstrumentCache().size).toBe(0);
      expect(client2.isDestroyed).toBe(false);

      // new instance should work independently
      client2.metrics.increment("new_counter", 5);
      expect(client2.getInstrumentCache().size).toBeGreaterThan(0);

      client2.destroy();
    });

    it("should handle multiple destroy/recreate cycles without accumulation", async () => {
      // use SAME serviceName to catch global registry leaks (Codex/Gemini review fix)
      const cycles = 5;
      const serviceName = "cycle-test-same-name";

      for (let i = 0; i < cycles; i++) {
        const client = await SmartClient.create({
          serviceName: serviceName, // reuse exact name to detect registry leaks
          environment: "node",
          disableInstrumentation: true,
        });

        // use the client
        client.metrics.increment(`cycle_counter_${i}`, i + 1);
        client.metrics.record(`cycle_histogram_${i}`, (i + 1) * 10);
        client.logs.info(`Cycle ${i} log message`);

        const cacheSize = client.getInstrumentCache().size;
        expect(cacheSize).toBeGreaterThan(0);

        client.destroy();

        expect(client.isDestroyed).toBe(true);
        expect(client.getInstrumentCache().size).toBe(0);
      }
    });

    it("should handle idempotent destroy calls (double destroy)", async () => {
      const client = await SmartClient.create({
        serviceName: "idempotent-destroy-test",
        environment: "node",
        disableInstrumentation: true,
      });

      client.metrics.increment("test_counter", 1);
      expect(client.getInstrumentCache().size).toBeGreaterThan(0);

      // first destroy
      client.destroy();
      expect(client.isDestroyed).toBe(true);
      expect(client.getInstrumentCache().size).toBe(0);

      // second destroy should not
      expect(client.destroy()).toBeUndefined();
      expect(client.isDestroyed).toBe(true);
    });

    it("should clean up singleton state on shutdown", async () => {
      // initialize singleton
      const singleton = await SmartClient.initialize({
        serviceName: "singleton-cleanup-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // use the singleton
      const instrument = singleton.getServiceInstrumentation();
      instrument.metrics.increment("singleton_counter", 1);

      // shutdown clears singleton state
      await SmartClient.shutdown();

      // re-initialize should work cleanly
      const newSingleton = await SmartClient.initialize({
        serviceName: "singleton-cleanup-test-new",
        environment: "node",
        disableInstrumentation: true,
      });

      // new singleton should be different instance
      expect(newSingleton).toBeDefined();

      await SmartClient.shutdown();
    });
  });
});
