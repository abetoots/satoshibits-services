/**
 * BullMQ Provider Contract Tests (Integration)
 *
 * These tests validate that BullMQProvider correctly implements the IQueueProvider
 * interface contract. Unlike unit tests, these run against a REAL Redis instance.
 *
 * Prerequisites:
 * - Redis must be running on localhost:6379
 * - Run via: pnpm test:integration
 * - CI: docker-compose.test.yml provides Redis container
 *
 * Purpose:
 * - Ensures BullMQProvider behavior matches contract expectations
 * - Validates consistency with Memory and SQS providers
 * - Catches provider-specific bugs that mocks would miss
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createProviderContractTests } from "../__shared__/provider-contract.suite.mjs";
import { BullMQProvider } from "./bullmq.provider.mjs";

let globalProvider: BullMQProvider;

// setup: connect to Redis before all contract tests
beforeAll(async () => {
  globalProvider = new BullMQProvider({
    connection: {
      host: process.env.REDIS_HOST ?? "localhost",
      port: parseInt(process.env.REDIS_PORT ?? "6379"),
    },
    prefix: "contract-test",
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  await globalProvider.connect();
});

// cleanup: close all connections after all tests
afterAll(async () => {
  if (globalProvider) {
    await globalProvider.disconnect();
  }
});

// run shared contract tests against real BullMQ + Redis
describe("BullMQProvider - Contract Compliance (Integration)", () => {
  createProviderContractTests(
    // eslint-disable-next-line @typescript-eslint/require-await
    async () => {
      // each test gets a fresh queue binding
      const queueName = `test-queue-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const provider = globalProvider.forQueue(queueName);

      return provider;
    },
    {
      providerName: "BullMQProvider",
      supportsConcurrentFetch: true,
      supportsGetJob: true,
      supportsDLQ: true,
      supportsDelayedJobs: true, // BullMQ supports delayed jobs natively
      ackNackTakesJob: false, // BullMQ takes jobId string, not Job<T> (interface violation)
    },
  );
});

// regression test for BullMQ concurrency bug (null processor requirement)
describe("BullMQProvider - Fetch Concurrency Validation", () => {
  it("should support concurrent fetch when using null processor (pull model)", async () => {
    // this test validates the fix for the concurrency bug where workers with
    // processor functions had default concurrency limit of 1
    const queueName = `concurrency-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const boundProvider = globalProvider.forQueue(queueName);

    // add 10 jobs
    const jobs = Array.from({ length: 10 }, (_, i) => ({
      id: `job-${i}`,
      name: "test-job",
      queueName,
      data: { index: i },
      status: "waiting" as const,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    }));

    for (const job of jobs) {
      const result = await boundProvider.add(job);
      if (!result.success) {
        throw new Error(`Failed to add job: ${result.error.message}`);
      }
    }

    // wait for jobs to be ready in Redis
    await vi.waitFor(
      async () => {
        const stats = await boundProvider.getStats();
        if (stats.success) {
          expect(stats.data.waiting).toBe(10);
        }
      },
      { timeout: 5000, interval: 100 },
    );

    // fetch 5 jobs concurrently (this would fail if using processor function)
    const [result1, result2] = await Promise.all([
      boundProvider.fetch?.(5),
      boundProvider.fetch?.(5),
    ]);

    // verify both fetches succeeded
    expect(result1?.success).toBe(true);
    expect(result2?.success).toBe(true);

    if (result1?.success && result2?.success) {
      // total jobs fetched should be 10
      const totalFetched = result1.data.length + result2.data.length;
      expect(totalFetched).toBe(10);

      // verify no duplicates (atomicity)
      const allIds = [
        ...result1.data.map((j) => j.id),
        ...result2.data.map((j) => j.id),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(10);
    }

    // cleanup
    await boundProvider.delete();
  });
});
