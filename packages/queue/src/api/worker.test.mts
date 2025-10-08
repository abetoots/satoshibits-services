/**
 * Worker Tests - Hybrid Push/Pull Model
 *
 * Tests the Worker class adapts to both push and pull provider models
 * Validates fetch loop, concurrency, and event emission
 */

import { Result } from "@satoshibits/functional";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActiveEventPayload,
  CompletedEventPayload,
  FailedEventPayload,
  ProcessorShutdownTimeoutEventPayload,
  QueueErrorEventPayload,
} from "../core/events.mjs";
import type { Job, JobHandler } from "../core/types.mjs";
import type { IQueueProvider } from "../providers/provider.interface.mjs";

import { Worker } from "./worker.mjs";

describe("Worker - Hybrid Push/Pull Model", () => {
  let mockProvider: IQueueProvider;
  let handler: JobHandler<unknown>;
  let handlerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // create spy for handler
    handlerSpy = vi.fn().mockResolvedValue(Result.ok(undefined));
    handler = handlerSpy;

    // create mock provider (pull model by default)
    mockProvider = {
      capabilities: {
        supportsDelayedJobs: true,
        supportsPriority: true,
        supportsRetries: true,
        supportsDLQ: false,
        supportsBatching: true,
        supportsLongPolling: false,
        maxJobSize: 0,
        maxBatchSize: 0,
        maxDelaySeconds: 0,
      },
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      add: vi.fn(),
      getJob: vi.fn(),
      fetch: vi.fn().mockResolvedValue(Result.ok([])),
      ack: vi.fn().mockResolvedValue(Result.ok(undefined)),
      nack: vi.fn().mockResolvedValue(Result.ok(undefined)),
      pause: vi.fn(),
      resume: vi.fn(),
      delete: vi.fn(),
      getStats: vi.fn(),
      getHealth: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("model detection", () => {
    it("should detect pull model when fetch/ack/nack are present", async () => {
      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      // start triggers model detection
      worker.start();

      // give fetch loop time to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // should call fetch (pull model)
      expect(mockProvider.fetch).toHaveBeenCalled();

      await worker.close();
    });

    it("should detect push model when process() is present", async () => {
      const processSpy = vi.fn().mockReturnValue(vi.fn());
      mockProvider.process = processSpy;

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // should call process (push model)
      expect(processSpy).toHaveBeenCalledOnce();

      await worker.close();
    });

    it("should throw error when neither model is implemented", () => {
      delete mockProvider.fetch;
      delete mockProvider.ack;
      delete mockProvider.nack;

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      expect(() => worker.start()).toThrow(
        "must implement either process() or fetch()/ack()/nack()",
      );
    });

    it("should prefer push model when both are implemented", async () => {
      const processSpy = vi.fn().mockReturnValue(vi.fn());
      mockProvider.process = processSpy;

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // should use push model, not pull
      expect(processSpy).toHaveBeenCalled();
      expect(mockProvider.fetch).not.toHaveBeenCalled();

      await worker.close();
    });
  });

  describe("pull model - fetch loop", () => {
    it("should fetch jobs in a loop", async () => {
      vi.mocked(mockProvider.fetch!).mockResolvedValue(Result.ok([]));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        concurrency: 1,
        pollInterval: 10, // fast polling for test
        errorBackoff: 100,
      });

      worker.start();

      // wait for multiple fetch iterations
      await vi.waitFor(
        () => {
          expect(
            vi.mocked(mockProvider.fetch!).mock.calls.length,
          ).toBeGreaterThan(2);
        },
        { timeout: 100 },
      );

      await worker.close();
    });

    it("should process fetched jobs", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { value: 42 },
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // wait for job processing
      await vi.waitFor(() => {
        expect(handlerSpy).toHaveBeenCalledWith({ value: 42 }, job);
      });

      await worker.close();
    });

    it("should ack job on success", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      handlerSpy.mockResolvedValueOnce(Result.ok(undefined));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      await vi.waitFor(() => {
        expect(mockProvider.ack).toHaveBeenCalledWith(job);
      });

      await worker.close();
    });

    it("should nack job on handler failure", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      const error = new Error("Processing failed");
      handlerSpy.mockResolvedValueOnce(Result.err(error));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      await vi.waitFor(() => {
        expect(mockProvider.nack).toHaveBeenCalledWith(job, error);
      });

      await worker.close();
    });

    it("should nack job on handler exception", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      const error = new Error("Unexpected error");
      handlerSpy.mockRejectedValueOnce(error);

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      await vi.waitFor(() => {
        expect(mockProvider.nack).toHaveBeenCalledWith(job, error);
      });

      await worker.close();
    });

    // NOTE on timers: These worker tests use real timers (short setTimeout) instead of
    // vi.useFakeTimers(). Attempts to use fake timers led to test instability
    // and timeouts, likely due to complex interactions between the worker's async
    // polling loop, promise resolution, and vi.waitFor(). Real timers provide a
    // more stable, albeit less deterministic, testing approach for this component.

    it("should respect concurrency limit", async () => {
      const jobs: Job<unknown>[] = [
        {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: {},
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
        {
          id: "job-2",
          name: "test-job",
          queueName: "test-queue",
          data: {},
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
        {
          id: "job-3",
          name: "test-job",
          queueName: "test-queue",
          data: {},
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
      ];

      // mock should respect the requested count to simulate real provider behavior
      const remainingJobs = [...jobs];
      // eslint-disable-next-line @typescript-eslint/require-await
      vi.mocked(mockProvider.fetch!).mockImplementation(async (count) => {
        const jobsToReturn = remainingJobs.splice(0, count);
        return Result.ok(jobsToReturn);
      });

      // track concurrency with atomic operations
      let activeJobs = 0;
      let maxConcurrentJobs = 0;
      const concurrencySnapshots: number[] = [];

      handlerSpy.mockImplementation(async () => {
        // atomically increment and record
        activeJobs++;
        const current = activeJobs;
        maxConcurrentJobs = Math.max(maxConcurrentJobs, current);
        concurrencySnapshots.push(current);

        // simulate work with shorter delay (50ms) to speed up test
        await new Promise((resolve) => setTimeout(resolve, 50));

        activeJobs--;
        return Result.ok(undefined);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        concurrency: 2,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // wait for all jobs to be called
      await vi.waitFor(
        () => {
          expect(handlerSpy).toHaveBeenCalledTimes(3);
        },
        { timeout: 1000, interval: 10 },
      );

      // wait for all jobs to complete
      await vi.waitFor(
        () => {
          expect(activeJobs).toBe(0);
        },
        { timeout: 1000, interval: 10 },
      );

      // verify concurrency was never exceeded
      expect(maxConcurrentJobs).toBeLessThanOrEqual(2);
      expect(Math.max(...concurrencySnapshots)).toBeLessThanOrEqual(2);

      await worker.close();
    });

    it("should use configurable poll interval", async () => {
      const fetchTimestamps: number[] = [];

      // eslint-disable-next-line @typescript-eslint/require-await
      vi.mocked(mockProvider.fetch!).mockImplementation(async () => {
        fetchTimestamps.push(Date.now());
        return Result.ok([]);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 100, // 100ms between polls
        errorBackoff: 100,
      });

      worker.start();

      // wait for multiple poll cycles (test behavior, not timing)
      await vi.waitFor(
        () => {
          expect(fetchTimestamps.length).toBeGreaterThanOrEqual(3);
        },
        { timeout: 2000, interval: 50 },
      );

      await worker.close();

      // verify polling happened (behavior verified)
      expect(fetchTimestamps.length).toBeGreaterThanOrEqual(3);

      // optional: verify intervals are approximately correct (with tolerance)
      const intervals = fetchTimestamps
        .slice(1)
        .map((t, i) => t - fetchTimestamps[i]!);
      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;

      // 80-150ms tolerance for 100ms poll interval
      expect(avgInterval).toBeGreaterThan(80);
      expect(avgInterval).toBeLessThan(150);
    });

    it("should backoff on fetch error", async () => {
      const fetchTimestamps: number[] = [];

      // eslint-disable-next-line @typescript-eslint/require-await
      vi.mocked(mockProvider.fetch!).mockImplementation(async () => {
        const timestamp = Date.now();
        fetchTimestamps.push(timestamp);

        // first call fails, subsequent calls succeed
        if (fetchTimestamps.length === 1) {
          return Result.err({
            type: "RuntimeError",
            code: "CONNECTION",
            message: "Connection lost",
            retryable: true,
          });
        }
        return Result.ok([]);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        errorBackoff: 100,
        pollInterval: 10,
      });

      worker.start();

      // wait for error + backoff + retry (test behavior)
      await vi.waitFor(
        () => {
          expect(fetchTimestamps.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 2000, interval: 50 },
      );

      await worker.close();

      // verify backoff occurred between error and retry
      const timeBetweenCalls = fetchTimestamps[1]! - fetchTimestamps[0]!;

      // should have waited at least 90ms (errorBackoff - small tolerance)
      expect(timeBetweenCalls).toBeGreaterThanOrEqual(90);
    });

    it("should handle consecutive fetch failures and eventually recover", async () => {
      const fetchTimestamps: number[] = [];
      const errorEvents: QueueErrorEventPayload[] = [];

      // eslint-disable-next-line @typescript-eslint/require-await
      vi.mocked(mockProvider.fetch!).mockImplementation(async () => {
        const timestamp = Date.now();
        fetchTimestamps.push(timestamp);

        // first 3 calls fail, 4th succeeds
        if (fetchTimestamps.length <= 3) {
          return Result.err({
            type: "RuntimeError",
            code: "CONNECTION",
            message: `Connection lost (attempt ${fetchTimestamps.length})`,
            retryable: true,
          });
        }
        return Result.ok([]);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        errorBackoff: 100,
        pollInterval: 10,
      });

      // listen for error events
      worker.on("queue.error", (payload) => {
        errorEvents.push(payload);
      });

      worker.start();

      // wait for all 3 failures + recovery (test behavior)
      await vi.waitFor(
        () => {
          expect(fetchTimestamps.length).toBeGreaterThanOrEqual(4);
        },
        { timeout: 3000, interval: 50 },
      );

      await worker.close();

      // verify 3 error events were emitted
      expect(errorEvents).toHaveLength(3);
      expect(errorEvents[0]?.error.message).toContain("attempt 1");
      expect(errorEvents[1]?.error.message).toContain("attempt 2");
      expect(errorEvents[2]?.error.message).toContain("attempt 3");

      // verify backoff occurred after each failure
      const interval1 = fetchTimestamps[1]! - fetchTimestamps[0]!;
      const interval2 = fetchTimestamps[2]! - fetchTimestamps[1]!;
      const interval3 = fetchTimestamps[3]! - fetchTimestamps[2]!;

      // each backoff should be at least 90ms (errorBackoff - tolerance)
      expect(interval1).toBeGreaterThanOrEqual(90);
      expect(interval2).toBeGreaterThanOrEqual(90);
      expect(interval3).toBeGreaterThanOrEqual(90);

      // verify worker recovered and continued polling normally
      expect(fetchTimestamps.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("push model - process()", () => {
    it("should call provider.process() with instrumented handler", async () => {
      const processSpy = vi.fn().mockReturnValue(vi.fn());
      mockProvider.process = processSpy;

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        concurrency: 5,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      expect(processSpy).toHaveBeenCalledWith(expect.any(Function), {
        concurrency: 5,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        onError: expect.any(Function),
      });

      await worker.close();
    });

    it("should instrument handler to emit events", async () => {
      let capturedHandler: ((job: Job) => Promise<void>) | null = null;

      mockProvider.process = vi.fn((handler) => {
        capturedHandler = handler as (job: Job) => Promise<void>;
        return vi.fn();
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const processingEvents: unknown[] = [];
      const completedEvents: unknown[] = [];

      worker.on("active", (payload) => {
        processingEvents.push(payload);
      });
      worker.on("completed", (payload) => {
        completedEvents.push(payload);
      });

      worker.start();

      // simulate provider calling the instrumented handler
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: { value: 42 },
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      await capturedHandler!(job);

      // should have emitted events
      expect(processingEvents).toHaveLength(1);
      expect(processingEvents[0]).toMatchObject({
        jobId: "job-1",
        queueName: "test-queue",
      });

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]).toMatchObject({
        jobId: "job-1",
        queueName: "test-queue",
      });

      await worker.close();
    });

    it("should emit failed event on handler error", async () => {
      let capturedHandler: ((job: Job) => Promise<void>) | null = null;

      mockProvider.process = vi.fn((handler) => {
        capturedHandler = handler as (job: Job) => Promise<void>;
        return vi.fn();
      });

      const error = new Error("Processing failed");
      handlerSpy.mockResolvedValueOnce(Result.err(error));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const failedEvents: FailedEventPayload[] = [];
      worker.on("failed", (payload) => {
        failedEvents.push(payload);
      });

      worker.start();

      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      // should throw to let provider handle nack
      await expect(capturedHandler!(job)).rejects.toThrow("Processing failed");

      // should have emitted failed event
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toMatchObject({
        jobId: "job-1",
        queueName: "test-queue",
        error: "Processing failed",
      });

      await worker.close();
    });

    it("should propagate worker errors via onError callback", async () => {
      let capturedOnError: ((error: unknown) => void) | undefined;

      mockProvider.process = vi.fn((_handler, options) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        capturedOnError = options?.onError;
        return vi.fn();
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const errorEvents: QueueErrorEventPayload[] = [];
      worker.on("queue.error", (payload) => {
        errorEvents.push(payload);
      });

      worker.start();

      // verify onError callback was passed to provider
      expect(capturedOnError).toBeDefined();

      // simulate provider calling onError callback
      const providerError = {
        type: "RuntimeError" as const,
        code: "CONNECTION" as const,
        message: "Redis connection lost",
        queueName: "test-queue",
      };
      capturedOnError!(providerError);

      // verify Worker API emitted queue.error event
      await vi.waitFor(() => {
        expect(errorEvents).toHaveLength(1);
      });

      expect(errorEvents[0]).toMatchObject({
        queueName: "test-queue",
        error: {
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Redis connection lost",
        },
      });

      await worker.close();
    });
  });

  describe("event emission", () => {
    it("should emit job.processing event", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const events: ActiveEventPayload[] = [];
      worker.on("active", (payload) => {
        events.push(payload);
      });

      worker.start();

      await vi.waitFor(() => {
        expect(events).toHaveLength(1);
      });

      expect(events[0]).toMatchObject({
        jobId: "job-1",
        queueName: "test-queue",
        attempts: 0,
        status: "active",
      });

      await worker.close();
    });

    it("should emit job.completed event", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const events: CompletedEventPayload[] = [];
      worker.on("completed", (payload) => {
        events.push(payload);
      });

      worker.start();

      await vi.waitFor(() => {
        expect(events).toHaveLength(1);
      });

      const completedEvent = events[0]!;
      expect(completedEvent).toMatchObject({
        jobId: "job-1",
        queueName: "test-queue",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        duration: expect.any(Number),
      });

      expect(completedEvent.duration).toBeGreaterThanOrEqual(0);

      await worker.close();
    });

    it("should emit job.failed event", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      handlerSpy.mockResolvedValueOnce(
        Result.err(new Error("Processing failed")),
      );

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const events: FailedEventPayload[] = [];
      worker.on("failed", (payload) => {
        events.push(payload);
      });

      worker.start();

      await vi.waitFor(() => {
        expect(events).toHaveLength(1);
      });

      expect(events[0]).toMatchObject({
        jobId: "job-1",
        queueName: "test-queue",
        error: "Processing failed",
        errorType: "Error",
        willRetry: true, // attempts (0) < maxAttempts (3)
      });

      await worker.close();
    });

    it("should emit queue.error on fetch failure", async () => {
      vi.mocked(mockProvider.fetch!).mockResolvedValue(
        Result.err({
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Connection lost",
          retryable: true,
        }),
      );

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 50,
      });

      const events: QueueErrorEventPayload[] = [];
      worker.on("queue.error", (payload) => {
        events.push(payload);
      });

      worker.start();

      await vi.waitFor(() => {
        expect(events.length).toBeGreaterThan(0);
      });

      expect(events[0]).toMatchObject({
        queueName: "test-queue",
        error: {
          type: "RuntimeError",
          message: "Connection lost",
        },
      });

      await worker.close();
    });

    it("should emit queue.error when ack() fails", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      // mock ack to fail
      vi.mocked(mockProvider.ack!).mockResolvedValue(
        Result.err({
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Redis connection lost during ack",
          retryable: true,
        }),
      );

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const errorEvents: QueueErrorEventPayload[] = [];
      worker.on("queue.error", (payload) => {
        errorEvents.push(payload);
      });

      worker.start();

      await vi.waitFor(() => {
        expect(errorEvents).toHaveLength(1);
      });

      expect(errorEvents[0]).toMatchObject({
        queueName: "test-queue",
        error: {
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Redis connection lost during ack",
        },
      });

      await worker.close();
    });

    it("should emit queue.error when nack() fails", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      // handler fails, triggering nack
      handlerSpy.mockResolvedValueOnce(
        Result.err(new Error("Processing failed")),
      );

      // mock nack to fail
      vi.mocked(mockProvider.nack!).mockResolvedValue(
        Result.err({
          type: "RuntimeError",
          code: "CONNECTION",
          message: "SQS connection lost during nack",
          retryable: true,
        }),
      );

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      const errorEvents: QueueErrorEventPayload[] = [];
      worker.on("queue.error", (payload) => {
        errorEvents.push(payload);
      });

      worker.start();

      await vi.waitFor(() => {
        expect(errorEvents).toHaveLength(1);
      });

      expect(errorEvents[0]).toMatchObject({
        queueName: "test-queue",
        error: {
          type: "RuntimeError",
          code: "CONNECTION",
          message: "SQS connection lost during nack",
        },
      });

      await worker.close();
    });

    it("should handle multiple sequential ack() failures without crashing", async () => {
      const jobs: Job<unknown>[] = [
        {
          id: "job-1",
          name: "test-job",
          queueName: "test-queue",
          data: { index: 1 },
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
        {
          id: "job-2",
          name: "test-job",
          queueName: "test-queue",
          data: { index: 2 },
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
        {
          id: "job-3",
          name: "test-job",
          queueName: "test-queue",
          data: { index: 3 },
          status: "active",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
      ];

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok(jobs))
        .mockResolvedValue(Result.ok([]));

      // all handlers succeed
      handlerSpy.mockResolvedValue(Result.ok(undefined));

      // all ack() calls fail
      vi.mocked(mockProvider.ack!).mockResolvedValue(
        Result.err({
          type: "RuntimeError",
          code: "CONNECTION",
          message: "Redis connection lost during ack",
          retryable: true,
        }),
      );

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
        concurrency: 3,
      });

      const errorEvents: QueueErrorEventPayload[] = [];
      const completedEvents: CompletedEventPayload[] = [];

      worker.on("queue.error", (payload) => {
        errorEvents.push(payload);
      });

      worker.on("completed", (payload) => {
        completedEvents.push(payload);
      });

      worker.start();

      // wait for all handlers to complete
      await vi.waitFor(() => {
        expect(handlerSpy).toHaveBeenCalledTimes(3);
      });

      // wait for all ack errors
      await vi.waitFor(() => {
        expect(errorEvents).toHaveLength(3);
      });

      await worker.close();

      // verify all 3 jobs were processed (handlers called)
      expect(handlerSpy).toHaveBeenCalledTimes(3);

      // verify all 3 ack() failures emitted queue.error events
      expect(errorEvents).toHaveLength(3);
      errorEvents.forEach((event) => {
        expect(event.error.message).toContain(
          "Redis connection lost during ack",
        );
      });

      // verify completed events were still emitted despite ack failures
      expect(completedEvents).toHaveLength(3);

      // verify worker remained stable and didn't crash
      // (if it crashed, we wouldn't reach this point)
    });
  });

  describe("lifecycle", () => {
    it("should start successfully", async () => {
      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      expect(() => worker.start()).not.toThrow();

      await worker.close();
    });

    it("should throw error when starting twice", async () => {
      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      expect(() => worker.start()).toThrow("already running");

      await worker.close();
    });

    it("should stop gracefully", async () => {
      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      await worker.close();

      // should stop fetching
      const fetchCallsBefore = vi.mocked(mockProvider.fetch!).mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 50));

      const fetchCallsAfter = vi.mocked(mockProvider.fetch!).mock.calls.length;

      // no new fetches after stop
      expect(fetchCallsAfter).toBe(fetchCallsBefore);
    });

    it("should wait for active jobs to complete before stopping", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      // slow handler
      let handlerCompleted = false;
      handlerSpy.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        handlerCompleted = true;
        return Result.ok(undefined);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // wait for job to start processing
      await new Promise((resolve) => setTimeout(resolve, 30));

      // stop worker (should wait for job)
      await worker.close();

      // handler should have completed
      expect(handlerCompleted).toBe(true);
    });

    it("should call shutdown function for push model", async () => {
      const shutdownSpy = vi.fn().mockResolvedValue(undefined);
      mockProvider.process = vi.fn().mockReturnValue(shutdownSpy);

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();
      await worker.close();

      expect(shutdownSpy).toHaveBeenCalledOnce();
    });

    it("should respect finishActiveJobs=false option", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      let handlerStarted = false;
      let handlerCompleted = false;

      handlerSpy.mockImplementation(async () => {
        handlerStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 200));
        handlerCompleted = true;
        return Result.ok(undefined);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // wait for job to start
      await vi.waitFor(() => {
        expect(handlerStarted).toBe(true);
      });

      // close without waiting for active jobs
      await worker.close({ finishActiveJobs: false, timeout: 100 });

      // handler should not have completed
      expect(handlerCompleted).toBe(false);
    });

    it("should respect timeout option when waiting for jobs", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      handlerSpy.mockImplementation(async () => {
        // handler that takes longer than timeout
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Result.ok(undefined);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      // wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 30));

      // close with short timeout
      const closePromise = worker.close({ timeout: 100 });

      // should resolve after timeout, not wait for handler
      await expect(closePromise).resolves.not.toThrow();
    });

    it("should emit processor.shutdown_timeout event when timeout expires", async () => {
      const shutdownTimeoutEvents: ProcessorShutdownTimeoutEventPayload[] = [];
      const activeEvents: ActiveEventPayload[] = [];

      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      handlerSpy.mockImplementation(async () => {
        // handler that takes longer than timeout (500ms)
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Result.ok(undefined);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      // listen for active event to know when job starts processing
      worker.on("active", (payload) => {
        activeEvents.push(payload);
      });

      // listen for shutdown timeout event
      worker.on("processor.shutdown_timeout", (payload) => {
        shutdownTimeoutEvents.push(payload);
      });

      worker.start();

      // wait for job to become active (behavior-based, not time-based)
      await vi.waitFor(() => {
        expect(activeEvents).toHaveLength(1);
      });

      // close with short timeout (100ms < 500ms handler duration)
      await worker.close({ timeout: 100 });

      // verify event was emitted with correct payload
      expect(shutdownTimeoutEvents).toHaveLength(1);
      expect(shutdownTimeoutEvents[0]).toMatchObject({
        queueName: "test-queue",
        timeout: 100,
        activeJobs: 1,
      });
      expect(shutdownTimeoutEvents[0]?.message).toContain(
        "Shutdown timeout exceeded",
      );
      expect(shutdownTimeoutEvents[0]?.message).toContain(
        "1 jobs still active",
      );
    });

    it("should use default close options when none provided", async () => {
      const job: Job<unknown> = {
        id: "job-1",
        name: "test-job",
        queueName: "test-queue",
        data: {},
        status: "active",
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      vi.mocked(mockProvider.fetch!)
        .mockResolvedValueOnce(Result.ok([job]))
        .mockResolvedValue(Result.ok([]));

      let handlerCompleted = false;

      handlerSpy.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        handlerCompleted = true;
        return Result.ok(undefined);
      });

      const worker = new Worker("test-queue", handler, {
        provider: mockProvider,
        pollInterval: 10,
        errorBackoff: 100,
      });

      worker.start();

      await new Promise((resolve) => setTimeout(resolve, 20));

      // close with defaults (finishActiveJobs=true, timeout=30000)
      await worker.close();

      // should have waited for handler
      expect(handlerCompleted).toBe(true);
    });
  });

  // NOTE: Timeout handling removed as per API boundary violation fix (API #1)
  // The library no longer provides timeout functionality - this is userland responsibility.
  // Users should implement timeouts using AbortController pattern in their handlers.
  // See: packages/queue/src/api/worker.mts for AbortController example

  // TDD: Critical Bug Fixes - Constructor Validation (Bug #6)
  describe("Constructor validation (HIGH bug - CPU spin-loop)", () => {
    it("should reject explicit undefined for pollInterval", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          //@ts-expect-error - testing runtime validation
          pollInterval: undefined,
          errorBackoff: 1000,
        });
      }).toThrow(TypeError);
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          //@ts-expect-error - testing runtime validation
          pollInterval: undefined,
          errorBackoff: 1000,
        });
      }).toThrow(/pollInterval must be a finite non-negative number/);
    });

    it("should reject explicit undefined for errorBackoff", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: 1000,
          //@ts-expect-error - testing runtime validation
          errorBackoff: undefined,
        });
      }).toThrow(TypeError);
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: 1000,
          //@ts-expect-error - testing runtime validation
          errorBackoff: undefined,
        });
      }).toThrow(/errorBackoff must be a finite non-negative number/);
    });

    it("should reject negative pollInterval", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: -100,
          errorBackoff: 1000,
        });
      }).toThrow(/pollInterval must be a finite non-negative number/);
    });

    it("should reject negative errorBackoff", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: 1000,
          errorBackoff: -100,
        });
      }).toThrow(/errorBackoff must be a finite non-negative number/);
    });

    it("should reject non-number pollInterval", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          //@ts-expect-error - testing runtime validation
          pollInterval: "1000",
          errorBackoff: 1000,
        });
      }).toThrow(/pollInterval must be a finite non-negative number/);
    });

    it("should reject non-number errorBackoff", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: 1000,
          //@ts-expect-error - testing runtime validation
          errorBackoff: "1000",
        });
      }).toThrow(/errorBackoff must be a finite non-negative number/);
    });

    it("should reject Infinity for pollInterval", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: Infinity,
          errorBackoff: 1000,
        });
      }).toThrow(/pollInterval must be a finite non-negative number/);
    });

    it("should reject NaN for pollInterval", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: NaN,
          errorBackoff: 1000,
        });
      }).toThrow(/pollInterval must be a finite non-negative number/);
    });

    it("should accept valid pollInterval and errorBackoff", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: 1000,
          errorBackoff: 2000,
        });
      }).not.toThrow();
    });

    it("should accept 0 for pollInterval (edge case)", () => {
      expect(() => {
        new Worker("test-queue", handler, {
          provider: mockProvider,
          pollInterval: 0,
          errorBackoff: 1000,
        });
      }).not.toThrow();
    });
  });
});
