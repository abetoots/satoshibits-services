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
      expect(retryingEvents.map((e) => e.attempts)).toEqual([1, 2]);

      const bullJob = await bullQueue!.getJob(jobId);
      expect(await bullJob?.getState()).toBe("failed");
      expect(bullJob?.attemptsMade).toBe(3);
      expect(bullJob?.opts.attempts).toBe(3);
    } finally {
      // cleanup: stop the worker, then remove every key of this queue
      await worker.close();
      const deleted = await boundProvider.delete();
      expect(deleted.success).toBe(true);
    }
  });
});
