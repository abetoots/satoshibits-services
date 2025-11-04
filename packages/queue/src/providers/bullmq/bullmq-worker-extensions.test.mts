/**
 * BullMQWorkerExtensions Tests
 *
 * Tests the BullMQ-specific worker extensions for accessing the underlying BullMQ Worker instance.
 * These extensions are exposed via the worker.bullmq namespace.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Worker } from "../../api/worker.mjs";
import {
  createBullMQMocks,
  setupBullMQMockDefaults,
} from "../../test-utils.mjs";
import { BullMQProvider } from "./bullmq.provider.mjs";

// create BullMQ mocks using test-utils helper
const mocks = createBullMQMocks();
const { mockWorker } = mocks;

// mock BullMQ module (hoisted)
vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  return {
    ...actual,
    Queue: vi.fn().mockImplementation(() => mocks.mockQueue),
    Worker: vi.fn().mockImplementation(() => mockWorker),
    QueueEvents: vi.fn().mockImplementation(() => mocks.mockQueueEvents),
  };
});

describe("BullMQWorkerExtensions", () => {
  let provider: BullMQProvider;
  let worker: Worker;

  beforeEach(() => {
    vi.clearAllMocks();
    setupBullMQMockDefaults(mocks);

    provider = new BullMQProvider({
      connection: { host: "localhost", port: 6379 },
      prefix: "test",
    });

    // create worker instance
    worker = new Worker(
      "test-queue",
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => ({ success: true, data: undefined }),
      {
        provider: provider.forQueue("test-queue"),
        concurrency: 1,
      },
    );
  });

  describe("worker.bullmq property", () => {
    it("should return extensions for BullMQ provider", () => {
      expect(worker.bullmq).toBeDefined();
      expect(worker.bullmq).toHaveProperty("getBullMQWorker");
    });

    it("should return undefined for non-BullMQ providers", () => {
      // create worker with no provider (defaults to Memory)
      const memoryWorker = new Worker(
        "test-queue",
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => ({ success: true, data: undefined }),
        {
          concurrency: 1,
        },
      );

      expect(memoryWorker.bullmq).toBeUndefined();
    });

    it("should memoize the extensions instance", () => {
      const ext1 = worker.bullmq;
      const ext2 = worker.bullmq;

      expect(ext1).toBe(ext2);
    });
  });

  describe("getBullMQWorker()", () => {
    it("should return undefined before worker.start()", () => {
      const extensions = worker.bullmq;
      expect(extensions).toBeDefined();

      const result = extensions!.getBullMQWorker();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }
    });

    it("should return BullMQ Worker instance after worker.start()", () => {
      const extensions = worker.bullmq;
      expect(extensions).toBeDefined();

      // start the worker (creates BullMQ Worker instance)
      worker.start();

      const result = extensions!.getBullMQWorker();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        // verify it's the mocked BullMQ Worker
        expect(result.data).toBe(mockWorker);
      }
    });

    it("should return undefined after worker.close()", async () => {
      const extensions = worker.bullmq;
      expect(extensions).toBeDefined();

      // start then close the worker
      worker.start();
      await worker.close();

      const result = extensions!.getBullMQWorker();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }
    });

    it("should be stateless and reflect current worker state", () => {
      const extensions = worker.bullmq;
      expect(extensions).toBeDefined();

      // check before start
      let result = extensions!.getBullMQWorker();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }

      // start worker
      worker.start();

      // check after start
      result = extensions!.getBullMQWorker();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
      }
    });
  });

  describe("error handling", () => {
    it("should handle provider errors gracefully", () => {
      const extensions = worker.bullmq;
      expect(extensions).toBeDefined();

      // mock getBullMQWorker to throw error
      const originalGetBullMQWorker = provider.getBullMQWorker;
      vi.spyOn(provider, "getBullMQWorker").mockImplementation(() => {
        throw new Error("Provider error");
      });

      const result = extensions!.getBullMQWorker();

      // should return Result.err, not throw
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("RuntimeError");
        expect(result.error.message).toContain("Provider error");
      }

      // restore original implementation
      provider.getBullMQWorker = originalGetBullMQWorker;
    });
  });

  describe("type safety", () => {
    it("should work with TypeScript type guards", () => {
      // this test primarily validates TypeScript compilation
      if (worker.bullmq) {
        const result = worker.bullmq.getBullMQWorker();
        expect(result).toBeDefined();

        if (result.success && result.data) {
          // TypeScript should know result.data is BullMQ Worker
          expect(result.data).toBeDefined();
        }
      }
    });
  });

  describe("integration with Worker lifecycle", () => {
    it("should work across multiple start/stop cycles", async () => {
      const extensions = worker.bullmq;
      expect(extensions).toBeDefined();

      // cycle 1
      worker.start();
      let result = extensions!.getBullMQWorker();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
      }

      await worker.close();
      result = extensions!.getBullMQWorker();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }

      // cycle 2
      worker.start();
      result = extensions!.getBullMQWorker();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
      }

      await worker.close();
    });
  });
});
