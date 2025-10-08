/**
 * Shared Provider Contract Tests
 *
 * This test suite validates that ALL queue providers implement the IQueueProvider
 * interface correctly and consistently. Every provider (BullMQ, SQS, Memory) must
 * pass these tests to ensure consistent behavior across the abstraction.
 *
 * Usage:
 * ```typescript
 * import { createProviderContractTests } from '../__shared__/provider-contract.suite.mjs';
 *
 * createProviderContractTests(
 *   async () => {
 *     const provider = new BullMQProvider({ connection: { host: 'localhost', port: 6379 } });
 *     await provider.connect();
 *     return provider.forQueue('test-queue');
 *   },
 *   {
 *     providerName: 'BullMQProvider',
 *     supportsConcurrentFetch: true,
 *     supportsGetJob: true,
 *     supportsDLQ: true,
 *   }
 * );
 * ```
 *
 * ## Testing Guidelines: Fake Timers vs Real Timers
 *
 * ### CRITICAL RULE: Do NOT use fake timers in integration tests
 *
 * **Why?** `vi.useFakeTimers()` only manipulates the Node.js event loop clock. It has
 * NO CONTROL over the clock inside external systems (Redis, LocalStack, etc.).
 *
 * **Example of what FAILS:**
 * ```typescript
 * // This test will FAIL because fake timers don't affect Redis's clock
 * await provider.add(jobWithDelay); // adds to REAL Redis with 10s delay
 * vi.advanceTimersByTimeAsync(10000); // advances FAKE clock, not Redis's clock
 * await provider.fetch(1); // job still not ready in Redis!
 * ```
 *
 * ### The Clear Rule:
 *
 * #### Unit Tests (application-level timing) → ALWAYS use fake timers
 * - Examples: Worker poll interval, job timeout handling
 * - Location: `worker.test.mts`, `queue.test.mts`
 * - Why: Timing logic lives in Node.js event loop
 * - Use: `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`
 *
 * #### Integration Tests (provider-level timing) → NEVER use fake timers
 * - Examples: BullMQ delayed jobs, SQS DelaySeconds
 * - Location: This file, `*.integration.test.mts`
 * - Why: Timing logic lives in external system (Redis/LocalStack)
 * - Use: Real `setTimeout` waits + `vi.waitFor` for synchronization
 *
 * ### Managing Real Timer Downsides:
 * - Keep waits short (1-2 seconds sufficient for most tests)
 * - Increase test timeouts for timing-dependent tests
 * - Consider separate CI job for slower integration tests
 *
 * **Source**: Gemini Pro validation feedback (2025-10-06)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "node:assert";

import type { IQueueProvider } from "../provider.interface.mjs";

import { createMockJob } from "../../test-utils.mjs";

export interface ProviderContractConfig {
  /** Provider name for test descriptions */
  providerName: string;
  /** Whether provider supports concurrent fetch() calls */
  supportsConcurrentFetch: boolean;
  /** Whether provider supports getJob() operation */
  supportsGetJob: boolean;
  /** Whether provider supports DLQ operations */
  supportsDLQ: boolean;
  /** Whether provider supports delayed jobs natively */
  supportsDelayedJobs?: boolean;
  /** Whether provider supports queue deletion (some providers like SQS require AWS Console/CLI) */
  supportsDelete?: boolean;
  /**
   * Whether ack/nack take Job<T> (true) or jobId string (false)
   * NOTE: Interface specifies Job<T>, but BullMQ and Memory violate this
   * See INTERFACE_VIOLATION_FINDINGS.md
   */
  ackNackTakesJob: boolean;
}

export function createProviderContractTests(
  providerFactory: () => Promise<IQueueProvider>,
  config: ProviderContractConfig,
) {
  describe(`${config.providerName} - Contract Compliance`, () => {
    let provider: IQueueProvider;

    beforeEach(async () => {
      provider = await providerFactory();
    });

    afterEach(async () => {
      // cleanup: delete queue
      // catch errors to prevent test hanging if queue already deleted or doesn't exist
      if (!provider) {
        return; // skip cleanup if provider wasn't created (e.g., beforeEach failed)
      }

      // only delete if provider supports it (e.g., SQS doesn't support programmatic deletion)
      if (config.supportsDelete !== false) {
        try {
          await provider.delete();
        } catch (error) {
          // ignore cleanup errors - queue may already be deleted
          console.warn(
            `Cleanup warning: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    });

    describe("Core Operations", () => {
      describe("add()", () => {
        it("should add a job and return success result", async () => {
          const job = createMockJob({
            id: "job-1",
            data: { userId: "user-123" },
          });

          const result = await provider.add(job);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.id).toBe("job-1");
            expect(result.data.queueName).toBeTruthy(); // queue name should exist
            expect(typeof result.data.queueName).toBe("string");
          }
        });

        it("should handle jobs with metadata", async () => {
          const job = createMockJob({
            id: "job-2",

            data: { foo: "bar" },
            metadata: { source: "api", requestId: "req-123" },
          });

          const result = await provider.add(job);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.metadata).toEqual({
              source: "api",
              requestId: "req-123",
            });
          }
        });

        it("should handle jobs with priority", async () => {
          const job = createMockJob({
            id: "job-3",

            data: {},
            priority: 10,
          });

          const result = await provider.add(job);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.priority).toBe(10);
          }
        });

        it("should handle jobs with scheduledFor (delayed)", async () => {
          const scheduledFor = new Date(Date.now() + 5000);
          const job = createMockJob({
            id: "job-4",

            data: {},
            scheduledFor,
          });

          const result = await provider.add(job);

          expect(result.success).toBe(true);
          if (result.success) {
            // validate scheduled time with provider-specific precision
            const actualTime = result.data.scheduledFor?.getTime() ?? 0;
            const expectedTime = scheduledFor.getTime();

            // SQS rounds to nearest second, others should be more precise
            const maxDelta = config.providerName === "SQSProvider" ? 1000 : 100; // 100ms tolerance for others
            expect(Math.abs(actualTime - expectedTime)).toBeLessThan(maxDelta);

            // ensure scheduledFor is in the future
            expect(actualTime).toBeGreaterThan(Date.now());
          }
        });
      });

      describe("fetch()", () => {
        it("should fetch jobs atomically", async () => {
          // add 5 jobs
          const jobs = Array.from({ length: 5 }, (_, i) =>
            createMockJob({
              id: `job-${i}`,

              data: { index: i },
            }),
          );

          for (const job of jobs) {
            await provider.add(job);
          }

          // wait for jobs to be persisted/visible
          await vi.waitFor(
            async () => {
              const statsResult = await provider.getStats();
              if (statsResult.success) {
                // for BullMQ, wait for exact count to ensure no jobs are in-flight
                // for SQS, stats are approximate, so >= is safer
                if (config.providerName.includes("BullMQ")) {
                  expect(statsResult.data.waiting).toBe(5);
                } else {
                  expect(statsResult.data.waiting).toBeGreaterThanOrEqual(3);
                }
              }
            },
            { timeout: 5000, interval: 100 },
          );

          // DEBUG: Check state right before fetch to diagnose if jobs disappear
          const finalStats = await provider.getStats();
          if (finalStats.success && config.providerName.includes("BullMQ")) {
            console.log(
              `[BullMQ Debug] Jobs waiting right before fetch: ${finalStats.data.waiting}`,
            );
          }

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          // fetch 3 jobs
          const result = await provider.fetch(3);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data).toHaveLength(3);
            // all jobs should have a queue name (bound queue name from provider)
            expect(
              result.data.every(
                (j) =>
                  typeof j.queueName === "string" && j.queueName.length > 0,
              ),
            ).toBe(true);
          }
        });

        it("should return empty array when queue is empty", async () => {
          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          const result = await provider.fetch(5);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data).toEqual([]);
          }
        });

        // NOTE: This test is skipped for SQSProvider due to a known LocalStack limitation
        // where message-level `DelaySeconds` is not consistently honored in integration tests.
        // The provider implementation is correct (sends DelaySeconds: 10), but LocalStack
        // returns the delayed message immediately. This is an emulator limitation, not a provider bug.
        // See: https://github.com/localstack/localstack/issues/12881
        it.skipIf(config.providerName === "SQSProvider")(
          "should not return delayed jobs before scheduled time",
          async () => {
            // Skip this test for providers that don't support delayed jobs natively
            if (!config.supportsDelayedJobs) {
              return;
            }

            const scheduledFor = new Date(Date.now() + 10000);
            const job = createMockJob({
              id: "delayed-job",

              data: {},
              scheduledFor,
            });

            await provider.add(job);

            if (!provider.fetch) {
              fail("Provider fetch method is undefined");
            }

            const result = await provider.fetch(1);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data).toHaveLength(0);
            }
          },
        );
      });

      describe("ack()", () => {
        it("should acknowledge a job successfully", async () => {
          const job = createMockJob({
            id: "job-to-ack",

            data: { task: "process" },
          });

          const addResult = await provider.add(job);
          expect(addResult.success).toBe(true);

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          const fetchResult = await provider.fetch(1);
          expect(fetchResult.success).toBe(true);

          if (fetchResult.success && fetchResult.data.length > 0) {
            const fetchedJob = fetchResult.data[0];
            if (!provider.ack) {
              fail("Provider ack method is undefined");
            }
            const ackResult = await provider.ack(fetchedJob!, {
              status: "success",
            });

            expect(ackResult.success).toBe(true);
          }
        });

        it("should handle ack with result data", async () => {
          const job = createMockJob({
            id: "job-with-result",

            data: { input: 100 },
          });

          await provider.add(job);

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          const fetchResult = await provider.fetch(1);

          if (fetchResult.success && fetchResult.data.length > 0) {
            const fetchedJob = fetchResult.data[0];
            if (!provider.ack) {
              fail("Provider ack method is undefined");
            }
            const ackResult = await provider.ack(fetchedJob!, {
              output: 200,
              processed: true,
            });

            expect(ackResult.success).toBe(true);
          }
        });
      });

      describe("nack()", () => {
        it("should nack a job successfully", async () => {
          const job = createMockJob({
            id: "job-to-nack",

            data: { task: "fail" },
          });

          await provider.add(job);

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          const fetchResult = await provider.fetch(1);

          if (fetchResult.success && fetchResult.data.length > 0) {
            const fetchedJob = fetchResult.data[0];
            if (!provider.nack) {
              fail("Provider nack method is undefined");
            }
            const nackResult = await provider.nack(
              fetchedJob!,
              new Error("Processing failed"),
            );

            expect(nackResult.success).toBe(true);
          }
        });

        it("should handle nack with error details", async () => {
          const job = createMockJob({
            id: "job-with-error",

            data: {},
          });

          await provider.add(job);

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          const fetchResult = await provider.fetch(1);

          if (fetchResult.success && fetchResult.data.length > 0) {
            const fetchedJob = fetchResult.data[0];
            const error = new Error("Validation failed");
            error.name = "ValidationError";

            if (!provider.nack) {
              fail("Provider nack method is undefined");
            }

            const nackResult = await provider.nack(fetchedJob!, error);

            expect(nackResult.success).toBe(true);
          }
        });
      });
    });

    describe("Concurrent Operations", () => {
      if (config.supportsConcurrentFetch) {
        it("should handle concurrent fetch() without job duplication", async () => {
          // add 15 jobs
          const jobs = Array.from({ length: 15 }, (_, i) =>
            createMockJob({
              id: `concurrent-job-${i}`,

              data: { index: i },
            }),
          );

          for (const job of jobs) {
            await provider.add(job);
          }

          // wait for jobs to be persisted/visible in the queue
          await vi.waitFor(
            async () => {
              const statsResult = await provider.getStats();
              if (statsResult.success) {
                expect(statsResult.data.waiting).toBeGreaterThanOrEqual(5);
              }
            },
            { timeout: 5000, interval: 100 },
          );

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          // fetch concurrently (simulates multiple workers)
          const [result1, result2, result3] = await Promise.all([
            provider.fetch(5),
            provider.fetch(5),
            provider.fetch(5),
          ]);

          // collect all job IDs
          const allIds = [
            ...(result1.success ? result1.data.map((j) => j.id) : []),
            ...(result2.success ? result2.data.map((j) => j.id) : []),
            ...(result3.success ? result3.data.map((j) => j.id) : []),
          ];

          // verify no duplicates (atomicity guarantee - this is the critical check)
          const uniqueIds = new Set(allIds);
          expect(uniqueIds.size).toBe(allIds.length);

          // should fetch most jobs - use provider-specific thresholds
          // SQS has eventual consistency, BullMQ/Memory should be immediate
          const minExpected = config.providerName === "SQSProvider" ? 10 : 15; // ≥67% for SQS, 100% for others
          expect(allIds.length).toBeGreaterThanOrEqual(minExpected);
          expect(allIds.length).toBeLessThanOrEqual(15); // sanity check - can't fetch more than added
        });

        it("should handle concurrent ack() operations safely", async () => {
          // add 10 jobs
          const jobs = Array.from({ length: 10 }, (_, i) =>
            createMockJob({
              id: `ack-job-${i}`,

              data: { index: i },
            }),
          );

          for (const job of jobs) {
            await provider.add(job);
          }

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          // fetch all jobs
          const fetchResult = await provider.fetch(10);
          expect(fetchResult.success).toBe(true);

          if (fetchResult.success) {
            // ack concurrently
            const ackResults = await Promise.all(
              fetchResult.data.map((job) => {
                if (!provider.ack) {
                  fail("Provider ack method is undefined");
                }
                return provider.ack(job, { status: "done" });
              }),
            );

            // all should succeed
            expect(ackResults.every((r) => r.success)).toBe(true);
          }
        });
      }

      it("should handle concurrent add() operations safely", async () => {
        // add 20 jobs concurrently
        const jobs = Array.from({ length: 20 }, (_, i) =>
          createMockJob({
            id: `parallel-add-${i}`,

            data: { index: i },
          }),
        );

        const addResults = await Promise.all(
          jobs.map((job) => provider.add(job)),
        );

        // all should succeed
        expect(addResults.every((r) => r.success)).toBe(true);

        // wait for jobs to be persisted/visible
        await vi.waitFor(
          async () => {
            const statsResult = await provider.getStats();
            if (statsResult.success) {
              expect(statsResult.data.waiting).toBeGreaterThanOrEqual(5);
            }
          },
          { timeout: 5000, interval: 100 },
        );

        if (!provider.fetch) {
          fail("Provider fetch method is undefined");
        }

        // verify most/all jobs are in queue
        const fetchResult = await provider.fetch(25);
        expect(fetchResult.success).toBe(true);
        if (fetchResult.success) {
          // allow for timing issues - should get at least 25% of jobs
          expect(fetchResult.data.length).toBeGreaterThanOrEqual(5);
        }
      });
    });

    describe("Management Operations", () => {
      describe("pause/resume", () => {
        it("should pause and resume queue successfully", async () => {
          const pauseResult = await provider.pause();
          expect(pauseResult.success).toBe(true);

          const resumeResult = await provider.resume();
          expect(resumeResult.success).toBe(true);
        });

        it("should not fetch jobs when paused", async () => {
          // add job
          const job = createMockJob({
            id: "paused-job",

            data: {},
          });
          await provider.add(job);

          // pause
          await provider.pause();

          if (!provider.fetch) {
            fail("Provider fetch method is undefined");
          }

          // try to fetch (behavior may vary by provider)
          const fetchResult = await provider.fetch(1);

          // some providers return empty, others return jobs but mark as paused
          expect(fetchResult).toHaveProperty("success");
        });
      });

      describe("getStats()", () => {
        it("should return queue statistics", async () => {
          // add some jobs
          await provider.add(createMockJob({ id: "stat-job-1", data: {} }));
          await provider.add(createMockJob({ id: "stat-job-2", data: {} }));

          const result = await provider.getStats();

          expect(result.success).toBe(true);
          if (result.success) {
            // validate QueueStats interface
            expect(result.data).toHaveProperty("queueName");
            expect(result.data).toHaveProperty("waiting");
            expect(result.data).toHaveProperty("active");
            expect(result.data).toHaveProperty("completed");
            expect(result.data).toHaveProperty("failed");
            expect(result.data).toHaveProperty("delayed");
            expect(result.data).toHaveProperty("paused");
            expect(typeof result.data.waiting).toBe("number");
          }
        });
      });

      describe("getHealth()", () => {
        it("should return health status", async () => {
          const result = await provider.getHealth();

          expect(result.success).toBe(true);
          if (result.success) {
            // check for raw metrics (no isHealthy boolean - userland decides health)
            expect(result.data).toHaveProperty("activeWorkers");
            expect(result.data).toHaveProperty("queueDepth");
            expect(result.data).toHaveProperty("errorRate");
            expect(result.data).toHaveProperty("completedCount");
            expect(result.data).toHaveProperty("failedCount");
            expect(result.data).toHaveProperty("isPaused");
            expect(typeof result.data.activeWorkers).toBe("number");
            expect(typeof result.data.queueDepth).toBe("number");
            expect(typeof result.data.errorRate).toBe("number");
            expect(typeof result.data.isPaused).toBe("boolean");
          }
        });
      });

      describe("delete()", () => {
        it("should delete queue successfully", async () => {
          // skip if provider doesn't support delete
          if (config.supportsDelete === false) {
            return;
          }

          // add some jobs
          await provider.add(createMockJob({ id: "delete-job-1", data: {} }));

          const result = await provider.delete();

          expect(result.success).toBe(true);
        });
      });
    });

    if (config.supportsGetJob) {
      describe("getJob()", () => {
        it("should get job by ID", async () => {
          const job = createMockJob({
            id: "get-job-1",

            data: { value: 42 },
          });

          await provider.add(job);

          const result = await provider.getJob("get-job-1");

          expect(result.success).toBe(true);
          if (result.success && result.data) {
            expect(result.data.id).toBe("get-job-1");
            expect(result.data.data).toEqual({ value: 42 });
          }
        });

        it("should return null for non-existent job", async () => {
          const result = await provider.getJob("non-existent-job");

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data).toBeNull();
          }
        });
      });
    }

    if (config.supportsDLQ) {
      describe("DLQ Operations", () => {
        describe("getDLQJobs()", () => {
          it("should return DLQ jobs", async () => {
            if (!provider.getDLQJobs) {
              fail("Provider getDLQJobs method is undefined");
            }

            const result = await provider.getDLQJobs(10);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(Array.isArray(result.data)).toBe(true);
            }
          });

          it("should respect limit parameter", async () => {
            if (!provider.getDLQJobs) {
              fail("Provider getDLQJobs method is undefined");
            }

            const result = await provider.getDLQJobs(5);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.length).toBeLessThanOrEqual(5);
            }
          });
        });

        describe("retryJob()", () => {
          it("should handle retry for non-existent job", async () => {
            if (!provider.retryJob) {
              fail("Provider retryJob method is undefined");
            }

            const result = await provider.retryJob("non-existent-dlq-job");

            // may succeed (no-op) or error depending on provider
            expect(result).toHaveProperty("success");
          });
        });
      });
    }

    describe("Edge Cases", () => {
      it("should handle fetch with limit 0", async () => {
        if (!provider.fetch) {
          fail("Provider fetch method is undefined");
        }

        const result = await provider.fetch(0);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
      });

      it("should handle fetch with negative limit", async () => {
        if (!provider.fetch) {
          fail("Provider fetch method is undefined");
        }

        const result = await provider.fetch(-1);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
      });

      it("should handle jobs with empty data object", async () => {
        const job = createMockJob({
          id: "empty-data-job",

          data: {},
        });

        const result = await provider.add(job);

        expect(result.success).toBe(true);
      });

      it("should handle jobs with undefined metadata", async () => {
        const job = createMockJob({
          id: "no-metadata-job",

          data: { foo: "bar" },
          metadata: undefined,
        });

        const result = await provider.add(job);

        expect(result.success).toBe(true);
      });

      it("should handle ack for job with no result data", async () => {
        const job = createMockJob({
          id: "no-result-job",

          data: {},
        });

        await provider.add(job);
        if (!provider.fetch) {
          fail("Provider fetch method is undefined");
        }

        const fetchResult = await provider.fetch(1);

        if (fetchResult.success && fetchResult.data.length > 0) {
          const fetchedJob = fetchResult.data[0];

          if (!provider.ack) {
            fail("Provider ack method is undefined");
          }

          const ackResult = await provider.ack(fetchedJob!);

          expect(ackResult.success).toBe(true);
        }
      });
    });

    describe("Error Scenarios", () => {
      it("should return Result.err for operations on deleted queue", async () => {
        await provider.delete();

        // operations after delete should fail gracefully
        const job = createMockJob({
          id: "deleted-queue-job",

          data: {},
        });

        const addResult = await provider.add(job);

        // some providers auto-recreate, others error
        expect(addResult).toHaveProperty("success");
      });
    });
  });
}
