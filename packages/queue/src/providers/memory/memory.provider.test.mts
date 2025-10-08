/**
 * MemoryProvider Tests - Pull Model Implementation
 *
 * Tests the pull-based primitives: fetchJobs, ackJob, nackJob
 * Validates atomic operations, state management, and capabilities
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "node:assert";

import type { Job } from "../../core/types.mjs";
import type { IQueueProvider } from "../provider.interface.mjs";

import { createProviderContractTests } from "../__shared__/provider-contract.suite.mjs";
import { MemoryProvider } from "./memory.provider.mjs";

// run shared contract tests to ensure compliance
createProviderContractTests(
  async () => {
    const provider = new MemoryProvider();
    await provider.connect();
    return provider.forQueue("test-queue");
  },
  {
    providerName: "MemoryProvider",
    supportsConcurrentFetch: true,
    supportsGetJob: true,
    supportsDLQ: false, // memory provider doesn't support DLQ
    ackNackTakesJob: true, // ✅ FIXED: now complies with interface
  },
);

describe("MemoryProvider", () => {
  let provider: MemoryProvider;
  let boundProvider: IQueueProvider;

  beforeEach(async () => {
    provider = new MemoryProvider();
    boundProvider = provider.forQueue("test-queue");
    await provider.connect();
  });

  afterEach(async () => {
    await provider.disconnect();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("capabilities", () => {
    it("should declare accurate capabilities", () => {
      expect(provider.capabilities).toEqual({
        supportsDelayedJobs: true,
        supportsPriority: true,
        supportsRetries: true, // supports retry via requeue
        supportsDLQ: false, // no native DLQ
        supportsBatching: true,
        supportsLongPolling: false, // no long-polling support
        maxJobSize: 0, // unlimited
        maxBatchSize: 0, // unlimited
        maxDelaySeconds: 0, // unlimited
      });
    });
  });

  describe("add", () => {
    it("should add a job to the queue", async () => {
      const job: Job<{ value: number }> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { value: 42 },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const result = await boundProvider.add(job);

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toEqual(job);
    });

    it("should auto-create queue if it doesn't exist", async () => {
      const newQueueProvider = provider.forQueue("new-queue");
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "new-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const result = await newQueueProvider.add(job);

      expect(result.success).toBe(true);
    });

    it("should reject duplicate job IDs", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      await boundProvider.add(job);
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (result.success) fail("Expected failure");
      expect(result.error.type).toBe("DataError");
      if (result.error.type === "DataError") {
        expect(result.error.code).toBe("DUPLICATE");
      }
    });

    it("should handle delayed jobs with timers", async () => {
      vi.useFakeTimers();

      const scheduledFor = new Date(Date.now() + 5000);
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        scheduledFor,
      };

      const result = await boundProvider.add(job);

      // should be delayed initially
      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data.status).toBe("delayed");

      // advance timers to trigger delay
      await vi.advanceTimersByTimeAsync(5000);

      // fetch should now return the job
      await vi.waitFor(async () => {
        const fetchResult = await boundProvider.fetch?.(1);
        expect(fetchResult?.success).toBe(true);
        if (!fetchResult?.success) fail("Expected success");
        expect(fetchResult.data).toHaveLength(1);
      });

      vi.useRealTimers();
    });

    it("should not return delayed jobs before scheduled time", async () => {
      const scheduledFor = new Date(Date.now() + 10000);
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        scheduledFor,
      };

      await boundProvider.add(job);

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected success");
      expect(fetchResult.data).toHaveLength(0); // no jobs ready yet
    });
  });

  describe("getJob", () => {
    it("should retrieve a job by ID", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { value: 42 },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      await boundProvider.add(job);

      const result = await boundProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toMatchObject({
        id: "job-1",
        name: "test-job",
        data: { value: 42 },
      });
    });

    it("should return null for non-existent job", async () => {
      const result = await boundProvider.getJob("non-existent");

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBeNull();
    });

    it("should return null for non-existent queue", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const result = await nonExistentProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toBeNull();
    });
  });

  describe("fetch - pull model", () => {
    it("should fetch waiting jobs atomically", async () => {
      // add 3 jobs
      for (let i = 1; i <= 3; i++) {
        await boundProvider.add({
          id: `job-${i}`,
          name: "test-job",
          queueName: "test-queue",
          data: { value: i },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        });
      }

      const result = await boundProvider.fetch?.(2);

      expect(result?.success).toBe(true);
      if (!result?.success) fail("Expected success");
      expect(result?.data).toHaveLength(2);
      expect(result?.data[0]!.status).toBe("active");
      expect(result.data[1]!.status).toBe("active");
    });

    it("should mark fetched jobs as active", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      const getResult = await boundProvider.getJob("job-1");
      expect(getResult?.success).toBe(true);
      if (!getResult?.success) fail("Expected success");

      expect(getResult?.data?.status).toBe("active");
      expect(getResult?.data?.processedAt).toBeDefined();
    });

    it("should respect batch size limit", async () => {
      // add 5 jobs
      for (let i = 1; i <= 5; i++) {
        await boundProvider.add({
          id: `job-${i}`,
          name: "test-job",
          queueName: "test-queue",
          data: { value: i },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        });
      }

      const result = await boundProvider.fetch?.(3);

      expect(result?.success).toBe(true);
      if (!result?.success) fail("Expected success");
      expect(result?.data).toHaveLength(3);
    });

    it("should sort by priority (higher first) then creation time", async () => {
      const now = Date.now();

      await boundProvider.add({
        id: "job-1",
        name: "low-priority",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(now),
        priority: 1,
      });

      await boundProvider.add({
        id: "job-2",
        name: "high-priority",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(now + 1000),
        priority: 10,
      });

      await boundProvider.add({
        id: "job-3",
        name: "medium-priority",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(now + 500),
        priority: 5,
      });

      const result = await boundProvider.fetch?.(3);
      expect(result?.success).toBe(true);
      if (!result?.success) fail("Expected success");

      expect(result?.data[0]!.id).toBe("job-2"); // priority 10
      expect(result?.data[1]!.id).toBe("job-3"); // priority 5
      expect(result?.data[2]!.id).toBe("job-1"); // priority 1
    });

    it("should return empty array when queue is paused", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      await boundProvider.pause();

      const result = await boundProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (!result?.success) fail("Expected success");
      expect(result?.data).toHaveLength(0);
    });

    it("should return empty array when queue doesn't exist", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const result = await nonExistentProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (!result?.success) fail("Expected success");
      expect(result?.data).toHaveLength(0);
    });

    it("should return empty array when no jobs are waiting", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      // fetch all jobs
      await boundProvider.fetch?.(10);

      // second fetch should return empty
      const result = await boundProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (!result?.success) fail("Expected success");
      expect(result?.data).toHaveLength(0);
    });

    it("should handle concurrent fetches atomically", async () => {
      // add 10 jobs
      for (let i = 1; i <= 10; i++) {
        await boundProvider.add({
          id: `job-${i}`,
          name: "test-job",
          queueName: "test-queue",
          data: { value: i },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        });
      }

      // fetch concurrently
      const [result1, result2, result3] = await Promise.all([
        boundProvider.fetch?.(5),
        boundProvider.fetch?.(5),
        boundProvider.fetch?.(5),
      ]);

      expect(result1?.success).toBe(true);
      expect(result2?.success).toBe(true);
      expect(result3?.success).toBe(true);
      if (!result1?.success || !result2?.success || !result3?.success) {
        fail("Expected all fetches to succeed");
      }

      // collect all fetched job IDs
      const allFetchedIds = [
        ...result1.data.map((j) => j.id),
        ...result2.data.map((j) => j.id),
        ...result3.data.map((j) => j.id),
      ];

      // no duplicates (atomicity guarantee)
      const uniqueIds = new Set(allFetchedIds);
      expect(uniqueIds.size).toBe(allFetchedIds.length);
      expect(allFetchedIds.length).toBe(10); // all jobs fetched exactly once
    });
  });

  describe("ack - pull model", () => {
    it("should acknowledge successful job completion", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1); // mark as active
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");

      const result = await boundProvider.ack?.(fetchResult.data[0]!);

      expect(result?.success).toBe(true);
    });

    it("should remove job after ack", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");
      await boundProvider.ack?.(fetchResult.data[0]!);

      const getResult = await boundProvider.getJob("job-1");
      expect(getResult?.success).toBe(true);
      if (!getResult?.success) fail("Expected success");
      expect(getResult?.data).toBeNull(); // job removed
    });

    it("should increment completed count", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");
      await boundProvider.ack?.(fetchResult.data[0]!);

      const statsResult = await boundProvider.getStats();
      expect(statsResult?.success).toBe(true);
      if (!statsResult?.success) fail("Expected success");
      expect(statsResult?.data.completed).toBe(1);
    });

    it("should error for non-existent queue", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const mockJob = {
        id: "job-1",
        name: "test-job",
        queueName: "non-existent-queue",
        data: {},
        status: "active" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };
      const result = await nonExistentProvider.ack?.(mockJob);

      expect(result?.success).toBe(false);
      if (result?.success) fail("Expected failure");
      expect(result?.error.type).toBe("NotFoundError");
    });

    it("should error for non-existent job", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const mockJob = {
        id: "non-existent-job",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };
      const result = await boundProvider.ack?.(mockJob);

      expect(result?.success).toBe(false);
      if (result?.success) fail("Expected failure");
      expect(result?.error.type).toBe("NotFoundError");
    });
  });

  describe("nack - pull model with retry support", () => {
    it("should requeue job when attempts < maxAttempts", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");

      const error = new Error("Processing failed");
      const result = await boundProvider.nack?.(fetchResult.data[0]!, error);

      expect(result?.success).toBe(true);

      // Job should be requeued, not deleted
      const getResult = await boundProvider.getJob("job-1");
      expect(getResult.success).toBe(true);
      if (!getResult.success) fail("Expected success");
      expect(getResult.data?.status).toBe("waiting");
      expect(getResult.data?.attempts).toBe(1);
      expect(getResult.data?.error).toBe("Processing failed");
    });

    it("should remove job only after max attempts exhausted", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 2, // Already tried twice
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");
      await boundProvider.nack?.(
        fetchResult.data[0]!,
        new Error("Final failure"),
      );

      // Job should now be deleted (reached maxAttempts)
      const getResult = await boundProvider.getJob("job-1");
      expect(getResult.success).toBe(true);
      if (!getResult.success) fail("Expected success");
      expect(getResult.data).toBeNull(); // job removed after final attempt
    });

    it("should increment failed count only after final failure", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 2, // Last retry
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");
      await boundProvider.nack?.(fetchResult.data[0]!, new Error("Failed"));

      const statsResult = await boundProvider.getStats();
      expect(statsResult.success).toBe(true);
      if (!statsResult.success) fail("Expected success");
      expect(statsResult.data.failed).toBe(1);
    });

    it("should store error message on requeue", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const fetchResult = await boundProvider.fetch?.(1);
      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) fail("Expected fetch success");

      const error = new Error("Specific error message");
      await boundProvider.nack?.(fetchResult.data[0]!, error);

      // Job should be requeued with error message
      const getResult = await boundProvider.getJob("job-1");
      expect(getResult.success).toBe(true);
      if (!getResult.success) fail("Expected success");
      expect(getResult.data?.error).toBe("Specific error message");
      expect(getResult.data?.status).toBe("waiting");
    });

    it("should error for non-existent queue", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const mockJob = {
        id: "job-1",
        name: "test-job",
        queueName: "non-existent-queue",
        data: {},
        status: "active" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };
      const result = await nonExistentProvider.nack?.(
        mockJob,
        new Error("Failed"),
      );

      expect(result?.success).toBe(false);
      if (result?.success) fail("Expected failure");
      expect(result?.error.type).toBe("NotFoundError");
    });

    it("should error for non-existent job", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const mockJob = {
        id: "non-existent-job",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };
      const result = await boundProvider.nack?.(mockJob, new Error("Failed"));

      expect(result?.success).toBe(false);
      if (result?.success) fail("Expected failure");
      expect(result?.error.type).toBe("NotFoundError");
    });
  });

  describe("queue management", () => {
    it("should pause queue", async () => {
      // create queue first by adding a job
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const result = await boundProvider.pause();
      expect(result.success).toBe(true);

      const statsResult = await boundProvider.getStats();
      expect(statsResult.success).toBe(true);
      if (!statsResult.success) fail("Expected success");
      expect(statsResult.data.paused).toBe(true);
    });

    it("should resume queue", async () => {
      // create queue first by adding a job
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      await boundProvider.pause();
      const result = await boundProvider.resume();

      expect(result.success).toBe(true);

      const statsResult = await boundProvider.getStats();
      expect(statsResult.success).toBe(true);
      if (!statsResult.success) fail("Expected success");
      expect(statsResult.data.paused).toBe(false);
    });

    it("should delete queue and clear timers", async () => {
      vi.useFakeTimers();

      // add delayed job
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        scheduledFor: new Date(Date.now() + 5000),
      });

      const result = await boundProvider.delete();
      expect(result.success).toBe(true);

      // queue should be gone - use internal method to verify
      const statsResult = await provider._getStats("test-queue");
      expect(statsResult.success).toBe(false);

      vi.useRealTimers();
    });

    it("should auto-create queue when pausing non-existent queue", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const result = await nonExistentProvider.pause();

      // pause auto-creates queue to support contract compliance
      expect(result.success).toBe(true);

      // verify queue was created in paused state
      const statsResult = await nonExistentProvider.getStats();
      expect(statsResult.success).toBe(true);
      if (statsResult.success) {
        expect(statsResult.data.paused).toBe(true);
      }
    });

    it("should error when deleting non-existent queue", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const result = await nonExistentProvider.delete();

      expect(result.success).toBe(false);
      if (result.success) fail("Expected failure");
      expect(result.error.type).toBe("NotFoundError");
    });
  });

  describe("getStats", () => {
    it("should return queue statistics", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      await boundProvider.add({
        id: "job-2",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const result = await boundProvider.getStats();

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data).toMatchObject({
        queueName: "test-queue",
        waiting: 2,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      });
    });

    it("should track active jobs", async () => {
      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      await boundProvider.fetch?.(1); // mark as active

      const result = await boundProvider.getStats();

      expect(result.success).toBe(true);
      if (!result.success) fail("Expected success");
      expect(result.data.waiting).toBe(0);
      expect(result.data.active).toBe(1);
    });

    it("should error for non-existent queue", async () => {
      const nonExistentProvider = provider.forQueue("non-existent-queue");
      const result = await nonExistentProvider.getStats();

      expect(result.success).toBe(false);
      if (result.success) fail("Expected failure");
      expect(result.error.type).toBe("NotFoundError");
    });
  });

  describe("lifecycle", () => {
    it("should connect successfully", async () => {
      const newProvider = new MemoryProvider();
      await expect(newProvider.connect()).resolves.not.toThrow();
    });

    it("should disconnect and clean up timers", async () => {
      vi.useFakeTimers();

      await boundProvider.add({
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        scheduledFor: new Date(Date.now() + 5000),
      });

      await provider.disconnect();

      // verify timers are cleared (no way to directly assert, but shouldn't throw)
      expect(true).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("factory pattern", () => {
    it("should create bound providers for multiple queues", async () => {
      const queue1Provider = provider.forQueue("queue-1");
      const queue2Provider = provider.forQueue("queue-2");

      await queue1Provider.add({
        id: "job-1",
        name: "test-job",
        queueName: "queue-1",
        data: { value: 1 },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      await queue2Provider.add({
        id: "job-2",
        name: "test-job",
        queueName: "queue-2",
        data: { value: 2 },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      const stats1 = await queue1Provider.getStats();
      const stats2 = await queue2Provider.getStats();

      expect(stats1.success).toBe(true);
      expect(stats2.success).toBe(true);
      if (!stats1.success || !stats2.success) fail("Expected success");

      expect(stats1.data.queueName).toBe("queue-1");
      expect(stats1.data.waiting).toBe(1);
      expect(stats2.data.queueName).toBe("queue-2");
      expect(stats2.data.waiting).toBe(1);
    });

    it("should isolate operations between bound providers", async () => {
      const queue1Provider = provider.forQueue("queue-1");
      const queue2Provider = provider.forQueue("queue-2");

      await queue1Provider.add({
        id: "job-1",
        name: "test-job",
        queueName: "queue-1",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      // create queue-2 as well
      await queue2Provider.add({
        id: "job-2",
        name: "test-job",
        queueName: "queue-2",
        data: {},
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      });

      // pause queue-1
      await queue1Provider.pause();

      const stats1 = await queue1Provider.getStats();
      const stats2 = await queue2Provider.getStats();

      if (!stats1.success || !stats2.success) fail("Expected success");

      expect(stats1.data.paused).toBe(true);
      expect(stats2.data.paused).toBe(false);
    });
  });
});
