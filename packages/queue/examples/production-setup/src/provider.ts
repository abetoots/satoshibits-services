import { BullMQProvider } from "@satoshibits/queue/providers/bullmq";
import { Redis } from "ioredis";

import "dotenv/config";

/**
 * Shared provider configuration for both producer and worker
 *
 * This ensures both processes connect to the same Redis instance
 * with identical configuration, preventing misconfigurations.
 *
 * See: packages/queue/README.md#production-usage-redisbullmq
 */

// create Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: parseInt(process.env.REDIS_PORT ?? "6379"),
  maxRetriesPerRequest: null, // required for BullMQ
  enableReadyCheck: false,
});

// handle Redis connection events
redis.on("connect", () => {
  console.log("✅ Connected to Redis");
});

redis.on("error", (err: Error) => {
  console.error("❌ Redis connection error:", err);
});

// create BullMQ provider with shared Redis connection
export const provider = new BullMQProvider({
  connection: redis,
});
