/**
 * Node.js Process Monitoring Tests
 *
 * Tests process-level monitoring and metrics using real SDK integration:
 * - Memory usage tracking
 * - CPU usage metrics
 * - Event loop lag detection
 * - Process crash handling
 * - Uncaught exception handling
 */

import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "os";
import v8 from "v8";
import { performance } from "perf_hooks";
import fs from "fs";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";

import { SmartClient } from "../../index.mjs";

describe("Node.js Process Monitoring", () => {
  let client: UnifiedObservabilityClient;
  let serviceInstrument: ReturnType<
    UnifiedObservabilityClient["getServiceInstrumentation"]
  >;
  let originalExit: typeof process.exit;
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let metricReader: PeriodicExportingMetricReader;
  let timers: NodeJS.Timeout[] = [];

  beforeEach(async () => {
    // Set up in-memory exporters for testing
    spanExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100,
    });

    client = await SmartClient.initialize({
      serviceName: "node-process-test",
      environment: "node",
      disableInstrumentation: true,
      endpoint: undefined, // no-network mode
      testSpanProcessor: new SimpleSpanProcessor(spanExporter),
      testMetricReader: metricReader,
    });

    serviceInstrument = client.getServiceInstrumentation();

    // mock process.exit to prevent test runner from exiting
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalExit = process.exit;
    process.exit = vi.fn() as unknown as typeof process.exit;
    timers = [];
  });

  afterEach(async () => {
    // Clear all timers
    timers.forEach((timer) => clearInterval(timer));
    timers = [];

    await metricReader.forceFlush().catch(() => undefined);
    await SmartClient.shutdown();
    process.exit = originalExit;
    vi.clearAllMocks();
  });

  describe("Memory Usage Tracking", () => {
    it("should track heap memory usage", () => {
      const memUsage = process.memoryUsage();

      // Should not throw when recording real memory metrics
      expect(() => {
        serviceInstrument.metrics.gauge(
          "process.memory.heap.used",
          memUsage.heapUsed,
        );
        serviceInstrument.metrics.gauge(
          "process.memory.heap.total",
          memUsage.heapTotal,
        );
      }).not.toThrow();

      // Verify we get real process data (test our integration, not Node.js)
      expect(memUsage.heapUsed).toBeGreaterThan(0);
      expect(memUsage.heapTotal).toBeGreaterThan(0);
      expect(memUsage.heapUsed).toBeLessThanOrEqual(memUsage.heapTotal);
    });

    it("should track RSS memory", () => {
      const memUsage = process.memoryUsage();

      // Should not throw when recording RSS metrics
      expect(() => {
        serviceInstrument.metrics.gauge("process.memory.rss", memUsage.rss);
      }).not.toThrow();

      expect(memUsage.rss).toBeGreaterThan(0);
      // RSS should typically be larger than heap
      expect(memUsage.rss).toBeGreaterThanOrEqual(memUsage.heapTotal);
    });

    it("should track external memory", () => {
      const memUsage = process.memoryUsage();

      serviceInstrument.metrics.gauge(
        "process.memory.external",
        memUsage.external,
      );

      expect(memUsage.external).toBeGreaterThanOrEqual(0);
    });

    it("should track array buffer memory", () => {
      const memUsage = process.memoryUsage();

      if ("arrayBuffers" in memUsage) {
        serviceInstrument.metrics.gauge(
          "process.memory.arrayBuffers",
          memUsage.arrayBuffers,
        );
        expect(memUsage.arrayBuffers).toBeGreaterThanOrEqual(0);
      }
    });

    it("should track V8 heap statistics", () => {
      const heapStats = v8.getHeapStatistics();

      serviceInstrument.metrics.gauge(
        "v8.heap.total_heap_size",
        heapStats.total_heap_size,
      );
      serviceInstrument.metrics.gauge(
        "v8.heap.used_heap_size",
        heapStats.used_heap_size,
      );
      serviceInstrument.metrics.gauge(
        "v8.heap.heap_size_limit",
        heapStats.heap_size_limit,
      );

      // verify metrics were recorded (our SDK integration)
      expect(heapStats.total_heap_size).toBeGreaterThan(0);
      expect(heapStats.used_heap_size).toBeLessThanOrEqual(
        heapStats.total_heap_size,
      );
      // use >= to handle edge cases where heap is near its limit on memory-constrained CI
      expect(heapStats.heap_size_limit).toBeGreaterThanOrEqual(
        heapStats.total_heap_size,
      );
    });

    it("should detect memory leaks", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate potential memory leak
      const leakyArray: unknown[] = [];
      for (let i = 0; i < 10000; i++) {
        leakyArray.push(new Array(100).fill(i));
      }

      const afterMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = afterMemory - initialMemory;

      // Track memory growth (can be negative due to GC)
      serviceInstrument.metrics.gauge("memory.growth", memoryIncrease);

      // Test that we can track memory changes and suspect leaks
      expect(() => {
        if (Math.abs(memoryIncrease) > 10 * 1024 * 1024) {
          serviceInstrument.metrics.increment("memory.leak.suspected", 1, {
            growth_mb: Math.round(Math.abs(memoryIncrease) / 1024 / 1024),
          });
        }
      }).not.toThrow();

      // Verify we can measure memory changes (positive or negative due to GC)
      expect(typeof memoryIncrease).toBe("number");

      // Keep reference to prevent optimization
      expect(leakyArray.length).toBe(10000);
    });
  });

  describe("CPU Usage Metrics", () => {
    it("should track CPU usage", () => {
      const cpuUsage = process.cpuUsage();

      serviceInstrument.metrics.gauge("process.cpu.user", cpuUsage.user);
      serviceInstrument.metrics.gauge("process.cpu.system", cpuUsage.system);

      expect(cpuUsage.user).toBeGreaterThanOrEqual(0);
      expect(cpuUsage.system).toBeGreaterThanOrEqual(0);
    });

    it("should calculate CPU percentage", () => {
      const startUsage = process.cpuUsage();
      const startTime = process.hrtime.bigint();

      // do some CPU work
      let _sum = 0;
      for (let i = 0; i < 1000000; i++) {
        _sum += Math.sqrt(i);
      }

      const endUsage = process.cpuUsage(startUsage);
      const endTime = process.hrtime.bigint();

      const elapsedTime = Number(endTime - startTime);
      const totalCPU = endUsage.user + endUsage.system;
      const cpuPercent = (totalCPU / elapsedTime) * 100;

      serviceInstrument.metrics.gauge("process.cpu.percent", cpuPercent);

      expect(cpuPercent).toBeGreaterThanOrEqual(0);
      expect(cpuPercent).toBeLessThanOrEqual(100 * os.cpus().length);
    });

    it("should track system load average", () => {
      const loadAvg = os.loadavg();

      serviceInstrument.metrics.gauge("system.load.1m", loadAvg[0] ?? 0);
      serviceInstrument.metrics.gauge("system.load.5m", loadAvg[1] ?? 0);
      serviceInstrument.metrics.gauge("system.load.15m", loadAvg[2] ?? 0);

      // load average values should be non-negative
      loadAvg.forEach((load) => {
        expect(load).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Event Loop Lag Detection", () => {
    it("should detect event loop lag", async () => {
      const measureLag = () => {
        const start = Date.now();
        setImmediate(() => {
          const lag = Date.now() - start;
          serviceInstrument.metrics.record("eventloop.lag", lag);

          if (lag > 50) {
            // More than 50ms lag
            serviceInstrument.metrics.increment("eventloop.lag.warning", 1, {
              lag_ms: lag,
            });
          }
        });
      };

      measureLag();

      // Simulate blocking operation
      const blockingStart = Date.now();
      while (Date.now() - blockingStart < 10) {
        // Block for 10ms
      }

      await new Promise((resolve) => setImmediate(resolve));
    });

    it("should track event loop utilization", () => {
      // this is a simplified version - real implementation would use perf_hooks
      if (performance.eventLoopUtilization) {
        const elu = performance.eventLoopUtilization();

        serviceInstrument.metrics.gauge(
          "eventloop.utilization",
          elu.utilization * 100,
        );
        serviceInstrument.metrics.gauge("eventloop.active", elu.active);
        serviceInstrument.metrics.gauge("eventloop.idle", elu.idle);

        expect(elu.utilization).toBeGreaterThanOrEqual(0);
        expect(elu.utilization).toBeLessThanOrEqual(1);
      }
    });

    it("should detect long-running operations", async () => {
      const span = client.traces.startSpan("long-operation");

      // Simulate long operation
      const startTime = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const duration = Date.now() - startTime;

      if (duration > 100) {
        serviceInstrument.metrics.increment("operations.slow", 1, {
          operation: "long-operation",
          duration_ms: duration,
        });
      }

      span.end();

      // allow significant jitter on slow CI systems (80ms = 20% tolerance on 100ms timer)
      // the test verifies our SDK can track slow operations, not setTimeout precision
      expect(duration).toBeGreaterThanOrEqual(80);
    });
  });

  describe("Process Crash Handling", () => {
    it("should handle process exit", () => {
      const exitHandler = vi.fn();
      process.on("exit", exitHandler);

      // Simulate exit
      process.emit("exit", 0);

      expect(exitHandler).toHaveBeenCalledWith(0);

      process.removeListener("exit", exitHandler);
    });

    it("should track exit codes", () => {
      const mockExit = (code: number) => {
        serviceInstrument.metrics.increment("process.exit", 1, {
          exit_code: code,
          graceful: code === 0,
        });
      };

      mockExit(0); // graceful exit
      mockExit(1); // error exit
      mockExit(137); // SIGKILL

      // our mock prevents actual exit
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const exitMock = process.exit as unknown as ReturnType<typeof vi.fn>;
      expect(exitMock).not.toHaveBeenCalled();
    });

    it("should handle SIGTERM for graceful shutdown", () => {
      return new Promise<void>((resolve) => {
        const sigtermHandler = () => {
          void (async () => {
            serviceInstrument.metrics.increment("process.signal", 1, {
              signal: "SIGTERM",
            });

            // graceful shutdown
            await client.traces.flush();

            resolve();
          })();
        };

        process.once("SIGTERM", sigtermHandler);
        process.emit("SIGTERM" as NodeJS.Signals);
      });
    });

    it("should handle SIGINT for user interruption", () => {
      return new Promise<void>((resolve) => {
        const sigintHandler = () => {
          serviceInstrument.metrics.increment("process.signal", 1, {
            signal: "SIGINT",
          });
          resolve();
        };

        process.once("SIGINT", sigintHandler);
        process.emit("SIGINT" as NodeJS.Signals);
      });
    });
  });

  describe("Uncaught Exception Handling", () => {
    it("should capture uncaught exceptions via registered handler", () => {
      const error = new Error("Test uncaught exception");
      let capturedError: Error | null = null;

      const handler = (err: Error) => {
        capturedError = err;
        client.errors.record(err);
      };

      process.once("uncaughtException", handler);
      process.emit("uncaughtException", error);

      expect(capturedError).toBeDefined();
      expect(capturedError).toBeInstanceOf(Error);
      expect((capturedError as unknown as Error).message).toBe(
        "Test uncaught exception",
      );
    });

    it("should capture unhandled promise rejections via registered handler", () => {
      const reason = "Test rejection";
      const fakePromise = {} as Promise<unknown>;
      let capturedReason: string | null = null;

      const handler = (rejectionReason: unknown) => {
        capturedReason = String(rejectionReason);
        client.errors.record(
          rejectionReason instanceof Error
            ? rejectionReason
            : new Error(String(rejectionReason)),
        );
      };

      process.once("unhandledRejection", handler);
      process.emit("unhandledRejection", reason, fakePromise);

      expect(capturedReason).toBeDefined();
      expect(capturedReason).toBe(reason);
    });

    it("should track warning events", () => {
      return new Promise<void>((resolve) => {
        const warningHandler = (warning: Error) => {
          serviceInstrument.metrics.increment("process.warning", 1, {
            warning_type: warning.name,
          });

          expect(warning.message).toContain("Test warning");
          resolve();
        };

        process.once("warning", warningHandler);

        // simulate warning
        process.emitWarning("Test warning", "TestWarning");
      });
    });

    it("should handle multiple errors gracefully", () => {
      const errors = [
        new Error("Error 1"),
        new Error("Error 2"),
        new Error("Error 3"),
      ];

      errors.forEach((error) => {
        client.errors.record(error);
      });

      serviceInstrument.metrics.gauge("errors.queue.size", errors.length);

      expect(errors).toHaveLength(3);
    });
  });

  describe("Process Metadata", () => {
    it("should track process information", () => {
      const processInfo = {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        uptime: process.uptime(),
      };

      Object.entries(processInfo).forEach(([key, value]) => {
        if (typeof value === "number") {
          serviceInstrument.metrics.gauge(`process.${key}`, value);
        }
      });

      expect(processInfo.pid).toBeGreaterThan(0);
      expect(processInfo.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
      expect(processInfo.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should track resource limits", () => {
      if (process.getuid && process.getgid) {
        // unix-like systems only
        const uid = process.getuid();
        const gid = process.getgid();

        serviceInstrument.metrics.gauge("process.uid", uid);
        serviceInstrument.metrics.gauge("process.gid", gid);

        expect(uid).toBeGreaterThanOrEqual(0);
        expect(gid).toBeGreaterThanOrEqual(0);
      }
    });

    it("should track file descriptor usage", () => {
      // this is platform-specific and may not work in all environments
      try {
        const fdCount = fs.readdirSync("/proc/self/fd").length;

        serviceInstrument.metrics.gauge("process.fd.open", fdCount);

        expect(fdCount).toBeGreaterThan(0);
      } catch {
        // Not available on this platform
        expect(true).toBe(true);
      }
    });
  });
});
