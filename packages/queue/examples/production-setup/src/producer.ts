import { Queue, uuidId } from "@satoshibits/queue";
import express from "express";

import type { EmailJobData } from "./types.js";

import { logger } from "./logger.js";
import { provider } from "./provider.js";

import "dotenv/config";

const app = express();
app.use(express.json());

// Initialize queue with BullMQ provider
// See: packages/queue/README.md#production-usage-redisbullmq
const queue = new Queue<EmailJobData>("emails", {
  provider,
  onUnsupportedFeature: (message) => logger.warn(message),
  defaultJobOptions: {
    attempts: 3, // default retry attempts (can be overridden per job)
    jobId: uuidId, // use crypto.randomUUID() - production-safe default
  },
});

/**
 * POST /signup - Queue welcome email
 *
 * Demonstrates:
 * - Idempotency: See README.md#mistake-5-not-implementing-idempotency
 * - Security: See README.md#tier-1 (Security row)
 */
app.post("/signup", async (req, res) => {
  const { email, userId } = req.body as Record<string, unknown>;

  if (!email || !userId) {
    return res.status(400).json({ error: "Missing email or userId" });
  }

  if (typeof email !== "string" || typeof userId !== "string") {
    return res.status(400).json({ error: "Invalid email or userId" });
  }

  // ✅ IDEMPOTENCY: Use deterministic job ID to prevent duplicates
  // See: packages/queue/README.md#mistake-5
  const jobId = `welcome-${userId}`;

  const result = await queue.add(
    "send-welcome",
    { email, userId },
    {
      jobId, // prevents duplicate jobs
      attempts: 3, // retry up to 3 times
    },
  );

  if (result.success) {
    logger.info({ jobId: result.data.id, email, userId }, "Job enqueued");
    res.json({ success: true, jobId: result.data.id });
  } else {
    logger.error({ error: result.error }, "Failed to enqueue job");
    res.status(500).json({ error: "Failed to enqueue job" });
  }
});

/**
 * GET /simulate-error?type=transient|permanent
 *
 * Demo endpoint to trigger different error scenarios
 * Watch worker logs to see error classification in action!
 */
app.get("/simulate-error", async (req, res) => {
  const errorType = req.query.type as "transient" | "permanent";

  await queue.add(
    "send-welcome",
    {
      email: "test@example.com",
      userId: "demo",
      errorType,
    },
    { attempts: 3 },
  );

  res.json({
    message: `Queued job with ${errorType} error`,
    hint: "Watch worker logs to see error handling!",
  });
});

/**
 * POST /signup-with-attachment - Queue welcome email with attachment
 *
 * Demonstrates:
 * - Small Payloads: See README.md#mistake-6-putting-large-payloads-in-queue
 */
app.post("/signup-with-attachment", async (req, res) => {
  const { email, userId, attachmentUrl } = req.body as Record<string, unknown>;

  if (!email || !userId || !attachmentUrl) {
    return res
      .status(400)
      .json({ error: "Missing email or userId or attachmentUrl" });
  }

  if (
    typeof email !== "string" ||
    typeof userId !== "string" ||
    typeof attachmentUrl !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "Invalid email or userId or attachmentUrl" });
  }

  // ❌ BAD: Don't put large data directly in job payload
  // await queue.add('send-welcome', {
  //   email,
  //   userId,
  //   attachmentData: largeFileBuffer  // 5MB file! Slows serialization, hits provider limits
  // });

  // ✅ GOOD: Store large data externally, pass reference
  // In production, upload to S3/blob storage first
  // const attachmentUrl = await s3.upload(attachmentData);

  // For this demo, we simulate the URL (in production: use real S3/storage URL)

  logger.info(
    { userId, attachmentUrl: attachmentUrl ?? "simulated-url" },
    "Simulating attachment upload to external storage",
  );

  const jobId = `welcome-${userId}`;

  const result = await queue.add(
    "send-welcome",
    {
      email,
      userId,
      attachmentUrl, // just the URL reference, not the actual data
    },
    {
      jobId,
      attempts: 3,
    },
  );

  if (result.success) {
    logger.info(
      { jobId: result.data.id, email, userId, attachmentUrl },
      "Job enqueued with attachment URL",
    );
    res.json({
      success: true,
      jobId: result.data.id,
      attachmentUrl,
    });
  } else {
    logger.error({ error: result.error }, "Failed to enqueue job");
    res.status(500).json({ error: "Failed to enqueue job" });
  }
});

// Health check
app.get("/health", async (_req, res) => {
  const stats = await queue.getStats();
  res.json({
    status: "ok",
    queue: stats.success ? stats.data : null,
  });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  logger.info({ port: PORT }, "🚀 Producer API started");
  logger.info(
    'Try: curl -X POST http://localhost:3000/signup -H "Content-Type: application/json" -d \'{"userId":"123","email":"user@example.com"}\'',
  );
});
