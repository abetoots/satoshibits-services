/**
 * Worker + BullMQProvider retry budget (Integration)
 *
 * Runs the library Worker against a real BullMQProvider and a REAL Redis
 * instance, in push mode. The worker predicts `willRetry` from the job BullMQ
 * hands it; BullMQ decides on its own whether to retry. This pins that the two
 * agree on every attempt of a retry budget.
 *
 * Prerequisites:
 * - Redis reachable at REDIS_HOST:REDIS_PORT (same defaults as the contract
 *   suite: localhost:6379, provided in CI by docker-compose.test.yml)
 * - Run via: pnpm test:integration
 */

import { Result } from "@satoshibits/functional";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  FailedEventPayload,
  JobRetryingEventPayload,
} from "../../core/events.mjs";
import type { JobHandler } from "../../core/types.mjs";

import { Worker } from "../../api/worker.mjs";
import { BullMQProvider } from "./bullmq.provider.mjs";

let provider: BullMQProvider;

beforeAll(async () => {
  provider = new BullMQProvider({
    connection: {
      host: process.env.REDIS_HOST ?? "localhost",
      port: parseInt(process.env.REDIS_PORT ?? "6379"),
    },
    prefix: "retry-budget-test",
  });

  await provider.connect();
});

afterAll(async () => {
  if (provider) {
    await provider.disconnect();
  }
});

describe("Worker + BullMQProvider - retry budget (Integration)", () => {
  it("should predict BullMQ's decision on every attempt of a budget of 3 (push model)", async () => {
    const queueName = `retry-budget-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const jobId = "job-budget";
    const boundProvider = provider.forQueue(queueName);

    const handler = vi
      .fn<JobHandler<unknown>>()
      .mockResolvedValue(Result.err(new Error("always fails")));

    const worker = new Worker(queueName, handler, { provider });

    const failedEvents: FailedEventPayload[] = [];
    const retryingEvents: JobRetryingEventPayload[] = [];
    worker.on("failed", (payload) => {
      failedEvents.push(payload);
    });
    worker.on("job.retrying", (payload) => {
      retryingEvents.push(payload);
    });

    try {
      const added = await boundProvider.add(
        {
          id: jobId,
          name: "test-job",
          queueName,
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
        {
          // keep the failed job so its final state can be read back
          removeOnFail: false,
          // a tiny backoff instead of the provider's 1s exponential default
          providerOptions: { bullmq: { backoff: { type: "fixed", delay: 20 } } },
        },
      );
      if (!added.success) {
        throw new Error(`Failed to add job: ${added.error.message}`);
      }

      worker.start();

      // BullMQ's own record of the job, not the library's mapping of it
      const bullQueue = provider.getBullMQQueue(queueName);
      expect(bullQueue).toBeDefined();

      await vi.waitFor(
        async () => {
          const bullJob = await bullQueue!.getJob(jobId);
          expect(await bullJob?.getState()).toBe("failed");
        },
        { timeout: 15000, interval: 50 },
      );
      // long enough for a fourth run, had BullMQ scheduled one
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(handler).toHaveBeenCalledTimes(3);
      expect(failedEvents.map((e) => e.attempts)).toEqual([0, 1, 2]);
      expect(failedEvents.map((e) => e.willRetry)).toEqual([true, true, false]);
      // the predicate a consumer uses for "retries exhausted" holds once
      expect(
        failedEvents.filter((e) => !e.permanent && !e.willRetry),
      ).toHaveLength(1);
      expect(retryingEvents.map((e) => e.attempts)).toEqual([1, 2]);

      const bullJob = await bullQueue!.getJob(jobId);
      expect(await bullJob?.getState()).toBe("failed");
      expect(bullJob?.attemptsMade).toBe(3);
      expect(bullJob?.opts.attempts).toBe(3);
    } finally {
      // cleanup: stop the worker, then remove every key of this queue
      // the keys are removed even if the worker fails to close
      try {
        await worker.close();
      } finally {
        const deleted = await boundProvider.delete();
        expect(deleted.success).toBe(true);
      }
    }
  });

  it("should run a job once when the handler returns an Error carrying retryable: false, whatever its budget (push model)", async () => {
    const queueName = `retry-budget-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const jobId = "job-permanent";
    const boundProvider = provider.forQueue(queueName);

    const handler = vi
      .fn<JobHandler<unknown>>()
      .mockImplementation(() =>
        Promise.resolve(
          Result.err(
            Object.assign(new Error("never retry this"), { retryable: false }),
          ),
        ),
      );

    const worker = new Worker(queueName, handler, { provider });

    const failedEvents: FailedEventPayload[] = [];
    const retryingEvents: JobRetryingEventPayload[] = [];
    worker.on("failed", (payload) => {
      failedEvents.push(payload);
    });
    worker.on("job.retrying", (payload) => {
      retryingEvents.push(payload);
    });

    try {
      const added = await boundProvider.add(
        {
          id: jobId,
          name: "test-job",
          queueName,
          data: { foo: "bar" },
          status: "waiting",
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
        },
        {
          // keep the failed job so its final state can be read back
          removeOnFail: false,
          // a tiny backoff instead of the provider's 1s exponential default
          providerOptions: { bullmq: { backoff: { type: "fixed", delay: 20 } } },
        },
      );
      if (!added.success) {
        throw new Error(`Failed to add job: ${added.error.message}`);
      }

      worker.start();

      // BullMQ's own record of the job, not the library's mapping of it
      const bullQueue = provider.getBullMQQueue(queueName);
      expect(bullQueue).toBeDefined();

      await vi.waitFor(
        async () => {
          const bullJob = await bullQueue!.getJob(jobId);
          expect(await bullJob?.getState()).toBe("failed");
        },
        { timeout: 15000, interval: 50 },
      );
      // long enough for a second run, had BullMQ scheduled one
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toMatchObject({
        attempts: 0,
        error: "never retry this",
        permanent: true,
        willRetry: false,
      });
      expect(retryingEvents).toHaveLength(0);

      const bullJob = await bullQueue!.getJob(jobId);
      expect(await bullJob?.getState()).toBe("failed");
      expect(bullJob?.attemptsMade).toBe(1);
      expect(bullJob?.opts.attempts).toBe(3);
      expect(bullJob?.failedReason).toBe("never retry this");
    } finally {
      // cleanup: stop the worker, then remove every key of this queue
      // the keys are removed even if the worker fails to close
      try {
        await worker.close();
      } finally {
        const deleted = await boundProvider.delete();
        expect(deleted.success).toBe(true);
      }
    }
  });

  // structured objects, not Errors: the provider converts them at its
  // boundary, and real BullMQ must end up with a usable failure either way
  it.each([
    {
      label: "a plain object carrying retryable: false is not retried",
      error: {
        type: "DataError",
        code: "VALIDATION",
        message: "plain object, never retry",
        retryable: false,
      },
      runs: 1,
      permanent: [true],
      willRetry: [false],
    },
    {
      // the shape an unrecognised provider error is mapped to
      label: "a plain object carrying retryable: true is retried for its budget",
      error: {
        type: "RuntimeError",
        code: "PROCESSING",
        message: "READONLY You can't write against a read only replica.",
        retryable: true,
      },
      runs: 3,
      permanent: [false, false, false],
      willRetry: [true, true, false],
    },
  ])(
    "should fail the job with the object's message when the handler throws a structured error: $label (push model)",
    async ({ error, runs, permanent, willRetry }) => {
      const queueName = `retry-budget-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const jobId = "job-structured";
      const boundProvider = provider.forQueue(queueName);

      const handler = vi.fn<JobHandler<unknown>>().mockImplementation(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a handler can throw a structured error
        Promise.reject(error),
      );

      const worker = new Worker(queueName, handler, { provider });

      const failedEvents: FailedEventPayload[] = [];
      worker.on("failed", (payload) => {
        failedEvents.push(payload);
      });

      try {
        const added = await boundProvider.add(
          {
            id: jobId,
            name: "test-job",
            queueName,
            data: { foo: "bar" },
            status: "waiting",
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date(),
          },
          {
            removeOnFail: false,
            providerOptions: {
              bullmq: { backoff: { type: "fixed", delay: 20 } },
            },
          },
        );
        if (!added.success) {
          throw new Error(`Failed to add job: ${added.error.message}`);
        }

        worker.start();

        const bullQueue = provider.getBullMQQueue(queueName);
        expect(bullQueue).toBeDefined();

        await vi.waitFor(
          async () => {
            const bullJob = await bullQueue!.getJob(jobId);
            expect(await bullJob?.getState()).toBe("failed");
          },
          { timeout: 15000, interval: 50 },
        );
        // long enough for another run, had BullMQ scheduled one
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(handler).toHaveBeenCalledTimes(runs);
        expect(failedEvents.map((e) => e.permanent)).toEqual(permanent);
        expect(failedEvents.map((e) => e.willRetry)).toEqual(willRetry);
        expect(failedEvents.every((e) => e.error === error.message)).toBe(true);

        const bullJob = await bullQueue!.getJob(jobId);
        expect(await bullJob?.getState()).toBe("failed");
        expect(bullJob?.attemptsMade).toBe(runs);
        expect(bullJob?.failedReason).toBe(error.message);
      } finally {
        try {
          await worker.close();
        } finally {
          const deleted = await boundProvider.delete();
          expect(deleted.success).toBe(true);
        }
      }
    },
  );
});
