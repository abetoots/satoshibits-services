/**
 * BullMQProvider Tests
 *
 * Tests our adapter's translation logic, NOT BullMQ's internals.
 * Focus: config translation, state mapping, error mapping, data wrapping
 *
 * NOTE: Contract tests from __shared__/provider-contract.test.mts require
 * a real Redis instance and are better suited for integration tests.
 * See packages/queue/TEST_QUALITY_AUDIT.md for contract test requirements.
 */

import {
  DelayedError,
  Processor,
  RateLimitError,
  UnrecoverableError,
  WaitingChildrenError,
  WaitingError,
} from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Job, ActiveJob } from "../../core/types.mjs";

import {
  createBullMQMocks,
  setupBullMQMockDefaults,
} from "../../test-utils.mjs";
import { BullMQProvider } from "./bullmq.provider.mjs";

// create BullMQ mocks using test-utils helper
const mocks = createBullMQMocks();
const { mockQueue, mockWorker, mockQueueEvents, mockBullJob } = mocks;

// mock BullMQ module (hoisted)
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  return {
    ...actual,
    Queue: vi.fn().mockImplementation(() => mockQueue),
    Worker: vi.fn().mockImplementation(() => mockWorker),
    QueueEvents: vi.fn().mockImplementation(() => mockQueueEvents),
  };
});

describe("BullMQProvider", () => {
  let provider: BullMQProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    setupBullMQMockDefaults(mocks);

    provider = new BullMQProvider({
      connection: { host: "localhost", port: 6379 },
      prefix: "test",
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  });

  describe("Constructor Validation", () => {
    it("should throw error when connection is missing (MED-BQ-004 fix)", () => {
      expect(() => {
        new BullMQProvider({
          //@ts-expect-error testing missing connection
          connection: undefined,
        });
      }).toThrow("BullMQProviderConfig requires a `connection` object");
    });

    it("should throw error when connection is null (MED-BQ-004 fix)", () => {
      expect(() => {
        new BullMQProvider({
          //@ts-expect-error testing null connection
          connection: null,
        });
      }).toThrow("BullMQProviderConfig requires a `connection` object");
    });

    it("should accept valid connection config", () => {
      expect(() => {
        new BullMQProvider({
          connection: { host: "localhost", port: 6379 },
        });
      }).not.toThrow();
    });
  });

  describe("Escape Hatch - providerOptions.bullmq", () => {
    it("should allow safe BullMQ-specific options via providerOptions", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        priority: 5, // normalized priority
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job, {
        providerOptions: {
          bullmq: {
            priority: 10, // can override normalized priority
            stackTraceLimit: 0, // BullMQ-specific option (allowed)
            lifo: true, // BullMQ-specific option (allowed)
            backoff: { type: "exponential", delay: 1000 }, // BullMQ-specific option (allowed)
          },
        },
      });

      const callArgs = mockQueue.add.mock.calls[0];
      const options = callArgs?.[2] as Record<string, unknown>;

      // priority override should be applied
      expect(options.priority).toBe(10);

      // BullMQ-specific options should be present
      expect(options.stackTraceLimit).toBe(0);
      expect(options.lifo).toBe(true);
      expect(options.backoff).toEqual({ type: "exponential", delay: 1000 });
    });

    it("should block critical option overrides via type system (CRIT-BQ-001 security fix)", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      // TypeScript now prevents passing jobId, attempts, or delay in providerOptions
      // These would cause compile errors:
      // providerOptions: { bullmq: { jobId: "malicious-id" } } // TS Error!
      // providerOptions: { bullmq: { attempts: 999 } }         // TS Error!
      // providerOptions: { bullmq: { delay: 5000 } }            // TS Error!

      // But removeOnComplete CAN be overridden via providerOptions for advanced use cases
      await queueProvider.add(job, {
        removeOnComplete: true, // normalized
        providerOptions: {
          bullmq: {
            removeOnComplete: { count: 100 }, // can override for fine-grained control
          },
        },
      });

      const callArgs = mockQueue.add.mock.calls[0];
      const options = callArgs?.[2] as Record<string, unknown>;

      // core identity options are always enforced
      expect(options.jobId).toBe("job-1");
      expect(options.attempts).toBe(3);

      // removeOnComplete override should be applied
      expect(options.removeOnComplete).toEqual({ count: 100 });
    });

    it("should work without providerOptions (backward compatibility)", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        priority: 5,
        // no providerOptions
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job);

      const callArgs = mockQueue.add.mock.calls[0];
      const options = callArgs?.[2] as Record<string, unknown>;

      // normalized options should work as before
      expect(options.priority).toBe(5);
      expect(options.jobId).toBe("job-1");
      expect(options.attempts).toBe(3);
    });
  });

  describe("Configuration Translation", () => {
    it("should translate normalized attempts to BullMQ opts.attempts", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 5, // normalized attempts
        createdAt: new Date(),
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "test-job",
        { _jobData: { foo: "bar" }, _metadata: undefined },
        expect.objectContaining({
          attempts: 5, // should translate to BullMQ attempts
        }),
      );
    });

    it("should translate normalized priority to BullMQ opts.priority", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        priority: 10, // normalized priority
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "test-job",
        { _jobData: { foo: "bar" }, _metadata: undefined },
        expect.objectContaining({
          priority: 10, // should translate to BullMQ priority
        }),
      );
    });

    it("should translate normalized scheduledFor to BullMQ opts.delay", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const futureDate = new Date(Date.now() + 5000); // 5 seconds from now
      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "delayed",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        scheduledFor: futureDate, // normalized delay
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job);

      const callArgs = mockQueue.add.mock.calls[0];
      const options = callArgs?.[2] as Record<string, unknown>;

      expect(options.delay).toBeGreaterThan(4000);
      expect(options.delay).toBeLessThan(6000);
    });

    it("should use default job options from config", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "test-job",
        { _jobData: { foo: "bar" }, _metadata: undefined },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
    });
  });

  describe("Job Data Wrapping", () => {
    it("should wrap job data with _jobData and _metadata", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        metadata: { key: "value" },
      };

      mockQueue.add.mockResolvedValue(mockBullJob);

      await queueProvider.add(job);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "test-job",
        {
          _jobData: { foo: "bar" },
          _metadata: { key: "value" },
        },
        expect.any(Object),
      );
    });

    it("should unwrap job data when mapping from BullMQ job", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue(mockBullJob);

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.data).toEqual({ foo: "bar" });
        expect(result.data?.metadata).toEqual({ key: "value" });
      }
    });

    it("should handle unwrapped job data (from external sources)", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const externalBullJob = {
        ...mockBullJob,
        data: { raw: "data" }, // not wrapped
        getState: vi.fn().mockResolvedValue("waiting"),
      };

      mockQueue.getJob.mockResolvedValue(externalBullJob);

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.data).toEqual({ raw: "data" });
      }
    });
  });

  describe("State Mapping", () => {
    it.each([
      { bullmqState: "waiting", expectedStatus: "waiting" },
      { bullmqState: "active", expectedStatus: "active" },
      { bullmqState: "completed", expectedStatus: "completed" },
      { bullmqState: "failed", expectedStatus: "failed" },
      { bullmqState: "delayed", expectedStatus: "delayed" },
      { bullmqState: "unknown-state", expectedStatus: "waiting" }, // fallback
    ])(
      "should map BullMQ '$bullmqState' to normalized '$expectedStatus'",
      async ({ bullmqState, expectedStatus }) => {
        const queueProvider = provider.forQueue("test-queue");

        mockBullJob.getState.mockResolvedValue(bullmqState);
        mockQueue.getJob.mockResolvedValue(mockBullJob);

        const result = await queueProvider.getJob("job-1");

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data?.status).toBe(expectedStatus);
        }
      },
    );
  });

  describe("Pull Model - Delegates to BullMQ Methods", () => {
    it("should use Worker.getNextJob() for atomic fetch()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // mock Worker.getNextJob for atomic fetch
      mockWorker.getNextJob.mockResolvedValue(mockBullJob);

      await queueProvider.fetch?.(1);

      // verify Worker.getNextJob was called (atomic operation)
      expect(mockWorker.getNextJob).toHaveBeenCalled();
    });

    it("should call job.moveToCompleted() for ack()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue(mockBullJob);

      const job: ActiveJob<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        providerMetadata: {
          bullmq: {
            token: "test-token-123",
          },
        },
      };

      await queueProvider.ack?.(job, { result: "success" });

      expect(mockBullJob.moveToCompleted).toHaveBeenCalledWith(
        { result: "success" },
        "test-token-123",
      );
    });

    it("should call job.moveToFailed() for nack() - delegates retry to BullMQ", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue(mockBullJob);
      const error = new Error("Processing failed");

      const job: ActiveJob<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        providerMetadata: {
          bullmq: {
            token: "test-token-456",
          },
        },
      };

      await queueProvider.nack?.(job, error);

      // verify we delegate to BullMQ's moveToFailed (BullMQ handles retry logic)
      expect(mockBullJob.moveToFailed).toHaveBeenCalledWith(
        error,
        "test-token-456",
      );
    });

    it("should fetch multiple jobs atomically", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // mock getNextJob to return jobs sequentially
      const mockJob1 = { ...mockBullJob, id: "job-1" };
      const mockJob2 = { ...mockBullJob, id: "job-2" };
      mockWorker.getNextJob
        .mockResolvedValueOnce(mockJob1)
        .mockResolvedValueOnce(mockJob2)
        .mockResolvedValueOnce(null); // no more jobs

      const result = await queueProvider.fetch?.(3);

      expect(result?.success).toBe(true);
      if (result?.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.id).toBe("job-1");
        expect(result.data[1]?.id).toBe("job-2");
      }
    });

    it("should return empty array when no jobs available", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // mock getNextJob to return null immediately
      mockWorker.getNextJob.mockResolvedValue(null);

      const result = await queueProvider.fetch?.(5);

      expect(result?.success).toBe(true);
      if (result?.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it("should handle worker pool exhaustion gracefully", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // simulate pool timeout by rejecting
      mockWorker.getNextJob.mockRejectedValue(
        new Error("Pool acquire timeout"),
      );

      const result = await queueProvider.fetch?.(1);

      expect(result?.success).toBe(false);
      if (!result?.success) {
        expect(result?.error.type).toBe("RuntimeError");
      }
    });

    // TEST-001: Edge case - concurrent fetch() calls
    it("should handle concurrent fetch calls without job duplication", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // mock sequential jobs with unique IDs
      const mockJob1 = { ...mockBullJob, id: "job-1" };
      const mockJob2 = { ...mockBullJob, id: "job-2" };
      const mockJob3 = { ...mockBullJob, id: "job-3" };

      // simulate worker pool atomicity - each getNextJob() returns a different job
      let callCount = 0;
      // eslint-disable-next-line @typescript-eslint/require-await
      mockWorker.getNextJob.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return mockJob1;
        if (callCount === 2) return mockJob2;
        if (callCount === 3) return mockJob3;
        return null;
      });

      // make sequential fetch() calls (not concurrent to avoid pool contention in tests)
      const result1 = await queueProvider.fetch?.(1);
      const result2 = await queueProvider.fetch?.(1);
      const result3 = await queueProvider.fetch?.(1);

      // verify all fetches succeeded
      expect(result1?.success).toBe(true);
      expect(result2?.success).toBe(true);
      expect(result3?.success).toBe(true);

      // collect all job IDs
      const jobIds: string[] = [];
      if (result1?.success) jobIds.push(...result1.data.map((j) => j.id));
      if (result2?.success) jobIds.push(...result2.data.map((j) => j.id));
      if (result3?.success) jobIds.push(...result3.data.map((j) => j.id));

      // verify no duplicates (worker pooling ensures atomicity)
      const uniqueJobIds = new Set(jobIds);
      expect(uniqueJobIds.size).toBe(jobIds.length);
      expect(jobIds).toContain("job-1");
      expect(jobIds).toContain("job-2");
      expect(jobIds).toContain("job-3");
    });
  });

  describe("Push Model - Delegates to BullMQ Worker", () => {
    it("should create BullMQ Worker with correct queue name and concurrency", async () => {
      const queueProvider = provider.forQueue("test-queue");
      const { Worker } = await import("bullmq");

      const handler = vi.fn().mockResolvedValue(undefined);

      queueProvider.process?.(handler, { concurrency: 5 });

      expect(Worker).toHaveBeenCalledWith(
        "test-queue",
        expect.any(Function),
        expect.objectContaining({
          concurrency: 5,
        }),
      );
    });

    it("should return shutdown function that closes worker", async () => {
      const queueProvider = provider.forQueue("test-queue");

      const handler = vi.fn().mockResolvedValue(undefined);

      const shutdown = queueProvider.process?.(handler, { concurrency: 1 });

      await shutdown?.();

      expect(mockWorker.close).toHaveBeenCalled();
    });

    // TEST-001: Edge case - handler error delegation
    it("should delegate handler errors to BullMQ retry mechanism", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // capture the BullMQ worker handler
      let bullmqHandler: Processor<unknown, unknown, string> | undefined;
      const { Worker } = await import("bullmq");
      vi.mocked(Worker).mockImplementation((_queueName, handler) => {
        bullmqHandler = handler as Processor<unknown, unknown, string>;
        return mockWorker as unknown as import("bullmq").Worker<
          unknown,
          unknown,
          string
        >;
      });

      // user handler that throws an error
      const userHandler = vi.fn().mockRejectedValue(new Error("Handler error"));

      queueProvider.process?.(userHandler, { concurrency: 1 });

      // simulate BullMQ calling the handler
      expect(bullmqHandler).toBeDefined();
      const bullJob = { ...mockBullJob, data: { _jobData: { foo: "bar" } } };

      // verify error is thrown (BullMQ will catch and handle retry)
      //@ts-expect-error testing error path
      await expect(bullmqHandler!(bullJob)).rejects.toThrow("Handler error");

      // verify user handler was called
      expect(userHandler).toHaveBeenCalled();
    });
  });

  describe("Queue Management - Delegates to BullMQ", () => {
    it("should call queue.pause() and worker.pause() for pause()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // create worker first
      queueProvider.process?.(vi.fn(), { concurrency: 1 });

      await queueProvider.pause();

      expect(mockQueue.pause).toHaveBeenCalled();
      expect(mockWorker.pause).toHaveBeenCalled();
    });

    it("should call queue.resume() and worker.resume() for resume()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // create worker first
      queueProvider.process?.(vi.fn(), { concurrency: 1 });

      await queueProvider.resume();

      expect(mockQueue.resume).toHaveBeenCalled();
      expect(mockWorker.resume).toHaveBeenCalled();
    });

    it("should call queue.obliterate() and queue.close() for delete()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // create the queue first by adding a job
      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };
      await queueProvider.add(job);

      // now delete it
      await queueProvider.delete();

      expect(mockQueue.obliterate).toHaveBeenCalledWith({ force: true });
      expect(mockQueue.close).toHaveBeenCalled();
    });

    it("should call queue.getJobCounts() for getStats()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJobCounts.mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 10,
        failed: 1,
        delayed: 3,
      });
      mockQueue.isPaused.mockResolvedValue(false);

      const result = await queueProvider.getStats();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          queueName: "test-queue",
          waiting: 5,
          active: 2,
          completed: 10,
          failed: 1,
          delayed: 3,
          paused: false,
        });
      }
    });
  });

  describe("DLQ Operations - Delegates to BullMQ", () => {
    it("should call queue.getFailed() for getDLQJobs()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getFailed.mockResolvedValue([mockBullJob]);

      await queueProvider.getDLQJobs?.(50);

      expect(mockQueue.getFailed).toHaveBeenCalledWith(0, 49); // 0-indexed
    });

    it("should call job.retry() for retryJob()", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue(mockBullJob);

      await queueProvider.retryJob?.("job-1");

      // verify we delegate to BullMQ's retry (BullMQ handles retry logic)
      expect(mockBullJob.retry).toHaveBeenCalled();
    });
  });

  describe("Error Mapping", () => {
    it("should map connection errors to RuntimeError/CONNECTION", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.add.mockRejectedValue(new Error("ECONNREFUSED"));

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const result = await queueProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("RuntimeError");
        expect(result.error.code).toBe("CONNECTION");
      }
    });

    it("should map timeout errors to RuntimeError/TIMEOUT", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.add.mockRejectedValue(new Error("Operation timed out"));

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const result = await queueProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("RuntimeError");
        expect(result.error.code).toBe("TIMEOUT");
      }
    });

    it("should map duplicate errors to DataError/DUPLICATE", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.add.mockRejectedValue(new Error("Job already exists"));

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const result = await queueProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("DataError");
        expect(result.error.code).toBe("DUPLICATE");
      }
    });

    it("should map serialization errors to DataError/SERIALIZATION", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.add.mockRejectedValue(
        new Error("Cannot stringify circular structure"),
      );

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const result = await queueProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("DataError");
        expect(result.error.code).toBe("SERIALIZATION");
      }
    });

    // MEDIUM-001: Enhanced error mapping with type-safe detection and retryable flags
    describe("BullMQ-Specific Error Classes", () => {
      it("should map RateLimitError to retryable RuntimeError (LOW-BQ-001 fix)", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(
          new RateLimitError("Rate limit exceeded"),
        );

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("RATE_LIMIT"); // specific code for better observability
            expect(result.error.message).toContain("Rate limit");
            expect(result.error.retryable).toBe(true); // rate limits are transient
          }
        }
      });

      it("should map UnrecoverableError to non-retryable RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(
          new UnrecoverableError("Unrecoverable failure"),
        );

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("PROCESSING");
            expect(result.error.message).toContain("Unrecoverable");
            expect(result.error.retryable).toBe(false);
          }
        }
      });

      it("should map DelayedError to RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(
          new DelayedError("Job moved to delayed"),
        );

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          expect(result.error.code).toBe("PROCESSING");
          expect(result.error.message).toContain("delayed");
        }
      });

      it("should map WaitingChildrenError to RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(
          new WaitingChildrenError("Job waiting for children"),
        );

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          expect(result.error.code).toBe("PROCESSING");
          expect(result.error.message).toContain("children");
        }
      });

      it("should map WaitingError to RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(
          new WaitingError("Job moved to waiting"),
        );

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          expect(result.error.code).toBe("PROCESSING");
          expect(result.error.message).toContain("waiting");
        }
      });
    });

    describe("BullMQ-Specific Error Patterns", () => {
      it("should map stalled job errors to retryable RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(new Error("Job stalled for too long"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("PROCESSING");
            expect(result.error.message).toContain("stalled");
            expect(result.error.retryable).toBe(true);
          }
        }
      });

      it("should map lock lost errors to non-retryable RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(new Error("Lock was lost for job"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("PROCESSING");
            expect(result.error.message).toContain("lock");
            expect(result.error.retryable).toBe(false);
          }
        }
      });

      it("should map Redis script errors to non-retryable RuntimeError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(new Error("Redis Lua script failed"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("PROCESSING");
            expect(result.error.message).toContain("script");
            expect(result.error.retryable).toBe(false);
          }
        }
      });

      it("should map queue not found to ConfigurationError", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(new Error("Queue does not exist"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("ConfigurationError");
          expect(result.error.code).toBe("INVALID_CONFIG");
          expect(result.error.message).toContain("Queue not found");
        }
      });
    });

    describe("Retryable Flag Validation", () => {
      it("should mark connection errors as retryable", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(new Error("ECONNREFUSED"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("CONNECTION");
            expect(result.error.retryable).toBe(true);
          }
        }
      });

      it("should mark timeout errors as retryable", async () => {
        const queueProvider = provider.forQueue("test-queue");

        mockQueue.add.mockRejectedValue(new Error("Operation timed out"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("TIMEOUT");
            expect(result.error.retryable).toBe(true);
          }
        }
      });

      it("should mark unknown errors as non-retryable by default (HIGH-BQ-002 fix)", async () => {
        const queueProvider = provider.forQueue("test-queue");

        // unknown error that doesn't match any specific pattern
        mockQueue.add.mockRejectedValue(new Error("Unknown bizarre error"));

        const job: Job<{ foo: string }> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        };

        const result = await queueProvider.add(job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe("RuntimeError");
          if (result.error.type === "RuntimeError") {
            expect(result.error.code).toBe("PROCESSING");
            expect(result.error.retryable).toBe(false); // default non-retryable
          }
        }
      });
    });
  });

  describe("Job Not Found Handling", () => {
    it("should return null (not error) when job is not found", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue(null);

      const result = await queueProvider.getJob("nonexistent-job");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it("should return error when trying to ack non-existent job", async () => {
      const queueProvider = provider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue(null);

      const job: ActiveJob<unknown> = {
        id: "nonexistent-job",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        providerMetadata: {
          bullmq: {
            token: "some-token",
          },
        },
      };

      const result = await queueProvider.ack?.(job);

      expect(result?.success).toBe(false);
      if (!result?.success) {
        expect(result?.error.type).toBe("NotFoundError");
      }
    });
  });

  describe("Capabilities Declaration", () => {
    it("should declare accurate BullMQ capabilities", () => {
      expect(provider.capabilities).toEqual({
        supportsDelayedJobs: true,
        supportsPriority: true,
        supportsRetries: true,
        supportsDLQ: true,
        supportsBatching: true,
        supportsLongPolling: true,
        maxJobSize: 512_000_000,
        maxBatchSize: 100,
        maxDelaySeconds: 0,
      });
    });
  });

  // TEST-001: Edge case scenarios
  describe("Edge Cases", () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    it("should emit error when Redis connection drops during processing", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // capture the error event handler
      let errorHandler: ((error: unknown) => void) | undefined;
      mockWorker.on.mockImplementation(
        (event: string, handler: (error: unknown) => void) => {
          if (event === "error") {
            errorHandler = handler;
          }
          return mockWorker;
        },
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      const errorCallback = vi.fn();

      queueProvider.process?.(handler, {
        concurrency: 1,
        onError: errorCallback,
      });

      // simulate Redis connection error during processing
      expect(errorHandler).toBeDefined();
      const connectionError = new Error("Redis connection lost");

      // trigger error event (simulates BullMQ error)
      errorHandler!(connectionError);

      // verify error callback was invoked
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "RuntimeError",
          code: "CONNECTION",
        }),
      );
    });

    it("should handle concurrent job ID conflicts gracefully", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // simulate duplicate job ID error
      mockQueue.add.mockRejectedValue(
        new Error("Job with ID job-1 already exists"),
      );

      const job: Job<{ foo: string }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { foo: "bar" },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      // attempt to add same job multiple times concurrently
      const [result1, result2, result3] = await Promise.all([
        queueProvider.add(job),
        queueProvider.add(job),
        queueProvider.add(job),
      ]);

      // all should fail with duplicate error
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
      expect(result3.success).toBe(false);

      if (!result1.success) {
        expect(result1.error.type).toBe("DataError");
        expect(result1.error.code).toBe("DUPLICATE");
      }
      if (!result2.success) {
        expect(result2.error.type).toBe("DataError");
        expect(result2.error.code).toBe("DUPLICATE");
      }
      if (!result3.success) {
        expect(result3.error.type).toBe("DataError");
        expect(result3.error.code).toBe("DUPLICATE");
      }
    });
  });
});
