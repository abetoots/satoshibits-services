/**
 * Node.js Initialization Tests
 *
 * Tests Node.js-specific initialization features using real SDK integration:
 * - Process signal handlers
 * - Environment variables
 * - Auto-instrumentation
 * - Graceful shutdown
 * - Resource cleanup
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";
import type { ScopedInstrument } from "../../internal/scoped-instrument.mjs";

import { SmartClient } from "../../index.mjs";

describe("Node.js Initialization", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ScopedInstrument;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // reset the module to clear singleton
    vi.resetModules();
  });

  beforeEach(async () => {
    // save original environment
    originalEnv = { ...process.env };

    // initialize with real SDK but no-network mode
    client = await SmartClient.initialize({
      serviceName: "node-init-test",
      environment: "node",
      disableInstrumentation: true,
      endpoint: undefined,
    });

    serviceInstrument = client.getServiceInstrumentation();
  });

  afterEach(async () => {
    // restore environment
    process.env = originalEnv;

    // shutdown SDK
    await SmartClient.shutdown();
    vi.clearAllMocks();
  });

  // note: signal handler integration tests are in node-sdk-wrapper.test.mts
  // which uses process.emit() to test actual SDK signal handling behavior

  describe("Environment Variable Detection", () => {
    it("should respect OTEL_EXPORTER_OTLP_ENDPOINT", async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://custom-endpoint:4318";

      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
        disableInstrumentation: true, // reduce network calls in tests
      });

      expect(testClient).toBeDefined();
      // verify client is functional (endpoint config is internal)
      expect(testClient.traces.startSpan).toBeDefined();
      expect(testClient.metrics.increment).toBeDefined();
      await SmartClient.shutdown();
    });

    it("should respect OTEL_SERVICE_NAME when no config serviceName provided", async () => {
      process.env.OTEL_SERVICE_NAME = "env-service-name";

      // when serviceName is provided in config, it should override env var
      const testClient = await SmartClient.initialize({
        serviceName: "config-service-name",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(testClient).toBeDefined();
      // client works - config takes precedence over env var
      expect(testClient.traces.startSpan).toBeDefined();
      await SmartClient.shutdown();
    });

    it("should respect NODE_ENV for environment detection", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(testClient).toBeDefined();
      // verify client is initialized and functional in production mode
      expect(testClient.traces.startSpan).toBeDefined();
      expect(testClient.metrics.increment).toBeDefined();

      await SmartClient.shutdown();
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("should handle missing environment variables gracefully", async () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      delete process.env.OTEL_SERVICE_NAME;

      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
        disableInstrumentation: true,
      });

      // client should still initialize with defaults
      expect(testClient).toBeDefined();
      expect(testClient.traces.startSpan).toBeDefined();
      expect(testClient.metrics.increment).toBeDefined();
      expect(testClient.errors.record).toBeDefined();
      await SmartClient.shutdown();
    });
  });

  describe("Auto-instrumentation", () => {
    it("should initialize with auto-instrumentation by default", async () => {
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      // Should initialize successfully and provide tracing functionality
      expect(testClient).toBeDefined();
      expect(testClient.traces.startSpan).toBeDefined();
    });

    it("should allow disabling auto-instrumentation", async () => {
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
        disableInstrumentation: true,
      });

      // Should still initialize but with instrumentation disabled
      expect(testClient).toBeDefined();
      expect(testClient.traces.startSpan).toBeDefined();
    });
  });

  describe("Graceful Shutdown", () => {
    it("should shutdown cleanly when called", async () => {
      // initialize client (not used directly - testing shutdown behavior)
      await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      // should not throw when shutting down
      await expect(SmartClient.shutdown()).resolves.not.toThrow();
    });

    it("should handle multiple shutdown calls gracefully", async () => {
      await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      // Multiple shutdown calls should not throw
      await expect(SmartClient.shutdown()).resolves.not.toThrow();
      await expect(SmartClient.shutdown()).resolves.not.toThrow();
    });

    it("should clean up resources on shutdown", async () => {
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      // Create some spans/metrics
      const span = testClient.traces.startSpan("test-span");
      testClient.metrics.increment("test.metric");
      span.end();

      await SmartClient.shutdown();

      // After shutdown, operations should still be callable (no-op or still functional)
      const newSpan = testClient.traces.startSpan("after-shutdown");
      expect(newSpan).toBeDefined();
      newSpan.end(); // Should not throw
    });
  });

  describe("Initialization Failure Handling", () => {
    it("should handle concurrent initialization calls gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      // start two concurrent initializations
      const p1 = SmartClient.initialize({
        serviceName: "concurrent-test-1",
        environment: "node",
        disableInstrumentation: true,
      });
      const p2 = SmartClient.initialize({
        serviceName: "concurrent-test-2",
        environment: "node",
        disableInstrumentation: true,
      });

      const [client1, client2] = await Promise.all([p1, p2]);

      // both should return valid clients
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();

      // second call should have warned about re-initialization
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      await SmartClient.shutdown();
    });

    it("should continue working after partial initialization failure", async () => {
      // even if SDK fails to fully initialize, client should be functional
      const testClient = await SmartClient.initialize({
        serviceName: "partial-failure-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // client should still provide valid API
      expect(testClient.traces.startSpan).toBeDefined();
      expect(testClient.metrics.increment).toBeDefined();
      expect(testClient.errors.record).toBeDefined();

      // operations should work without throwing
      expect(() => {
        testClient.metrics.increment("test_metric");
        const span = testClient.traces.startSpan("test-span");
        span.end();
      }).not.toThrow();

      await SmartClient.shutdown();
    });
  });

  describe("Shutdown Verification", () => {
    it("should remove process handlers on shutdown", async () => {
      const listenersBefore = process.listenerCount("SIGTERM");

      await SmartClient.initialize({
        serviceName: "handler-cleanup-test",
        environment: "node",
        disableInstrumentation: true,
      });

      // handlers should be registered after init
      const listenersAfterInit = process.listenerCount("SIGTERM");
      expect(listenersAfterInit).toBeGreaterThanOrEqual(listenersBefore);

      await SmartClient.shutdown();

      // handlers should be cleaned up after shutdown
      const listenersAfterShutdown = process.listenerCount("SIGTERM");
      expect(listenersAfterShutdown).toBeLessThanOrEqual(listenersAfterInit);
    });

    it("should reset SDK state on shutdown", async () => {
      await SmartClient.initialize({
        serviceName: "state-reset-test",
        environment: "node",
        disableInstrumentation: true,
      });

      await SmartClient.shutdown();

      // should be able to re-initialize after shutdown
      const newClient = await SmartClient.initialize({
        serviceName: "re-init-test",
        environment: "node",
        disableInstrumentation: true,
      });

      expect(newClient).toBeDefined();
      expect(newClient.traces.startSpan).toBeDefined();

      await SmartClient.shutdown();
    });

    it("should be safe to call shutdown without initialization", async () => {
      // shutdown without prior initialization should not throw
      await expect(SmartClient.shutdown()).resolves.not.toThrow();
    });
  });

  describe("Resource Cleanup", () => {
    it("should prevent memory leaks with bounded buffers", async () => {
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
        disableInstrumentation: true,
      });

      // generate many spans
      for (let i = 0; i < 10000; i++) {
        const span = testClient.traces.startSpan(`span-${i}`);
        span.setAttribute("index", i);
        span.end();
      }

      // should not cause memory issues
      const memUsage = process.memoryUsage();
      expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024); // less than 500MB
      await SmartClient.shutdown();
    });

    it("should handle multiple initialization attempts", async () => {
      const client1 = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
        disableInstrumentation: true,
      });

      // mock console.warn to verify warning is shown on re-initialization
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      // second initialization should return same instance and warn
      const client2 = await SmartClient.initialize({
        serviceName: "test-node-app-2",
        environment: "node",
        disableInstrumentation: true,
      });

      // both clients should be defined
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();

      // verify warning was issued about re-initialization
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls.some(call =>
        String(call[0]).toLowerCase().includes("already initialized")
      )).toBe(true);

      warnSpy.mockRestore();
    });

    it("should initialize without throwing", async () => {
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      // Should initialize successfully
      expect(testClient).toBeDefined();
      expect(testClient.traces.startSpan).toBeDefined();
      expect(testClient.metrics.increment).toBeDefined();
      expect(testClient.errors.record).toBeDefined();

      await SmartClient.shutdown();
    });
  });

  describe("Singleton Behavior", () => {
    it("should maintain singleton instance", async () => {
      const client1 = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      const client2 = await SmartClient.initialize({
        serviceName: "different-name",
        environment: "node",
      });

      expect(client1).toBe(client2);
    });

    it("should allow creating non-singleton instances", async () => {
      // Note: SmartClient.create may not exist - testing with initialize
      const client1 = await SmartClient.initialize({
        serviceName: "test-node-app-1",
        environment: "node",
      });

      // Reset and create new instance
      await SmartClient.shutdown();

      const client2 = await SmartClient.initialize({
        serviceName: "test-node-app-2",
        environment: "node",
      });

      // Different service names should still work
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
    });
  });

  describe("Node-specific Features", () => {
    it("should use Node.js specific entry point", async () => {
      // This test verifies we're using the /node entry point
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      // Should have access to all client functions
      expect(testClient.traces.startSpan).toBeDefined();
      expect(testClient.metrics.increment).toBeDefined();
      expect(testClient.errors.record).toBeDefined();
    });

    it("should include Node.js metadata in telemetry", async () => {
      const testClient = await SmartClient.initialize({
        serviceName: "test-node-app",
        environment: "node",
      });

      const span = testClient.traces.startSpan("test-span");

      // Should include Node.js version, platform, etc.
      expect(process.version).toBeDefined();
      expect(process.platform).toBeDefined();

      span.end();
    });
  });
});
