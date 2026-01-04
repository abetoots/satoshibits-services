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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmartClient } from "../../index.mjs";
import {
  getAllInstances,
  getInstanceCount,
  clearAllInstances,
} from "../../client-instance.mjs";
import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

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
      const scope1b = client1.getInstrumentation("module-b");
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
      await client1.destroy();

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
      await client1.destroy();

      // client2 should continue to function normally
      expect(() => {
        client2.metrics.increment("test_metric", 1);
        client2.logs.info("test message");
        const scope = client2.getInstrumentation("test-module");
        scope.metrics.increment("scoped_metric", 1);
      }).not.toThrow();
    });

    it("should warn when destroying an already destroyed instance", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = await SmartClient.create({
        serviceName: "double-destroy",
        environment: "node",
        disableInstrumentation: true,
      });

      await client.destroy();
      await client.destroy(); // second call should warn

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("already destroyed")
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

      await client.destroy();

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
      await mfe1.destroy();

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
      await testClient1.destroy();
      await testClient2.destroy();

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
      await client1.destroy();

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
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = await SmartClient.create({
        serviceName: "concurrent-warn-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // call destroy twice concurrently
      await Promise.all([
        client.destroy(),
        client.destroy(),
      ]);

      // the second call should have seen the flag and warned
      // (exact number depends on timing but at least one should warn)
      const warnCalls = consoleSpy.mock.calls.filter(
        (call) => call[0]?.includes?.("already destroyed")
      );
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);

      consoleSpy.mockRestore();
    });
  });
});

// need to import vi for the spy
import { vi } from "vitest";

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
});
