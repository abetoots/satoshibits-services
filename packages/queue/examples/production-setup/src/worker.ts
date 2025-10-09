import { Queue, uuidId, Worker } from "@satoshibits/queue";

import type { EmailJobData } from "./types.js";

import { emailHandler } from "./email-handler.js";
import { logger } from "./logger.js";
import { provider } from "./provider.js";

import "dotenv/config";

// Initialize worker with BullMQ provider
// See: packages/queue/README.md#production-usage-redisbullmq
const worker = new Worker<EmailJobData>("emails", emailHandler, {
  provider,
  concurrency: 5, // process 5 jobs concurrently
  // Note: pollInterval and errorBackoff are not needed for push-based providers like BullMQ
  // They are only required for pull-based providers like SQS
});

// ✅ EVENT LISTENERS: Monitor job lifecycle
// See: packages/queue/README.md#mistake-7-not-using-worker-events
worker.on("active", (payload) => {
  logger.info(
    {
      jobId: payload.jobId,
      attempts: payload.attempts,
    },
    "▶️  Job started",
  );
});

worker.on("completed", (payload) => {
  logger.info(
    {
      jobId: payload.jobId,
      duration: payload.duration,
    },
    "✅ Job completed",
  );
});

worker.on("failed", (payload) => {
  logger.error(
    {
      jobId: payload.jobId,
      error: payload.error,
      willRetry: payload.willRetry,
      attempts: payload.attempts,
    },
    "❌ Job failed",
  );
});

worker.on("job.retrying", (payload) => {
  logger.warn(
    {
      jobId: payload.jobId,
      attempts: payload.attempts,
      maxAttempts: payload.maxAttempts,
    },
    "🔄 Job retrying",
  );
});

// ✅ DLQ MONITORING: Check on startup
// See: packages/queue/README.md#mistake-3-ignoring-the-dead-letter-queue
async function checkDLQ() {
  const queue = new Queue("emails", {
    provider,
    onUnsupportedFeature: (message) => logger.warn(message),
    defaultJobOptions: {
      attempts: 3,
      jobId: uuidId, // use crypto.randomUUID() - production-safe default
    },
  });
  const dlqJobs = await queue.getDLQJobs(10);

  if (dlqJobs.success && dlqJobs.data.length > 0) {
    logger.warn(
      {
        count: dlqJobs.data.length,
        jobs: dlqJobs.data.map((j) => ({ id: j.id, error: j.error })),
      },
      "⚠️  Found jobs in DLQ",
    );
  } else {
    logger.info("DLQ is empty");
  }
}

// ✅ GRACEFUL SHUTDOWN
// See: packages/queue/README.md#mistake-2-forgetting-graceful-shutdown
// eslint-disable-next-line @typescript-eslint/no-misused-promises
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");

  await worker.close({
    timeout: 30000, // wait up to 30s
    finishActiveJobs: true, // let active jobs complete
  });

  logger.info("Worker shut down successfully");
  process.exit(0);
});

// Start worker
await (async () => {
  await checkDLQ();
  worker.start();
  logger.info("👷 Worker started, waiting for jobs...");
})();
