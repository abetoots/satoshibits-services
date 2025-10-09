import { Result } from "@satoshibits/functional";

import type { EmailJobData } from "./types.js";
import type { ActiveJob } from "@satoshibits/queue";

import { logger } from "./logger.js";

/**
 * Email job handler with error classification
 *
 * Demonstrates:
 * - Error Classification: See README.md#mistake-1-treating-all-errors-the-same
 * - Security: See README.md#tier-1-your-applications-core-responsibilities (Security row)
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function emailHandler(
  data: EmailJobData,
  job: ActiveJob<EmailJobData>,
): Promise<Result<void, Error>> {
  try {
    // ✅ SECURITY: Get credentials from env, NOT from job payload
    // See: packages/queue/README.md#tier-1 (Security row)
    const emailConfig = {
      host: process.env.SMTP_HOST,
      user: process.env.SMTP_USER,
    };

    logger.info({ jobId: job.id, email: data.email }, "Processing email job");

    // ✅ SMALL PAYLOADS: If attachment URL exists, fetch it from external storage
    // See: packages/queue/README.md#mistake-6-putting-large-payloads-in-queue
    let attachment: Buffer | undefined;
    if (data.attachmentUrl) {
      // In production: fetch from S3/storage
      // const response = await fetch(data.attachmentUrl);
      // attachment = Buffer.from(await response.arrayBuffer());

      // For this demo, we simulate the fetch
      logger.info(
        { jobId: job.id, attachmentUrl: data.attachmentUrl },
        "Fetching attachment from external storage (simulated)",
      );
      attachment = Buffer.from("simulated-attachment-data");
    }

    // Simulate different error types for demo
    if (data.errorType === "transient") {
      throw Object.assign(new Error("Network timeout"), {
        code: "NETWORK_ERROR",
      });
    }

    if (data.errorType === "permanent") {
      throw Object.assign(new Error("Invalid email address"), {
        code: "INVALID_EMAIL",
      });
    }

    // ✅ MOCK: Log instead of actual SMTP (keeps example focused on queue patterns)
    logger.info(
      {
        to: data.email,
        userId: data.userId,
        config: emailConfig,
        hasAttachment: !!attachment,
        attachmentSize: attachment?.length ?? 0,
      },
      "📧 Email sent (mocked)",
    );

    return Result.ok(undefined);
  } catch (error) {
    // ✅ ERROR CLASSIFICATION
    // See: packages/queue/README.md#mistake-1-treating-all-errors-the-same

    // Transient errors - return Result.err to trigger retry
    //@ts-expect-error code property was assigned above
    if (error.code === "NETWORK_ERROR" || error.code === "RATE_LIMIT") {
      logger.warn(
        { jobId: job.id, error: (error as Error).message },
        "Transient error - will retry",
      );
      return Result.err(error as Error); // return error to trigger retry
    }

    // Permanent errors - return Result.ok to prevent retry
    //@ts-expect-error code property was assigned above
    if (error.code === "INVALID_EMAIL" || error.code === "BOUNCED") {
      logger.error(
        { jobId: job.id, error: (error as Error).message },
        "Permanent failure - won't retry",
      );
      return Result.ok(undefined); // mark complete, don't retry
    }

    // Unknown errors - return Result.err to retry (safer)
    logger.error(
      { jobId: job.id, error: (error as Error).message },
      "Unknown error - will retry",
    );
    return Result.err(error as Error); // return error to trigger retry
  }
}
