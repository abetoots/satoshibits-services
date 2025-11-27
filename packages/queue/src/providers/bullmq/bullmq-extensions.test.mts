/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * BullMQExtensions Tests
 *
 * Tests the BullMQ-specific extensions for advanced features like recurring job schedulers.
 * These extensions are exposed via the queue.bullmq namespace.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IBullMQExtensions } from "./bullmq-extensions.interface.mjs";

import {
  createBullMQMocks,
  setupBullMQMockDefaults,
} from "../../test-utils.mjs";
import { BullMQProvider } from "./bullmq.provider.mjs";

// create BullMQ mocks using test-utils helper
const mocks = createBullMQMocks();
const { mockQueue } = mocks;

// extend mockQueue with scheduler methods (for TypeScript)
type ExtendedMockQueue = typeof mockQueue & {
  upsertJobScheduler: ReturnType<typeof vi.fn>;
  getJobSchedulers: ReturnType<typeof vi.fn>;
  removeJobScheduler: ReturnType<typeof vi.fn>;
};

// mock BullMQ module (hoisted)
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  return {
    ...actual,
    Queue: vi.fn().mockImplementation(() => mockQueue),
    Worker: vi.fn().mockImplementation(() => mocks.mockWorker),
    QueueEvents: vi.fn().mockImplementation(() => mocks.mockQueueEvents),
  };
});

describe("BullMQExtensions", () => {
  let provider: BullMQProvider;
  let extensions: IBullMQExtensions;

  beforeEach(() => {
    vi.clearAllMocks();
    setupBullMQMockDefaults(mocks);

    provider = new BullMQProvider({
      connection: { host: "localhost", port: 6379 },
      prefix: "test",
    });

    // get bound provider and extensions
    const boundProvider = provider.forQueue("test-queue");
    // @ts-expect-error - getBullMQExtensions is BullMQ-specific and not part of IQueueProvider interface
    extensions = boundProvider.getBullMQExtensions() as IBullMQExtensions;
  });

  describe("upsertJobScheduler", () => {
    it("should create a recurring job scheduler with basic options", async () => {
      const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined);
      (mockQueue as ExtendedMockQueue).upsertJobScheduler =
        mockUpsertJobScheduler;

      const result = await extensions.upsertJobScheduler("daily-cleanup", {
        pattern: "0 2 * * *",
        jobName: "cleanup",
        data: { type: "daily" },
      });

      expect(result.success).toBe(true);
      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "daily-cleanup",
        {
          pattern: "0 2 * * *",
        },
        {
          name: "cleanup",
          data: { type: "daily" },
          opts: {
            // provider defaults are merged
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        },
      );
    });

    it("should create a scheduler with timezone", async () => {
      const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined);
      (mockQueue as ExtendedMockQueue).upsertJobScheduler =
        mockUpsertJobScheduler;

      const result = await extensions.upsertJobScheduler("daily-report", {
        pattern: "0 9 * * *",
        jobName: "generate-report",
        data: { reportType: "daily" },
        timezone: "America/New_York",
      });

      expect(result.success).toBe(true);
      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "daily-report",
        {
          pattern: "0 9 * * *",
          tz: "America/New_York",
        },
        {
          name: "generate-report",
          data: { reportType: "daily" },
          opts: {
            // provider defaults are merged
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        },
      );
    });

    it("should create a scheduler with job options", async () => {
      const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined);
      (mockQueue as ExtendedMockQueue).upsertJobScheduler =
        mockUpsertJobScheduler;

      const result = await extensions.upsertJobScheduler("hourly-task", {
        pattern: "0 * * * *",
        jobName: "task",
        data: { foo: "bar" },
        jobOptions: {
          priority: 10,
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
        },
      });

      expect(result.success).toBe(true);
      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "hourly-task",
        {
          pattern: "0 * * * *",
        },
        {
          name: "task",
          data: { foo: "bar" },
          opts: {
            // user options override provider defaults
            priority: 10,
            attempts: 5,
            backoff: { type: "exponential", delay: 5000 },
            // but provider defaults are still present
            removeOnComplete: true,
            removeOnFail: false,
          },
        },
      );
    });

    it("should return error when BullMQ throws", async () => {
      const mockUpsertJobScheduler = vi
        .fn()
        .mockRejectedValue(new Error("Redis connection failed"));
      (mockQueue as ExtendedMockQueue).upsertJobScheduler =
        mockUpsertJobScheduler;

      const result = await extensions.upsertJobScheduler("failing-scheduler", {
        pattern: "0 0 * * *",
        jobName: "test",
        data: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error;
        expect(error.type).toBe("RuntimeError");
        expect(error.message).toContain("Redis connection failed");
      }
    });
  });

  describe("getJobSchedulers", () => {
    it("should return all job schedulers", async () => {
      const mockSchedulers = [
        {
          id: "daily-cleanup",
          pattern: "0 2 * * *",
          name: "cleanup",
          next: Date.now() + 3600000,
          tz: undefined,
        },
        {
          id: "hourly-task",
          pattern: "0 * * * *",
          name: "task",
          next: Date.now() + 1800000,
          tz: "America/New_York",
        },
      ];

      const mockGetJobSchedulers = vi.fn().mockResolvedValue(mockSchedulers);
      (mockQueue as ExtendedMockQueue).getJobSchedulers = mockGetJobSchedulers;

      const result = await extensions.getJobSchedulers();

      expect(result.success).toBe(true);
      if (result.success) {
        const schedulers = result.data;
        expect(schedulers).toHaveLength(2);
        expect(schedulers[0]?.id).toBe("daily-cleanup");
        expect(schedulers[0]?.pattern).toBe("0 2 * * *");
        expect(schedulers[0]?.jobName).toBe("cleanup");
        expect(schedulers[0]?.next).toBeInstanceOf(Date);
        expect(schedulers[0]?.timezone).toBeUndefined();

        expect(schedulers[1]?.id).toBe("hourly-task");
        expect(schedulers[1]?.timezone).toBe("America/New_York");
      }
    });

    it("should return empty array when no schedulers exist", async () => {
      const mockGetJobSchedulers = vi.fn().mockResolvedValue([]);
      (mockQueue as ExtendedMockQueue).getJobSchedulers = mockGetJobSchedulers;

      const result = await extensions.getJobSchedulers();

      expect(result.success).toBe(true);
      if (result.success) {
        const schedulers = result.data;
        expect(schedulers).toHaveLength(0);
      }
    });

    it("should return error when BullMQ throws", async () => {
      const mockGetJobSchedulers = vi
        .fn()
        .mockRejectedValue(new Error("Redis timeout"));
      (mockQueue as ExtendedMockQueue).getJobSchedulers = mockGetJobSchedulers;

      const result = await extensions.getJobSchedulers();

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error;
        expect(error.type).toBe("RuntimeError");
        expect(error.message).toContain("timeout");
      }
    });
  });

  describe("removeJobScheduler", () => {
    it("should remove a job scheduler", async () => {
      const mockRemoveJobScheduler = vi.fn().mockResolvedValue(true);
      (mockQueue as ExtendedMockQueue).removeJobScheduler =
        mockRemoveJobScheduler;

      const result = await extensions.removeJobScheduler("daily-cleanup");

      expect(result.success).toBe(true);
      expect(mockRemoveJobScheduler).toHaveBeenCalledWith("daily-cleanup");
    });

    it("should succeed even if scheduler doesn't exist", async () => {
      const mockRemoveJobScheduler = vi.fn().mockResolvedValue(false);
      (mockQueue as ExtendedMockQueue).removeJobScheduler =
        mockRemoveJobScheduler;

      const result = await extensions.removeJobScheduler("non-existent");

      expect(result.success).toBe(true);
      expect(mockRemoveJobScheduler).toHaveBeenCalledWith("non-existent");
    });

    it("should return error when BullMQ throws", async () => {
      const mockRemoveJobScheduler = vi
        .fn()
        .mockRejectedValue(new Error("Connection lost"));
      (mockQueue as ExtendedMockQueue).removeJobScheduler =
        mockRemoveJobScheduler;

      const result = await extensions.removeJobScheduler("test-scheduler");

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error;
        expect(error.type).toBe("RuntimeError");
        expect(error.message).toContain("Connection lost");
      }
    });
  });

  describe("Queue not found error handling", () => {
    it("should return error when queue is not found for upsertJobScheduler", async () => {
      // create a provider and bound provider where queue doesn't exist
      const newProvider = new BullMQProvider({
        connection: { host: "localhost", port: 6379 },
      });

      const boundProvider = newProvider.forQueue("non-existent-queue");
      // @ts-expect-error - getBullMQExtensions is BullMQ-specific and not part of IQueueProvider interface
      const ext = boundProvider.getBullMQExtensions() as IBullMQExtensions;

      // mock getBullMQQueue to return undefined
      vi.spyOn(newProvider, "getBullMQQueue").mockReturnValue(undefined);

      const result = await ext.upsertJobScheduler("test", {
        pattern: "0 0 * * *",
        jobName: "test",
        data: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error;
        expect(error.type).toBe("ConfigurationError");
        expect(error.code).toBe("INVALID_CONFIG");
        expect(error.message).toContain("non-existent-queue");
      }
    });

    it("should return error when queue is not found for getJobSchedulers", async () => {
      const newProvider = new BullMQProvider({
        connection: { host: "localhost", port: 6379 },
      });

      const boundProvider = newProvider.forQueue("non-existent-queue");
      // @ts-expect-error - getBullMQExtensions is BullMQ-specific and not part of IQueueProvider interface
      const ext = boundProvider.getBullMQExtensions() as IBullMQExtensions;

      vi.spyOn(newProvider, "getBullMQQueue").mockReturnValue(undefined);

      const result = await ext.getJobSchedulers();

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error;
        expect(error.type).toBe("ConfigurationError");
      }
    });

    it("should return error when queue is not found for removeJobScheduler", async () => {
      const newProvider = new BullMQProvider({
        connection: { host: "localhost", port: 6379 },
      });

      const boundProvider = newProvider.forQueue("non-existent-queue");
      // @ts-expect-error - getBullMQExtensions is BullMQ-specific and not part of IQueueProvider interface
      const ext = boundProvider.getBullMQExtensions() as IBullMQExtensions;

      vi.spyOn(newProvider, "getBullMQQueue").mockReturnValue(undefined);

      const result = await ext.removeJobScheduler("test");

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error;
        expect(error.type).toBe("ConfigurationError");
      }
    });
  });

  describe("getBullMQQueue", () => {
    it("should return the underlying BullMQ Queue instance", () => {
      const result = extensions.getBullMQQueue();

      expect(result.success).toBe(true);
      if (result.success) {
        // the mock queue should be returned
        expect(result.data).toBeDefined();
        expect(result.data).toBe(mockQueue);
      }
    });

    it("should return undefined when queue is not initialized", () => {
      const newProvider = new BullMQProvider({
        connection: { host: "localhost", port: 6379 },
      });
      const boundProvider = newProvider.forQueue("uninitialized-queue");
      // @ts-expect-error - getBullMQExtensions is BullMQ-specific
      const ext = boundProvider.getBullMQExtensions() as IBullMQExtensions;

      vi.spyOn(newProvider, "getBullMQQueue").mockReturnValue(undefined);

      const result = ext.getBullMQQueue();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }
    });
  });
});
