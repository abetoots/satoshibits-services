/**
 * Node.js Context Propagation Tests
 *
 * Tests context management in Node.js environments:
 * - AsyncLocalStorage context propagation
 * - Context across async boundaries
 * - Worker threads context
 * - Cluster context sharing
 *
 * M2 Note: These tests REQUIRE real timers to verify actual AsyncLocalStorage
 * context propagation across async boundaries. Using fake timers would defeat
 * the purpose of these tests as they test real Node.js async behavior.
 *
 * To minimize CI flakiness, we use slightly increased timeout values (50ms
 * instead of 5-10ms) to provide buffer against CI load variance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cluster from "cluster";
import { setTimeout as setTimeoutPromise } from "timers/promises";

import type { UnifiedObservabilityClient } from "../../unified-smart-client.mjs";
import type { TestContext } from "../test-utils/setup-helpers.mjs";

import { SmartClient } from "../../index.mjs";
import { runSharedContextAPITests } from "../test-utils/context-api-tests.mjs";
import { runInstanceIsolationTests } from "../test-utils/instance-isolation-tests.mjs";
import {
  setupNodeTestClient,
  teardownTestClient,
} from "../test-utils/setup-helpers.mjs";

describe("Node.js Context Management", () => {
  let testContext: TestContext;
  let client: UnifiedObservabilityClient;

  beforeEach(async () => {
    // set up in-memory exporters for testing
    // NOTE: Uses real timers to test actual AsyncLocalStorage context propagation
    testContext = await setupNodeTestClient({
      serviceName: "test-context",
    });
    client = testContext.client;
  });

  afterEach(async () => {
    await teardownTestClient(testContext);
    vi.clearAllMocks();
  });

  describe("AsyncLocalStorage Context Propagation", () => {
    it("should maintain context across async operations", async () => {
      await client.context.business.run(
        {
          userId: "user-123",
          tenantId: "tenant-456",
          requestId: "req-789",
        },
        async () => {
          // Context should be available here
          const ctx1 = client.context.business.get();
          expect(ctx1.userId).toBe("user-123");
          expect(ctx1.tenantId).toBe("tenant-456");

          // wait for async operation (M2: increased to 50ms for CI stability)
          await setTimeoutPromise(50);

          // Context should still be available
          const ctx2 = client.context.business.get();
          expect(ctx2.userId).toBe("user-123");
          expect(ctx2.requestId).toBe("req-789");
        },
      );
    });

    it("should isolate context between different async chains", async () => {
      const results: Record<string, unknown>[] = [];

      // start two parallel async chains with different contexts
      // M2: using real timers with increased delays for CI stability
      const chain1 = client.context.business.run(
        { userId: "user-1" },
        async () => {
          await setTimeoutPromise(25);
          results.push(client.context.business.get());
        },
      );

      const chain2 = client.context.business.run(
        { userId: "user-2" },
        async () => {
          await setTimeoutPromise(50);
          results.push(client.context.business.get());
        },
      );

      await Promise.all([chain1, chain2]);

      // each chain should have its own context
      expect(results[0]!.userId).toBe("user-1");
      expect(results[1]!.userId).toBe("user-2");
    });

    it("should propagate context through Promise chains", async () => {
      await client.context.business.run({ requestId: "req-123" }, async () => {
        const result = await Promise.resolve()
          .then(() => {
            expect(client.context.business.get().requestId).toBe("req-123");
            return "step1";
          })
          .then((val) => {
            expect(client.context.business.get().requestId).toBe("req-123");
            return val + "-step2";
          })
          .then((val) => {
            expect(client.context.business.get().requestId).toBe("req-123");
            return val + "-step3";
          });

        expect(result).toBe("step1-step2-step3");
      });
    });

    it("should handle nested context runs", async () => {
      await client.context.business.run(
        { level: 1, userId: "user-1" },
        async () => {
          expect(client.context.business.get().level).toBe(1);

          await client.context.business.run(
            { level: 2, sessionId: "session-2" },
            async () => {
              const ctx = client.context.business.get();
              expect(ctx.level).toBe(2);
              expect(ctx.userId).toBe("user-1"); // Inherited from parent
              expect(ctx.sessionId).toBe("session-2");

              await client.context.business.run({ level: 3 }, () => {
                const innerCtx = client.context.business.get();
                expect(innerCtx.level).toBe(3);
                expect(innerCtx.userId).toBe("user-1"); // Still inherited
                expect(innerCtx.sessionId).toBe("session-2"); // Still inherited
              });
            },
          );

          // Back to level 1 context
          expect(client.context.business.get().level).toBe(1);
          expect(client.context.business.get().sessionId).toBeUndefined();
        },
      );
    });
  });

  describe("Context Across Async Boundaries", () => {
    it("should maintain context across setTimeout", async () => {
      // M2: uses real timers with increased delays for CI stability
      await client.context.business.run(
        { timerContext: "timer-value" },
        async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              expect(client.context.business.get().timerContext).toBe(
                "timer-value",
              );
              resolve();
            }, 50);
          });
        },
      );
    });

    it("should maintain context across setInterval", async () => {
      // M2: uses real timers with increased delays for CI stability
      await client.context.business.run(
        { intervalContext: "interval-value" },
        async () => {
          let count = 0;
          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              expect(client.context.business.get().intervalContext).toBe(
                "interval-value",
              );
              count++;
              if (count >= 3) {
                clearInterval(interval);
                resolve();
              }
            }, 25);
          });
        },
      );
    });

    it("should maintain context across setImmediate", async () => {
      await client.context.business.run(
        { immediateContext: "immediate-value" },
        async () => {
          await new Promise<void>((resolve) => {
            setImmediate(() => {
              expect(client.context.business.get().immediateContext).toBe(
                "immediate-value",
              );
              resolve();
            });
          });
        },
      );
    });

    it("should maintain context across process.nextTick", async () => {
      await client.context.business.run(
        { tickContext: "tick-value" },
        async () => {
          await new Promise<void>((resolve) => {
            process.nextTick(() => {
              expect(client.context.business.get().tickContext).toBe(
                "tick-value",
              );
              resolve();
            });
          });
        },
      );
    });

    it("should maintain context across EventEmitter events", async () => {
      const { EventEmitter } = await import("events");
      const emitter = new EventEmitter();

      // M2: uses real timers with increased delays for CI stability
      await client.context.business.run(
        { eventContext: "event-value" },
        async () => {
          const promise = new Promise<void>((resolve) => {
            emitter.once("test", () => {
              expect(client.context.business.get().eventContext).toBe(
                "event-value",
              );
              resolve();
            });
          });

          // emit event after a small delay
          setTimeout(() => emitter.emit("test"), 50);

          await promise;
        },
      );
    });
  });

  describe("Worker Threads Context", () => {
    it("should pass context to worker threads", async () => {
      // Test context passing without actually creating workers
      // In real usage, context would be passed via workerData
      await client.context.business.run({ workerId: "worker-123" }, () => {
        const context = client.context.business.get();

        // Verify context is available to pass to worker
        expect(context.workerId).toBe("worker-123");

        // In real usage:
        // new Worker('worker.js', { workerData: { context } });

        // Simulate what would be passed to worker
        const workerData = { context };
        expect(workerData.context.workerId).toBe("worker-123");
      });
    });

    it("should maintain context when handling worker messages", async () => {
      // M2: uses real timers with increased delays for CI stability
      await client.context.business.run({ requestId: "req-456" }, async () => {
        // context should be available before worker communication
        expect(client.context.business.get().requestId).toBe("req-456");

        // simulate async worker response handling
        await new Promise<void>((resolve) => {
          // in real usage, this would be worker.on('message', ...)
          setTimeout(() => {
            // context should still be available in callback
            expect(client.context.business.get().requestId).toBe("req-456");
            resolve();
          }, 25);
        });

        // context should still be available after worker communication
        expect(client.context.business.get().requestId).toBe("req-456");
      });
    });
  });

  describe("Cluster Context Sharing", () => {
    it("should share context with cluster workers", () => {
      // create mock functions separately to avoid unbound method issues
      const workerSendFn = vi.fn();
      const workerOnFn = vi.fn();

      // Mock cluster module
      const mockCluster = {
        isMaster: true,
        isPrimary: true,
        fork: vi.fn().mockReturnValue({
          send: workerSendFn,
          on: workerOnFn,
        }),
      };

      Object.assign(cluster, mockCluster);

      void client.context.business.run({ clusterId: "cluster-789" }, () => {
        const context = client.context.business.get();

        if (cluster.isPrimary) {
          cluster.fork(); // triggers the mock

          // Send context to worker
          workerSendFn({ type: "context", data: context });

          expect(workerSendFn).toHaveBeenCalledWith({
            type: "context",
            data: expect.objectContaining({
              clusterId: "cluster-789",
            }) as unknown as Record<string, unknown>,
          });
        }
      });
    });

    it("should handle inter-process communication with context", () => {
      const sendFn = vi.fn();
      const mockWorker = {
        id: 1,
        send: sendFn,
        on: vi.fn(),
      };

      void client.context.business.run({ processContext: "ipc-value" }, () => {
        const context = client.context.business.get();

        // Send message with context
        mockWorker.send({
          type: "task",
          context,
          data: { task: "process-data" },
        });

        expect(sendFn).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              processContext: "ipc-value",
            }) as unknown as Record<string, unknown>,
          }),
        );
      });
    });
  });

  // run shared context api conformance tests
  runSharedContextAPITests(() => client);

  // run shared instance isolation conformance tests
  runInstanceIsolationTests({
    environment: "node",
    createClient: async (config) => {
      await SmartClient.shutdown();
      return setupNodeTestClient(config);
    },
    teardownClient: teardownTestClient,
    metricPrefix: "node",
  });
});
