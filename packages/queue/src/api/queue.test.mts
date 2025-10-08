/**
 * Queue Tests - API Layer with Warn-and-Degrade
 *
 * Tests the thin API layer that validates inputs and checks provider capabilities
 */

import { Result } from "@satoshibits/functional";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "node:assert";

import type { Job } from "../core/types.mjs";
import type { IQueueProvider } from "../providers/provider.interface.mjs";

import {
  createMockProviderForAPITests,
  expectError,
  expectSuccess,
} from "../test-utils.mjs";
import { Queue } from "./queue.mjs";

describe("Queue", () => {
  let mockProvider: IQueueProvider;
  let queue: Queue<unknown>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockProvider = createMockProviderForAPITests({
      capabilities: {
        supportsDelayedJobs: true,
        supportsPriority: true,
        supportsDLQ: true,
      },
      queueName: "test-queue",
    });

    queue = new Queue("test-queue", {
      provider: mockProvider,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onUnsupportedFeature: () => {}, // silent by default for tests
      defaultJobOptions: {
        attempts: 3,
        jobId: () => `test-${Date.now()}`,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("add", () => {
    it("should add a job successfully", async () => {
      const job = expectSuccess(await queue.add("test-job", { value: 42 }));

      expect(job).toMatchObject({
        name: "test-job",
        queueName: "test-queue",
        data: { value: 42 },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
      });

      expect(mockProvider.add).toHaveBeenCalledOnce();
    });

    it("should generate job ID if not provided", async () => {
      const job = expectSuccess(await queue.add("test-job", {}));

      expect(job.id).toBeDefined();
      expect(typeof job.id).toBe("string");
    });

    it("should use provided job ID", async () => {
      const job = expectSuccess(
        await queue.add("test-job", {}, { jobId: "custom-id" }),
      );

      expect(job.id).toBe("custom-id");
    });

    it("should merge default options with provided options", async () => {
      const queueWithDefaults = new Queue("test-queue", {
        provider: mockProvider,
        defaultJobOptions: {
          attempts: 5,
          jobId: () => `test-${Date.now()}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onUnsupportedFeature: () => {}, // silent for tests
      });

      await queueWithDefaults.add("test-job", {}, { priority: 1 });

      const addCall = vi.mocked(mockProvider.add).mock.calls[0];
      const job = addCall?.[0];
      if (!job) fail("Expected job to be passed to add");

      expect(job.maxAttempts).toBe(5);
      expect(job.priority).toBe(1);
    });

    it("should warn and degrade gracefully when delayed jobs are not supported", async () => {
      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsDelayedJobs = false;

      // create queue with custom warn handler
      const customWarn = vi.fn();
      const queueWithWarn = new Queue("test-queue", {
        provider: mockProvider,
        onUnsupportedFeature: customWarn,
        defaultJobOptions: {
          attempts: 3,
          jobId: () => `test-${Date.now()}`,
        },
      });

      const result = await queueWithWarn.add(
        "test-job",
        { value: 42 },
        { delay: 5000 },
      );

      // verify warning was emitted
      expect(customWarn).toHaveBeenCalledWith(
        expect.stringContaining("does not support delayed jobs"),
      );

      // verify delay was removed from job
      const addCall = vi.mocked(mockProvider.add).mock.calls[0];
      const job = addCall?.[0];
      expect(job?.scheduledFor).toBeUndefined();

      // CRITICAL: verify job was still added successfully (degrade part)
      const addedJob = expectSuccess(result);
      expect(addedJob.id).toBeDefined();
      expect(addedJob.data).toEqual({ value: 42 });
      expect(addedJob.status).toBe("waiting"); // added as immediate job
    });

    it("should warn and degrade gracefully when priority is not supported", async () => {
      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsPriority = false;

      // create queue with custom warn handler
      const customWarn = vi.fn();
      const queueWithWarn = new Queue("test-queue", {
        provider: mockProvider,
        onUnsupportedFeature: customWarn,
        defaultJobOptions: {
          attempts: 3,
          jobId: () => `test-${Date.now()}`,
        },
      });

      const result = await queueWithWarn.add(
        "test-job",
        { task: "process" },
        { priority: 10 },
      );

      // verify warning was emitted
      expect(customWarn).toHaveBeenCalledWith(
        expect.stringContaining("does not support job priorities"),
      );

      // verify priority was removed from job
      const addCall = vi.mocked(mockProvider.add).mock.calls[0];
      const job = addCall?.[0];
      expect(job?.priority).toBeUndefined();

      // CRITICAL: verify job was still added successfully (degrade part)
      const addedJob = expectSuccess(result);
      expect(addedJob.id).toBeDefined();
      expect(addedJob.data).toEqual({ task: "process" });
      expect(addedJob.status).toBe("waiting"); // added without priority
    });

    it("should NOT mutate original options object when sanitizing (immutability)", async () => {
      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsPriority = false;
      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsDelayedJobs = false;

      const originalOptions = {
        priority: 10,
        delay: 5000,
        attempts: 3,
        metadata: { source: "test" },
      };

      // create a deep copy for comparison
      const optionsCopy = JSON.parse(JSON.stringify(originalOptions)) as Record<
        string,
        unknown
      >;

      await queue.add("test-job", { task: "process" }, originalOptions);

      // CRITICAL: verify original options object is unchanged (immutability)
      expect(originalOptions).toEqual(optionsCopy);
      expect(originalOptions.priority).toBe(10); // still present in original
      expect(originalOptions.delay).toBe(5000); // still present in original
      expect(originalOptions.attempts).toBe(3);
      expect(originalOptions.metadata).toEqual({ source: "test" });
    });

    it("should use custom warning callback if provided", async () => {
      const customWarn = vi.fn();
      const queueWithCallback = new Queue("test-queue", {
        provider: mockProvider,
        onUnsupportedFeature: customWarn,
        defaultJobOptions: {
          attempts: 3,
          jobId: () => `test-${Date.now()}`,
        },
      });

      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsPriority = false;

      await queueWithCallback.add("test-job", {}, { priority: 1 });

      expect(customWarn).toHaveBeenCalledWith(
        expect.stringContaining("does not support job priorities"),
      );
      expect(warnSpy).not.toHaveBeenCalled(); // console.warn not used
    });

    it("should handle multiple unsupported features", async () => {
      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsDelayedJobs = false;
      // @ts-expect-error - mutating readonly property for test
      mockProvider.capabilities.supportsPriority = false;

      // create queue with custom warn handler
      const customWarn = vi.fn();
      const queueWithWarn = new Queue("test-queue", {
        provider: mockProvider,
        onUnsupportedFeature: customWarn,
        defaultJobOptions: {
          attempts: 3,
          jobId: () => `test-${Date.now()}`,
        },
      });

      await queueWithWarn.add("test-job", {}, { delay: 5000, priority: 1 });

      expect(customWarn).toHaveBeenCalledTimes(2);
      expect(customWarn).toHaveBeenCalledWith(
        expect.stringContaining("delayed jobs"),
      );
      expect(customWarn).toHaveBeenCalledWith(
        expect.stringContaining("priorities"),
      );
    });

    it("should set scheduledFor when delay is supported", async () => {
      const beforeAdd = Date.now();
      await queue.add("test-job", {}, { delay: 5000 });
      const afterAdd = Date.now();

      const addCall = vi.mocked(mockProvider.add).mock.calls[0];
      const job = addCall?.[0];
      if (!job) fail("Expected job to be passed to add");

      expect(job.scheduledFor).toBeDefined();
      const scheduledTime = job.scheduledFor!.getTime();

      // should be roughly 5 seconds from now
      expect(scheduledTime).toBeGreaterThanOrEqual(beforeAdd + 5000);
      expect(scheduledTime).toBeLessThanOrEqual(afterAdd + 5000);
    });

    it("should include metadata", async () => {
      await queue.add(
        "test-job",
        {},
        {
          metadata: { userId: "123", source: "api" },
        },
      );

      const addCall = vi.mocked(mockProvider.add).mock.calls[0];
      const job = addCall?.[0];
      if (!job) fail("Expected job to be passed to add");

      expect(job.metadata).toEqual({ userId: "123", source: "api" });
    });

    it("should return error when provider fails", async () => {
      vi.mocked(mockProvider.add).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Provider connection failed",
          retryable: true,
        }),
      );

      const error = expectError(await queue.add("test-job", {}));

      expect(error.type).toBe("RuntimeError");
      expect(error.message).toBe("Provider connection failed");
    });
  });

  describe("getJob", () => {
    it("should retrieve a job by ID", async () => {
      const mockJob: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { value: 42 },
        status: "waiting",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.getJob).mockResolvedValueOnce(Result.ok(mockJob));

      const job = expectSuccess(await queue.getJob("job-1"));

      expect(job).toEqual(mockJob);
      expect(mockProvider.getJob).toHaveBeenCalledWith("job-1");
    });

    it("should return null for non-existent job", async () => {
      vi.mocked(mockProvider.getJob).mockResolvedValueOnce(Result.ok(null));

      const job = expectSuccess(await queue.getJob("non-existent"));

      expect(job).toBeNull();
    });

    it("should return error when provider fails", async () => {
      vi.mocked(mockProvider.getJob).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Database connection lost",
          retryable: true,
        }),
      );

      const error = expectError(await queue.getJob("job-1"));

      expect(error.type).toBe("RuntimeError");
    });
  });

  describe("getStats", () => {
    it("should retrieve queue statistics", async () => {
      const stats = expectSuccess(await queue.getStats());

      expect(stats).toMatchObject({
        queueName: "test-queue",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      });

      expect(mockProvider.getStats).toHaveBeenCalled();
    });

    it("should return error when provider fails", async () => {
      vi.mocked(mockProvider.getStats).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: "Failed to query stats",
          retryable: false,
        }),
      );

      const error = expectError(await queue.getStats());

      expect(error.type).toBe("RuntimeError");
    });
  });

  describe("pause", () => {
    it("should pause the queue", async () => {
      expectSuccess(await queue.pause());

      expect(mockProvider.pause).toHaveBeenCalled();
    });

    it("should throw error when provider fails", async () => {
      vi.mocked(mockProvider.pause).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: "Failed to pause queue",
          retryable: false,
        }),
      );

      const error = expectError(await queue.pause());

      expect(error.message).toBe("Failed to pause queue");
    });
  });

  describe("resume", () => {
    it("should resume the queue", async () => {
      expectSuccess(await queue.resume());

      expect(mockProvider.resume).toHaveBeenCalled();
    });

    it("should throw error when provider fails", async () => {
      vi.mocked(mockProvider.resume).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: "Failed to resume queue",
          retryable: false,
        }),
      );

      const error = expectError(await queue.resume());

      expect(error.message).toBe("Failed to resume queue");
    });
  });

  describe("delete", () => {
    it("should delete the queue", async () => {
      expectSuccess(await queue.delete());

      expect(mockProvider.delete).toHaveBeenCalled();
    });

    it("should throw error when provider fails", async () => {
      vi.mocked(mockProvider.delete).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: "Failed to delete queue",
          retryable: false,
        }),
      );

      const error = expectError(await queue.delete());

      expect(error.message).toBe("Failed to delete queue");
    });
  });

  describe("type safety", () => {
    it("should preserve generic type information", async () => {
      interface UserData {
        userId: string;
        email: string;
      }

      const userQueue = new Queue<UserData>("users", {
        provider: mockProvider,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        onUnsupportedFeature: () => {}, // silent for tests
        defaultJobOptions: {
          attempts: 3,
          jobId: () => `test-${Date.now()}`,
        },
      });

      const job = expectSuccess(
        await userQueue.add("process-user", {
          userId: "123",
          email: "user@example.com",
        }),
      );

      // TypeScript should enforce type safety
      expect(job.data.userId).toBe("123");
      expect(job.data.email).toBe("user@example.com");
    });
  });

  describe("getHealth", () => {
    it("should retrieve health status successfully", async () => {
      vi.mocked(mockProvider.getHealth).mockResolvedValueOnce(
        Result.ok({
          activeWorkers: 2,
          queueDepth: 10,
          errorRate: 0.5,
          completedCount: 100,
          failedCount: 1,
          isPaused: false,
        }),
      );

      const health = expectSuccess(await queue.getHealth());

      expect(health.activeWorkers).toBe(2);
      expect(health.errorRate).toBe(0.5);
      expect(health.isPaused).toBe(false);
      expect(mockProvider.getHealth).toHaveBeenCalled();
    });

    it("should return error when provider fails", async () => {
      vi.mocked(mockProvider.getHealth).mockResolvedValueOnce(
        Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: "Health check failed",
          retryable: false,
        }),
      );

      const error = expectError(await queue.getHealth());

      expect(error.type).toBe("RuntimeError");
    });
  });

  describe("retryJob", () => {
    it("should retry a failed job successfully", async () => {
      mockProvider.retryJob = vi.fn().mockResolvedValue(Result.ok(undefined));

      expectSuccess(await queue.retryJob("job-1"));

      expect(mockProvider.retryJob).toHaveBeenCalledWith("job-1");
    });

    it("should return error when retryJob is not supported", async () => {
      mockProvider.retryJob = undefined;

      const error = expectError(await queue.retryJob("job-1"));

      expect(error.type).toBe("ConfigurationError");
      expect(error.retryable).toBe(false);
    });

    it("should return error when provider fails", async () => {
      mockProvider.retryJob = vi.fn().mockResolvedValue(
        Result.err({
          type: "NotFoundError",
          code: "JOB_NOT_FOUND",
          message: "Job not found",
          resourceId: "job-1",
          resourceType: "job",
          retryable: false,
        }),
      );

      const error = expectError(await queue.retryJob("job-1"));

      expect(error.type).toBe("NotFoundError");
    });
  });

  describe("getDLQJobs", () => {
    it("should retrieve DLQ jobs successfully", async () => {
      const dlqJobs: Job<unknown>[] = [
        {
          id: "dlq-1",
          name: "failed-job",
          queueName: "test-queue",
          data: { value: 1 },
          status: "failed",
          attempts: 3,
          maxAttempts: 3,
          createdAt: new Date(),
        },
      ];

      mockProvider.getDLQJobs = vi.fn().mockResolvedValue(Result.ok(dlqJobs));

      const dlqJobsResult = expectSuccess(await queue.getDLQJobs(10));

      expect(dlqJobsResult).toHaveLength(1);
      expect(dlqJobsResult[0]?.id).toBe("dlq-1");
      expect(mockProvider.getDLQJobs).toHaveBeenCalledWith(10);
    });

    it("should return empty array when DLQ is empty", async () => {
      mockProvider.getDLQJobs = vi.fn().mockResolvedValue(Result.ok([]));

      const dlqJobsResult = expectSuccess(await queue.getDLQJobs());

      expect(dlqJobsResult).toHaveLength(0);
    });

    it("should return error when getDLQJobs is not supported", async () => {
      mockProvider.getDLQJobs = undefined;

      const error = expectError(await queue.getDLQJobs());

      expect(error.type).toBe("ConfigurationError");
      expect(error.retryable).toBe(false);
    });
  });

  /**
   * Error Contract Tests
   *
   * These tests validate that ALL errors returned by Queue operations
   * include required fields (code, retryable) as defined in QueueError type.
   *
   * Philosophy: We test the PUBLIC CONTRACT, not implementation details.
   * Users depend on these fields for error handling (retryable for retry logic,
   * code for categorization/observability).
   *
   * Coverage: Tests multiple failure scenarios across different error types
   * to ensure comprehensive adherence to the error contract.
   */
  describe("Error Contract - Required Fields", () => {
    describe("RuntimeError", () => {
      it("should include required code and retryable fields (connection failure)", async () => {
        vi.mocked(mockProvider.add).mockResolvedValueOnce(
          Result.err({
            type: "RuntimeError",
            code: "CONNECTION",
            message: "Database connection lost",
            retryable: true,
          }),
        );

        const error = expectError(await queue.add("test-job", {}));

        // verify required fields are present and have correct types
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe("string");
        expect(error.code).toBe("CONNECTION");

        expect(error.retryable).toBeDefined();
        expect(typeof error.retryable).toBe("boolean");
        expect(error.retryable).toBe(true);
      });

      it("should include required code and retryable fields (timeout)", async () => {
        vi.mocked(mockProvider.getStats).mockResolvedValueOnce(
          Result.err({
            type: "RuntimeError",
            code: "TIMEOUT",
            message: "Operation timed out",
            retryable: true,
          }),
        );

        const error = expectError(await queue.getStats());

        expect(error.code).toBeDefined();
        expect(error.code).toBe("TIMEOUT");
        expect(typeof error.retryable).toBe("boolean");
        expect(error.retryable).toBe(true);
      });

      it("should include required code and retryable fields (processing error)", async () => {
        vi.mocked(mockProvider.pause).mockResolvedValueOnce(
          Result.err({
            type: "RuntimeError",
            code: "PROCESSING",
            message: "Failed to pause queue",
            retryable: false,
          }),
        );

        const error = expectError(await queue.pause());

        expect(error.code).toBeDefined();
        expect(error.code).toBe("PROCESSING");
        expect(typeof error.retryable).toBe("boolean");
        expect(error.retryable).toBe(false);
      });
    });

    describe("ConfigurationError", () => {
      it("should include required code and retryable fields (unsupported feature)", async () => {
        mockProvider.retryJob = undefined;

        const error = expectError(await queue.retryJob("job-1"));

        // ConfigurationError should have code and retryable: false
        expect(error.code).toBeDefined();
        expect(error.code).toBe("UNSUPPORTED_FEATURE");
        expect(error.retryable).toBe(false);
      });

      it("should include required code and retryable fields (DLQ not supported)", async () => {
        mockProvider.getDLQJobs = undefined;

        const error = expectError(await queue.getDLQJobs());

        expect(error.code).toBeDefined();
        expect(error.code).toBe("UNSUPPORTED_FEATURE");
        expect(error.retryable).toBe(false);
      });
    });

    describe("NotFoundError", () => {
      it("should include required code, retryable, and resource fields", async () => {
        mockProvider.retryJob = vi.fn().mockResolvedValue(
          Result.err({
            type: "NotFoundError",
            code: "JOB_NOT_FOUND",
            message: "Job not found in queue",
            resourceId: "job-123",
            resourceType: "job",
            retryable: false,
          }),
        );

        const error = expectError(await queue.retryJob("job-123"));

        // NotFoundError should have code, retryable, resourceId, resourceType
        expect(error.code).toBeDefined();
        expect(error.code).toBe("JOB_NOT_FOUND");
        expect(error.retryable).toBe(false);

        // type-specific fields for NotFoundError
        expect(error).toHaveProperty("resourceId");
        expect(error).toHaveProperty("resourceType");
        if (error.type === "NotFoundError") {
          expect(error.resourceId).toBe("job-123");
          expect(error.resourceType).toBe("job");
        }
      });
    });

    describe("DataError", () => {
      it("should include required code and retryable fields (validation error)", async () => {
        vi.mocked(mockProvider.add).mockResolvedValueOnce(
          Result.err({
            type: "DataError",
            code: "VALIDATION",
            message: "Invalid job data",
            retryable: false,
          }),
        );

        const error = expectError(
          await queue.add("test-job", { invalid: "data" }),
        );

        // DataError should have code and retryable: false
        expect(error.code).toBeDefined();
        expect(error.code).toBe("VALIDATION");
        expect(error.retryable).toBe(false);
      });

      it("should include required code and retryable fields (duplicate error)", async () => {
        vi.mocked(mockProvider.add).mockResolvedValueOnce(
          Result.err({
            type: "DataError",
            code: "DUPLICATE",
            message: "Job with this ID already exists",
            retryable: false,
            jobId: "duplicate-job",
          }),
        );

        const error = expectError(
          await queue.add("test-job", {}, { jobId: "duplicate-job" }),
        );

        expect(error.code).toBeDefined();
        expect(error.code).toBe("DUPLICATE");
        expect(error.retryable).toBe(false);
      });
    });
  });

  // TDD: Critical Bug Fixes - Constructor Validation
  describe("Constructor validation (CRITICAL bugs)", () => {
    it("should reject explicit undefined for jobId", () => {
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onUnsupportedFeature: () => {},
          defaultJobOptions: {
            attempts: 3,
            //@ts-expect-error - testing runtime validation
            jobId: undefined, // Explicit undefined
          },
        });
      }).toThrow(TypeError);
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onUnsupportedFeature: () => {},
          defaultJobOptions: {
            attempts: 3,
            //@ts-expect-error - testing runtime validation
            jobId: undefined,
          },
        });
      }).toThrow(/jobId must be a function/);
    });

    it("should reject explicit undefined for onUnsupportedFeature", () => {
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
          defaultJobOptions: {
            attempts: 3,
            jobId: () => "test-id",
          },
          onUnsupportedFeature: undefined, // Explicit undefined
        });
      }).toThrow(TypeError);
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
          defaultJobOptions: {
            attempts: 3,
            jobId: () => "test-id",
          },
          onUnsupportedFeature: undefined,
        });
      }).toThrow(/onUnsupportedFeature must be a function/);
    });

    it("should accept valid jobId function", () => {
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onUnsupportedFeature: () => {},
          defaultJobOptions: {
            attempts: 3,
            jobId: () => "valid-id",
          },
        });
      }).not.toThrow();
    });

    it("should accept valid onUnsupportedFeature function", () => {
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
          defaultJobOptions: {
            attempts: 3,
            jobId: () => "test-id",
          },
          onUnsupportedFeature: (msg) => console.log(msg),
        });
      }).not.toThrow();
    });

    it("should use defaults when options are omitted", () => {
      expect(() => {
        new Queue("test", {
          provider: mockProvider,
        });
      }).not.toThrow();
    });

    it("should not crash when calling add() after valid construction", async () => {
      const queue = new Queue("test", {
        provider: mockProvider,
      });

      const result = await queue.add("test-job", { data: "test" });
      expect(result.success).toBe(true);
    });

    it("should reject null provider", () => {
      expect(() => {
        new Queue("test", {
          //@ts-expect-error - testing runtime validation
          provider: null,
          defaultJobOptions: { attempts: 3, jobId: () => "test-id" },
        });
      }).toThrow(TypeError);
      expect(() => {
        new Queue("test", {
          //@ts-expect-error - testing runtime validation
          provider: null,
          defaultJobOptions: { attempts: 3, jobId: () => "test-id" },
        });
      }).toThrow(/provider cannot be null/);
    });

    it("should reject explicit undefined provider", () => {
      expect(() => {
        new Queue("test", {
          provider: undefined,
          defaultJobOptions: { attempts: 3, jobId: () => "test-id" },
        });
      }).toThrow(TypeError);
      expect(() => {
        new Queue("test", {
          provider: undefined,
          defaultJobOptions: { attempts: 3, jobId: () => "test-id" },
        });
      }).toThrow(/provider cannot be undefined/);
    });

    it("should reject empty queue name", () => {
      expect(() => {
        new Queue("", { provider: mockProvider });
      }).toThrow(TypeError);
      expect(() => {
        new Queue("", { provider: mockProvider });
      }).toThrow(/queueName must be a non-empty string/);
    });

    it("should reject whitespace-only queue name", () => {
      expect(() => {
        new Queue("   ", { provider: mockProvider });
      }).toThrow(TypeError);
      expect(() => {
        new Queue("   ", { provider: mockProvider });
      }).toThrow(/queueName must be a non-empty string/);
    });

    it("should reject null queue name", () => {
      expect(() => {
        //@ts-expect-error - testing runtime validation
        new Queue(null, { provider: mockProvider });
      }).toThrow(TypeError);
      expect(() => {
        //@ts-expect-error - testing runtime validation
        new Queue(null, { provider: mockProvider });
      }).toThrow(/queueName must be a non-empty string/);
    });

    it("should reject undefined queue name", () => {
      expect(() => {
        //@ts-expect-error - testing runtime validation
        new Queue(undefined, { provider: mockProvider });
      }).toThrow(TypeError);
      expect(() => {
        //@ts-expect-error - testing runtime validation
        new Queue(undefined, { provider: mockProvider });
      }).toThrow(/queueName must be a non-empty string/);
    });

    it("should reject non-string queue name", () => {
      expect(() => {
        //@ts-expect-error - testing runtime validation
        new Queue(123, { provider: mockProvider });
      }).toThrow(TypeError);
      expect(() => {
        //@ts-expect-error - testing runtime validation
        new Queue(123, { provider: mockProvider });
      }).toThrow(/queueName must be a non-empty string/);
    });
  });
});
