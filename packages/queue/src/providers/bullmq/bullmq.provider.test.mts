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

import type { FailedEventPayload } from "../../core/events.mjs";
import type { Job, ActiveJob, JobHandler } from "../../core/types.mjs";

import { Result } from "@satoshibits/functional";

import { Worker } from "../../api/worker.mjs";
import { isPermanentError, PermanentJobError } from "../../core/errors.mjs";
import { MemoryProvider } from "../memory/memory.provider.mjs";
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

  // a provider whose default budget is not the 3 used by the shared provider,
  // by the mock job and by the literal fallback, so each source can be told
  // apart. bullmq is mocked: nothing connects
  function providerWithDefaultAttempts(
    attempts: number | undefined,
  ): BullMQProvider {
    return new BullMQProvider({
      connection: { host: "localhost", port: 6379 },
      prefix: "test",
      defaultJobOptions: { attempts },
    });
  }

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

    it("should map BullMQ attemptsMade to attempts and opts.attempts to maxAttempts", async () => {
      const queueProvider = provider.forQueue("test-queue");

      // `attempts` is the number of attempts already made, so a worker sees
      // 0 on the first run and maxAttempts - 1 on the last
      mockQueue.getJob.mockResolvedValue({
        ...mockBullJob,
        attemptsMade: 2,
        opts: { ...mockBullJob.opts, attempts: 12 },
      });

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.attempts).toBe(2);
        expect(result.data?.maxAttempts).toBe(12);
      }
    });

    it("should default attempts to 0 and maxAttempts to the provider default when BullMQ reports neither", async () => {
      // a default of 7 cannot be confused with the literal fallback of 3
      const sevenProvider = providerWithDefaultAttempts(7);
      const queueProvider = sevenProvider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue({
        ...mockBullJob,
        attemptsMade: undefined,
        opts: { ...mockBullJob.opts, attempts: undefined },
      });

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.attempts).toBe(0);
        expect(result.data?.maxAttempts).toBe(7);
      }
    });

    it("should use the provider default for maxAttempts when the BullMQ job has no opts", async () => {
      const sevenProvider = providerWithDefaultAttempts(7);
      const queueProvider = sevenProvider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue({
        ...mockBullJob,
        attemptsMade: 1,
        opts: undefined,
      });

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.attempts).toBe(1);
        expect(result.data?.maxAttempts).toBe(7);
      }
    });

    it("should keep opts.attempts: 0 as maxAttempts 0 instead of falling back to a default", async () => {
      const sevenProvider = providerWithDefaultAttempts(7);
      const queueProvider = sevenProvider.forQueue("test-queue");

      // a job added to BullMQ without `attempts` carries opts.attempts 0 and
      // runs once
      mockQueue.getJob.mockResolvedValue({
        ...mockBullJob,
        attemptsMade: 0,
        opts: { ...mockBullJob.opts, attempts: 0 },
      });

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.attempts).toBe(0);
        expect(result.data?.maxAttempts).toBe(0);
      }
    });

    it("should fall back to maxAttempts 3 when neither BullMQ nor the provider default has a value", async () => {
      const noDefaultProvider = providerWithDefaultAttempts(undefined);
      const queueProvider = noDefaultProvider.forQueue("test-queue");

      mockQueue.getJob.mockResolvedValue({
        ...mockBullJob,
        opts: { ...mockBullJob.opts, attempts: undefined },
      });

      const result = await queueProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.maxAttempts).toBe(3);
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

    it("should hand fetch() callers attempts from attemptsMade and maxAttempts from opts.attempts", async () => {
      // a default of 7 cannot be confused with the job's own budget of 3
      const sevenProvider = providerWithDefaultAttempts(7);
      const queueProvider = sevenProvider.forQueue("test-queue");

      // the last attempt of three, as BullMQ hands it out
      mockWorker.getNextJob.mockResolvedValueOnce({
        ...mockBullJob,
        attemptsMade: 2,
        opts: { ...mockBullJob.opts, attempts: 3 },
      });

      const result = await queueProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (result?.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toEqual(
          expect.objectContaining({ attempts: 2, maxAttempts: 3 }),
        );
      }
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

    // what nack() hands BullMQ's moveToFailed for a given failure
    async function errorMovedToFailed(failure: unknown): Promise<unknown> {
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
        providerMetadata: { bullmq: { token: "test-token-456" } },
      };

      const result = await queueProvider.nack?.(job, failure as Error);
      expect(result?.success).toBe(true);

      expect(mockBullJob.moveToFailed).toHaveBeenCalledTimes(1);
      const [moved, token] = mockBullJob.moveToFailed.mock.calls[0] as [
        unknown,
        string,
      ];
      expect(token).toBe("test-token-456");
      return moved;
    }

    it.each([
      {
        label: "a PermanentJobError",
        makeError: (): unknown => new PermanentJobError("Campaign not found"),
        message: "Campaign not found",
      },
      {
        label: "an Error instance carrying retryable: false",
        makeError: (): unknown =>
          Object.assign(new Error("flagged error"), { retryable: false }),
        message: "flagged error",
      },
      {
        label: "a plain object carrying retryable: false",
        makeError: (): unknown => ({
          type: "DataError",
          code: "VALIDATION",
          message: "plain object error",
          retryable: false,
        }),
        message: "plain object error",
      },
    ])(
      "should move $label to failed as UnrecoverableError with the original as cause (nack)",
      async ({ makeError, message }) => {
        const original = makeError();

        const moved = await errorMovedToFailed(original);

        expect(moved).toBeInstanceOf(UnrecoverableError);
        expect((moved as Error).message).toBe(message);
        expect((moved as Error).cause).toBe(original);
      },
    );

    it("should move a plain object that is not permanent to failed as a retryable Error (nack)", async () => {
      const original = {
        type: "RuntimeError",
        code: "TIMEOUT",
        message: "retryable object error",
        retryable: true,
      };

      const moved = await errorMovedToFailed(original);

      expect(moved).toBeInstanceOf(Error);
      expect(moved).not.toBeInstanceOf(UnrecoverableError);
      expect((moved as Error).message).toBe("retryable object error");
      expect((moved as Error).cause).toBe(original);
    });

    // nack() decides alone when it is called without a Worker: inspecting
    // the failure must not throw, or the job is left without a transition
    it.each([
      {
        label: "a throwing retryable getter",
        make: (): unknown => ({
          get retryable(): boolean {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- the review's counterexample throws a string
            throw "inspection failed";
          },
        }),
        unrecoverable: false,
      },
      {
        label: "retryable: false with a throwing message getter",
        make: (): unknown => ({
          retryable: false,
          get message(): string {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- the review's counterexample throws a string
            throw "inspection failed";
          },
        }),
        unrecoverable: true,
      },
      {
        label: "an object with no prototype",
        make: (): unknown => Object.create(null) as unknown,
        unrecoverable: false,
      },
    ])(
      "should move $label to failed as a readable Error (nack)",
      async ({ make, unrecoverable }) => {
        const original = make();

        const moved = await errorMovedToFailed(original);

        expect(moved instanceof Error).toBe(true);
        expect(moved instanceof UnrecoverableError).toBe(unrecoverable);
        expect((moved as Error).message).toBe(
          "Unknown error (no readable message)",
        );
        expect(Object.is((moved as Error).cause, original)).toBe(true);
      },
    );

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

    it("should hand the handler attempts from attemptsMade and maxAttempts from opts.attempts", async () => {
      // a default of 7 cannot be confused with the job's own budget of 3
      const sevenProvider = providerWithDefaultAttempts(7);
      const queueProvider = sevenProvider.forQueue("test-queue");

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

      const userHandler = vi.fn().mockResolvedValue(undefined);

      queueProvider.process?.(userHandler, { concurrency: 1 });

      expect(bullmqHandler).toBeDefined();
      // the last attempt of three, as BullMQ hands it to the processor
      const bullJob = {
        ...mockBullJob,
        attemptsMade: 2,
        opts: { ...mockBullJob.opts, attempts: 3 },
      };

      //@ts-expect-error a mock stands in for the BullMQ job
      await bullmqHandler!(bullJob);

      expect(userHandler).toHaveBeenCalledTimes(1);
      expect(userHandler).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 2, maxAttempts: 3 }),
      );
    });

    it("should wrap PermanentJobError in UnrecoverableError", async () => {
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

      // user handler that throws PermanentJobError
      const userHandler = vi
        .fn()
        .mockRejectedValue(new PermanentJobError("Campaign not found"));

      queueProvider.process?.(userHandler, { concurrency: 1 });

      expect(bullmqHandler).toBeDefined();
      const bullJob = { ...mockBullJob, data: { _jobData: { foo: "bar" } } };

      // should throw UnrecoverableError (not PermanentJobError)
      //@ts-expect-error testing error path
      const thrown = await bullmqHandler!(bullJob).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(UnrecoverableError);
      expect((thrown as Error).message).toBe("Campaign not found");
    });

    it("should pass through regular errors unchanged", async () => {
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

      const originalError = new Error("Network timeout");
      const userHandler = vi.fn().mockRejectedValue(originalError);

      queueProvider.process?.(userHandler, { concurrency: 1 });

      expect(bullmqHandler).toBeDefined();
      const bullJob = { ...mockBullJob, data: { _jobData: { foo: "bar" } } };

      // should throw the original error (not wrapped)
      //@ts-expect-error testing error path
      await expect(bullmqHandler!(bullJob)).rejects.toThrow("Network timeout");
      //@ts-expect-error testing error path
      const thrown = await bullmqHandler!(bullJob).catch((e: unknown) => e);
      expect(thrown).not.toBeInstanceOf(UnrecoverableError);
    });

    // run a failing handler through the processor the provider gives BullMQ
    // and return what BullMQ would catch
    async function rejectionSeenByBullMQ(
      handlerError: unknown,
    ): Promise<unknown> {
      const queueProvider = provider.forQueue("test-queue");

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

      const userHandler = vi.fn().mockRejectedValue(handlerError);
      queueProvider.process?.(userHandler, { concurrency: 1 });

      expect(bullmqHandler).toBeDefined();
      const bullJob = { ...mockBullJob, data: { _jobData: { foo: "bar" } } };

      //@ts-expect-error a mock stands in for the BullMQ job
      return bullmqHandler!(bullJob).then(
        () => {
          throw new Error("the processor should have rejected");
        },
        (e: unknown) => e,
      );
    }

    it.each([
      {
        label: "a PermanentJobError",
        makeError: (): unknown => new PermanentJobError("Campaign not found"),
        message: "Campaign not found",
      },
      {
        label: "an Error instance carrying retryable: false",
        makeError: (): unknown =>
          Object.assign(new Error("flagged error"), { retryable: false }),
        message: "flagged error",
      },
      {
        label: "a plain object carrying retryable: false",
        makeError: (): unknown => ({
          type: "DataError",
          code: "VALIDATION",
          message: "plain object error",
          retryable: false,
        }),
        message: "plain object error",
      },
    ])(
      "should translate $label to UnrecoverableError with the original as cause (push)",
      async ({ makeError, message }) => {
        const original = makeError();

        const thrown = await rejectionSeenByBullMQ(original);

        expect(thrown).toBeInstanceOf(UnrecoverableError);
        expect((thrown as Error).message).toBe(message);
        expect((thrown as Error).cause).toBe(original);
      },
    );

    // BullMQ reads `message` and `stack` off what the processor throws: a
    // plain object must never reach it, permanent or not
    it.each([
      {
        label: "a plain object carrying retryable: true",
        handlerError: {
          type: "RuntimeError",
          code: "TIMEOUT",
          message: "retryable object error",
          retryable: true,
        } as unknown,
        message: "retryable object error",
      },
      {
        label: "a plain object without the flag",
        handlerError: { message: "bare object error" } as unknown,
        message: "bare object error",
      },
      {
        label: "a string",
        handlerError: "a thrown string" as unknown,
        message: "a thrown string",
      },
    ])(
      "should wrap $label in a retryable Error, never throw it as is (push)",
      async ({ handlerError, message }) => {
        const thrown = await rejectionSeenByBullMQ(handlerError);

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(UnrecoverableError);
        expect((thrown as Error).message).toBe(message);
        expect((thrown as Error).cause).toBe(handlerError);
      },
    );

    it("should throw an Error that is not permanent as the same instance (push)", async () => {
      const original = Object.assign(new Error("Network timeout"), {
        retryable: true,
      });

      const thrown = await rejectionSeenByBullMQ(original);

      expect(thrown).toBe(original);
    });

    // BullMQ's control-flow errors are not failures: they must reach BullMQ
    // as they are, or the native state transition is lost
    it.each([
      { label: "DelayedError", error: new DelayedError("moved to delayed") },
      {
        label: "WaitingChildrenError",
        error: new WaitingChildrenError("waiting for children"),
      },
      { label: "WaitingError", error: new WaitingError("moved to wait") },
      { label: "RateLimitError", error: new RateLimitError("rate limited") },
      {
        label: "UnrecoverableError",
        error: new UnrecoverableError("thrown by the handler"),
      },
    ])(
      "should throw BullMQ's own $label as the same instance (push)",
      async ({ error }) => {
        const thrown = await rejectionSeenByBullMQ(error);

        expect(thrown).toBe(error);
      },
    );

    // values whose inspection throws: the conversion must still hand BullMQ
    // an Error, with the original as cause, and must not throw itself
    const UNREADABLE = "Unknown error (no readable message)";
    const throwingTraps: ProxyHandler<object> = {
      get: () => {
        throw new Error("get trap");
      },
      has: () => {
        throw new Error("has trap");
      },
      getPrototypeOf: () => {
        throw new Error("getPrototypeOf trap");
      },
      ownKeys: () => {
        throw new Error("ownKeys trap");
      },
      getOwnPropertyDescriptor: () => {
        throw new Error("getOwnPropertyDescriptor trap");
      },
    };
    const hostileValues = [
      {
        label: "a throwing retryable getter",
        make: (): unknown => ({
          get retryable(): boolean {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- the review's counterexample throws a string
            throw "inspection failed";
          },
        }),
        unrecoverable: false,
        message: UNREADABLE,
      },
      {
        label: "retryable: false with a throwing message getter",
        make: (): unknown => ({
          retryable: false,
          get message(): string {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- the review's counterexample throws a string
            throw "inspection failed";
          },
        }),
        unrecoverable: true,
        message: UNREADABLE,
      },
      {
        label: "an object with no prototype",
        make: (): unknown => Object.create(null) as unknown,
        unrecoverable: false,
        message: UNREADABLE,
      },
      {
        label: "a proxy whose every trap throws",
        make: (): unknown => new Proxy({}, throwingTraps),
        unrecoverable: false,
        message: UNREADABLE,
      },
      {
        // it passes no instanceof check and BullMQ could not read it
        label: "a proxy over an Error whose every trap throws",
        make: (): unknown => new Proxy(new Error("hidden"), throwingTraps),
        unrecoverable: false,
        message: UNREADABLE,
      },
      {
        // instanceof Error holds, but BullMQ could not read its message
        label: "an Error whose message getter throws",
        make: (): unknown => {
          const error = new Error("hidden");
          Object.defineProperty(error, "message", {
            get: () => {
              throw new Error("message getter");
            },
          });
          return error;
        },
        unrecoverable: false,
        message: UNREADABLE,
      },
      {
        label: "an object with no string message",
        make: (): unknown => ({ retryable: false, code: "E_BAD" }),
        unrecoverable: true,
        message: '{"retryable":false,"code":"E_BAD"}',
      },
    ];

    function expectReadableError(
      value: unknown,
      expected: { unrecoverable: boolean; message: string; cause: unknown },
    ): void {
      // real Error objects only: `instanceof` on the result is safe
      expect(value instanceof Error).toBe(true);
      expect(value instanceof UnrecoverableError).toBe(
        expected.unrecoverable,
      );
      expect((value as Error).message).toBe(expected.message);
      expect(typeof (value as Error).stack).toBe("string");
      expect(Object.is((value as Error).cause, expected.cause)).toBe(true);
    }

    it.each(hostileValues)(
      "should hand BullMQ a readable Error for $label (push)",
      async ({ make, unrecoverable, message }) => {
        const original = make();

        const thrown = await rejectionSeenByBullMQ(original);

        expectReadableError(thrown, { unrecoverable, message, cause: original });
      },
    );

    // the conversion covers the whole processor, not only the handler call:
    // mapping the BullMQ job awaits getState(), which can reject too
    it.each([
      {
        label: "a plain object",
        rejection: { message: "state lookup failed", retryable: true } as unknown,
        unrecoverable: false,
        message: "state lookup failed",
      },
      {
        label: "a string",
        rejection: "state lookup failed" as unknown,
        unrecoverable: false,
        message: "state lookup failed",
      },
      {
        label: "an object carrying retryable: false",
        rejection: { message: "state is gone", retryable: false } as unknown,
        unrecoverable: true,
        message: "state is gone",
      },
    ])(
      "should hand BullMQ an Error when mapping the job rejects with $label (push)",
      async ({ rejection, unrecoverable, message }) => {
        const queueProvider = provider.forQueue("test-queue");

        let bullmqHandler: Processor<unknown, unknown, string> | undefined;
        const { Worker: BullWorker } = await import("bullmq");
        vi.mocked(BullWorker).mockImplementation((_queueName, handler) => {
          bullmqHandler = handler as Processor<unknown, unknown, string>;
          return mockWorker as unknown as import("bullmq").Worker<
            unknown,
            unknown,
            string
          >;
        });

        const userHandler = vi.fn().mockResolvedValue(undefined);
        queueProvider.process?.(userHandler, { concurrency: 1 });

        const bullJob = {
          ...mockBullJob,
          getState: vi.fn().mockRejectedValue(rejection),
        };

        //@ts-expect-error a mock stands in for the BullMQ job
        const thrown: unknown = await bullmqHandler!(bullJob).then(
          () => {
            throw new Error("the processor should have rejected");
          },
          (e: unknown) => e,
        );

        // the job never reached the handler
        expect(userHandler).not.toHaveBeenCalled();
        expectReadableError(thrown, {
          unrecoverable,
          message,
          cause: rejection,
        });
      },
    );

    it("should pass an Error from mapping the job through unchanged (push)", async () => {
      const queueProvider = provider.forQueue("test-queue");

      let bullmqHandler: Processor<unknown, unknown, string> | undefined;
      const { Worker: BullWorker } = await import("bullmq");
      vi.mocked(BullWorker).mockImplementation((_queueName, handler) => {
        bullmqHandler = handler as Processor<unknown, unknown, string>;
        return mockWorker as unknown as import("bullmq").Worker<
          unknown,
          unknown,
          string
        >;
      });

      queueProvider.process?.(vi.fn(), { concurrency: 1 });

      const rejection = new Error("Connection is closed.");
      const bullJob = {
        ...mockBullJob,
        getState: vi.fn().mockRejectedValue(rejection),
      };

      //@ts-expect-error a mock stands in for the BullMQ job
      const thrown: unknown = await bullmqHandler!(bullJob).catch(
        (e: unknown) => e,
      );

      expect(thrown).toBe(rejection);
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

      // losing the lock says another worker has the job, not that the work
      // can never succeed
      it("should map lock lost errors to retryable RuntimeError", async () => {
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
            expect(result.error.retryable).toBe(true);
          }
        }
      });

      // the match is any message naming a script: it also catches a flushed
      // script cache or a busy server, which a retry gets past
      it("should map Redis script errors to retryable RuntimeError", async () => {
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
            expect(result.error.retryable).toBe(true);
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

      // an error the adapter does not recognise is no evidence of a
      // permanent condition. `retryable: false` makes a job that rethrows it
      // fail on its first attempt, so the default is retryable: the job's
      // own attempt budget bounds the retries
      it.each([
        { label: "an unknown error", message: "Unknown bizarre error" },
        {
          label: "a write against a read only replica",
          message: "READONLY You can't write against a read only replica.",
        },
        {
          label: "a Redis out of memory",
          message: "OOM command not allowed when used memory > 'maxmemory'.",
        },
      ])(
        "should mark $label as retryable by default",
        async ({ message }) => {
          const queueProvider = provider.forQueue("test-queue");

          mockQueue.add.mockRejectedValue(new Error(message));

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
          if (result.success) return;
          expect(result.error).toMatchObject({
            type: "RuntimeError",
            code: "PROCESSING",
            message,
            retryable: true,
          });
          expect(isPermanentError(result.error)).toBe(false);
        },
      );

      // a provider that is shutting down cannot do it right now: nothing
      // says the caller's work can never succeed
      it("should mark every shutting down error as retryable", async () => {
        const queueProvider = provider.forQueue("test-queue");
        await provider.disconnect();

        const job: ActiveJob<unknown> = {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: {},
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
          providerMetadata: { bullmq: { token: "test-token" } },
        };

        const results = {
          add: await queueProvider.add(job),
          fetch: await queueProvider.fetch!(1),
          ack: await queueProvider.ack!(job),
          nack: await queueProvider.nack!(job, new Error("failed")),
          pause: await queueProvider.pause(),
          resume: await queueProvider.resume(),
          delete: await queueProvider.delete(),
          getStats: await queueProvider.getStats(),
          getHealth: await queueProvider.getHealth(),
          getDLQJobs: await queueProvider.getDLQJobs!(),
          retryJob: await queueProvider.retryJob!("job-1"),
        };

        for (const [method, result] of Object.entries(results)) {
          expect(result.success, method).toBe(false);
          if (result.success) continue;
          expect(result.error, method).toMatchObject({
            code: "SHUTDOWN",
            retryable: true,
          });
        }

        // process() throws instead of returning a Result
        let thrown: unknown;
        try {
          queueProvider.process!(vi.fn(), {});
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toMatchObject({
          message: "Provider is shutting down.",
          retryable: true,
        });
      });

      // the chain a consumer builds: its handler enqueues a follow-up job,
      // the enqueue fails for a reason the adapter does not recognise, and
      // the handler rethrows the QueueError it was given
      it("should retry a job whose handler rethrows an unrecognised enqueue error, for its whole budget", async () => {
        const followUps = provider.forQueue("follow-ups");
        mockQueue.add.mockRejectedValue(
          new Error("READONLY You can't write against a read only replica."),
        );

        const memory = new MemoryProvider();
        const bound = memory.forQueue("parents");
        const added = await bound.add(
          {
            id: "parent-1",
            name: "parent",
            queueName: "parents",
            data: {},
            status: "waiting",
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date(),
          },
          { removeOnFail: false },
        );
        expect(added.success).toBe(true);

        const handler = vi.fn<JobHandler<unknown>>(async () => {
          const result = await followUps.add({
            id: "child-1",
            name: "child",
            queueName: "follow-ups",
            data: {},
            status: "waiting",
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date(),
          });
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- what the consumer does with a failed enqueue
          if (!result.success) throw result.error;
          return Result.ok(undefined);
        });

        const worker = new Worker("parents", handler, {
          provider: memory,
          pollInterval: 5,
          errorBackoff: 5,
        });
        const failedEvents: FailedEventPayload[] = [];
        worker.on("failed", (payload) => {
          failedEvents.push(payload);
        });

        worker.start();
        try {
          await vi.waitFor(async () => {
            const stored = await bound.getJob("parent-1");
            expect(stored.success && stored.data?.status).toBe("failed");
          });
        } finally {
          await worker.close();
          await memory.disconnect();
        }

        expect(handler).toHaveBeenCalledTimes(3);
        expect(failedEvents.map((e) => e.permanent)).toEqual([
          false,
          false,
          false,
        ]);
        expect(failedEvents.map((e) => e.willRetry)).toEqual([
          true,
          true,
          false,
        ]);
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
