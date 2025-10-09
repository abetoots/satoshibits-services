import { pino } from "pino";

/**
 * Structured logger using Pino
 * See: packages/queue/README.md#tier-1-your-applications-core-responsibilities
 */
export const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname",
    },
  },
  level: process.env.LOG_LEVEL ?? "info",
});
