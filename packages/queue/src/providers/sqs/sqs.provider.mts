/**
 * SQSProvider - Production AWS SQS-backed queue provider
 *
 * Implements pull-only model using AWS SDK for JavaScript v3.
 * Validates architecture flexibility for providers without push model support.
 *
 * This provider is pull-only and does NOT implement process() method.
 * Worker API automatically uses fetch/ack/nack pattern.
 */

import { Result } from "@satoshibits/functional";
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  type Message,
} from "@aws-sdk/client-sqs";

import type {
  Job,
  ActiveJob,
  JobOptions,
  ProviderCapabilities,
  QueueError,
  QueueStats,
  HealthStatus,
} from "../../core/types.mjs";
import type {
  IQueueProvider,
  IProviderFactory,
} from "../provider.interface.mjs";

/**
 * Configuration for SQS provider
 */
export interface SQSProviderConfig {
  /**
   * Optional pre-configured SQS client
   * If not provided, will be created from region/credentials
   */
  client?: SQSClient;

  /**
   * AWS region (e.g., 'us-east-1')
   * Required if client not provided
   */
  region?: string;

  /**
   * AWS endpoint URL (e.g., for LocalStack: 'http://localhost:4566')
   * Optional - defaults to AWS SQS endpoints
   */
  endpoint?: string;

  /**
   * AWS credentials
   * Optional - falls back to AWS SDK default credential chain
   */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };

  /**
   * Queue URLs mapped by queue name
   * Example: { 'my-queue': 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue' }
   */
  queueUrls: Record<string, string>;

  /**
   * Optional DLQ URLs mapped by queue name
   * Used for getDLQJobs() operations
   */
  dlqUrls?: Record<string, string>;

  /**
   * Default visibility timeout in seconds (default: 30)
   * How long a message is invisible after being received
   */
  defaultVisibilityTimeout?: number;

  /**
   * Default wait time for long polling in seconds (default: 20, max: 20)
   * ReceiveMessage will wait up to this time for messages to arrive
   */
  defaultWaitTimeSeconds?: number;

  /**
   * Health threshold for queue depth (default: 10000)
   * Queue is considered healthy if depth is below this threshold
   */
  healthThreshold?: number;
}

/**
 * SQSProvider - Multi-queue AWS SQS-backed provider
 * Implements IProviderFactory to create queue-scoped instances
 *
 * Pull-only provider - does NOT implement process() method
 */
export class SQSProvider implements IProviderFactory {
  private readonly client: SQSClient;
  private readonly queueUrls: Map<string, string>;
  private readonly dlqUrls: Map<string, string>;
  private readonly defaultVisibilityTimeout: number;
  private readonly defaultWaitTimeSeconds: number;
  private readonly healthThreshold: number;

  // Local pause state tracking (SQS has no native pause)
  private pausedQueues = new Set<string>();

  private isShuttingDown = false;

  readonly capabilities: ProviderCapabilities = {
    supportsDelayedJobs: true, // DelaySeconds (0-900)
    supportsPriority: false, // ❌ SQS no native priority
    supportsRetries: true, // Via ReceiveCount + RedrivePolicy
    supportsDLQ: true, // Native RedrivePolicy
    supportsBatching: true, // fetch() batching only (ReceiveMessage 1-10). ack/nack are single-operation.
    supportsLongPolling: true, // WaitTimeSeconds (0-20)
    maxJobSize: 262144, // 256 KB
    maxBatchSize: 10, // SQS ReceiveMessage limit
    maxDelaySeconds: 900, // 15 minutes
  };

  constructor(config: SQSProviderConfig) {
    // HIGH-002: validate client or region requirement
    if (!config.client && !config.region) {
      throw new Error(
        "SQSProviderConfig requires either a `client` instance or an AWS `region`."
      );
    }

    // HIGH-002: validate at least one queue configured
    if (!config.queueUrls || Object.keys(config.queueUrls).length === 0) {
      throw new Error(
        "SQSProviderConfig requires at least one queue in `queueUrls`."
      );
    }

    // Build or use provided client
    this.client =
      config.client ??
      new SQSClient({
        region: config.region,
        endpoint: config.endpoint,
        credentials: config.credentials,
      });

    // Convert queue URLs to Map
    this.queueUrls = new Map(Object.entries(config.queueUrls));

    // Convert DLQ URLs to Map (optional)
    this.dlqUrls = new Map(
      Object.entries(config.dlqUrls ?? {})
    );

    this.defaultVisibilityTimeout = config.defaultVisibilityTimeout ?? 30;
    // LOW-001: ensure non-negative value
    this.defaultWaitTimeSeconds = Math.max(
      0,
      Math.min(config.defaultWaitTimeSeconds ?? 20, 20)
    ); // SQS max is 20s, min is 0
    this.healthThreshold = config.healthThreshold ?? 10000; // HIGH-011: configurable health threshold
  }

  /**
   * Create a queue-scoped provider instance
   */
  forQueue(queueName: string): IQueueProvider {
    return new BoundSQSProvider(this, queueName);
  }

  /**
   * Connect (SQS client is stateless, no connection needed)
   */
  async connect(): Promise<void> {
    // SQS client is stateless HTTP client, no connection to establish
  }

  /**
   * Disconnect and cleanup
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    this.pausedQueues.clear();
    // Note: SQSClient doesn't have a destroy() method in v3
  }

  /**
   * Get queue URL for a given queue name
   */
  private getQueueUrl(queueName: string): Result<string, QueueError> {
    const url = this.queueUrls.get(queueName);
    if (!url) {
      return Result.err({
        type: "ConfigurationError",
        code: "INVALID_CONFIG",
        message: `Queue URL not configured for queue: ${queueName}. Add to queueUrls in SQSProviderConfig.`,
        retryable: false,
      });
    }
    return Result.ok(url);
  }

  /**
   * Get DLQ URL for a given queue name (optional)
   */
  private getDLQUrl(queueName: string): string | null {
    return this.dlqUrls.get(queueName) ?? null;
  }

  /**
   * Check if queue is paused (local state)
   */
  private isPaused(queueName: string): boolean {
    return this.pausedQueues.has(queueName);
  }

  /**
   * MED-011: Safely parse numeric attribute with error logging
   * Prevents NaN propagation that obscures root cause
   */
  private parseAttribute(
    value: string | undefined,
    attributeName: string,
    queueName: string
  ): number {
    const raw = value ?? "0";
    const parsed = Number(raw);

    if (isNaN(parsed)) {
      console.error(
        `[SQSProvider] Failed to parse attribute '${attributeName}' for queue ${queueName}. Got: "${raw}"`,
        { queueName, attributeName, rawValue: raw }
      );
      return 0; // safe fallback
    }

    return parsed;
  }

  // ============================================================================
  // Phase 2: Add Job Implementation
  // ============================================================================

  /**
   * Internal: Add a job to the queue
   * Phase 2: Implemented using SendMessageCommand
   */
  async _addJob<T>(
    queueName: string,
    job: Job<T>,
    options?: JobOptions
  ): Promise<Result<Job<T>, QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    try {
      const queueUrlResult = this.getQueueUrl(queueName);
      if (!queueUrlResult.success) {
        return queueUrlResult;
      }
      const queueUrl = queueUrlResult.data;

      // wrap job data and metadata (same pattern as BullMQ)
      const messageBody = {
        _jobData: job.data,
        _metadata: job.metadata,
      };

      // serialize to JSON for MessageBody
      // wrap in try-catch to handle circular references and other serialization failures
      let messageBodyJson: string;
      try {
        messageBodyJson = JSON.stringify(messageBody);
      } catch (error) {
        return Result.err({
          type: "DataError",
          code: "SERIALIZATION",
          message: `Failed to serialize job data or metadata: ${error instanceof Error ? error.message : String(error)}`,
          queueName,
          jobId: job.id,
          data: error instanceof Error ? error : undefined,
          retryable: false,
        });
      }

      // calculate delay from scheduledFor (same logic as BullMQ)
      const delayMs = job.scheduledFor
        ? Math.max(0, job.scheduledFor.getTime() - Date.now())
        : 0;

      // for sub-second delays (<1000ms), don't send DelaySeconds to SQS
      // SQS only supports whole-second delays, and rounding up would be inaccurate
      const delaySeconds = delayMs >= 1000 ? Math.ceil(delayMs / 1000) : 0;

      // debug logging for delayed jobs (can remove after debugging)
      if (job.id === 'delayed-job') {
        console.log(`[SQSProvider Debug] Job: ${job.id}, ScheduledFor: ${job.scheduledFor?.toISOString()}, Now: ${new Date().toISOString()}, Calculated DelaySeconds: ${delaySeconds}`);
      }

      // validate delay < 900s (SQS limit: 15 minutes)
      if (delaySeconds > this.capabilities.maxDelaySeconds) {
        return Result.err({
          type: "DataError",
          code: "VALIDATION",
          message: `Delay ${delaySeconds}s exceeds SQS limit of ${this.capabilities.maxDelaySeconds}s (15 minutes)`,
          queueName,
          jobId: job.id,
          retryable: false,
        });
      }

      // map job fields to MessageAttributes
      // SQS MessageAttributes have strict type requirements
      const messageAttributes: Record<
        string,
        { StringValue?: string; DataType: string }
      > = {
        "job.id": {
          StringValue: job.id,
          DataType: "String",
        },
        "job.name": {
          StringValue: job.name,
          DataType: "String",
        },
        "job.maxAttempts": {
          StringValue: String(job.maxAttempts),
          DataType: "Number",
        },
        "job.createdAt": {
          StringValue: String(job.createdAt.getTime()),
          DataType: "Number",
        },
      };

      // MED-004: validate MessageAttributes count (SQS limit is 10)
      if (Object.keys(messageAttributes).length > 10) {
        return Result.err({
          type: "DataError",
          code: "VALIDATION",
          message: `Job has ${Object.keys(messageAttributes).length} message attributes, exceeding SQS limit of 10.`,
          queueName,
          jobId: job.id,
          retryable: false,
        });
      }

      // HIGH-005: validate total size < 256KB (SQS limit includes body + attributes)
      const messageBodySize = Buffer.byteLength(messageBodyJson, "utf8");
      const attributesSize = Object.entries(messageAttributes).reduce((sum, [name, attr]) => {
        return sum +
          Buffer.byteLength(name, "utf8") +
          Buffer.byteLength(attr.StringValue ?? "", "utf8") +
          Buffer.byteLength(attr.DataType, "utf8");
      }, 0);

      const totalSize = messageBodySize + attributesSize;
      if (totalSize > this.capabilities.maxJobSize) {
        return Result.err({
          type: "DataError",
          code: "VALIDATION",
          message: `Total message size ${totalSize} bytes exceeds SQS limit of ${this.capabilities.maxJobSize} bytes (256KB). Body: ${messageBodySize} bytes, Attributes: ${attributesSize} bytes.`,
          queueName,
          jobId: job.id,
          retryable: false,
        });
      }

      // allowlist safe FIFO-specific options from escape hatch
      // only MessageGroupId and MessageDeduplicationId are allowed to prevent security issues
      const sqsOptions = options?.providerOptions?.sqs ?? {};
      const allowedSqsOptions: {
        MessageGroupId?: string;
        MessageDeduplicationId?: string;
      } = {};

      if (typeof sqsOptions.MessageGroupId === "string") {
        allowedSqsOptions.MessageGroupId = sqsOptions.MessageGroupId;
      }
      if (typeof sqsOptions.MessageDeduplicationId === "string") {
        allowedSqsOptions.MessageDeduplicationId = sqsOptions.MessageDeduplicationId;
      }

      // send message to SQS
      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBodyJson,
        MessageAttributes: messageAttributes,
        DelaySeconds: delaySeconds > 0 ? delaySeconds : undefined,
        ...allowedSqsOptions, // only safe FIFO options
      });

      await this.client.send(command);

      // MED-005: return the job with updated status
      // use scheduledFor presence instead of delaySeconds to handle sub-second delays
      const addedJob: Job<T> = {
        ...job,
        status: job.scheduledFor ? "delayed" : "waiting",
      };

      return Result.ok(addedJob);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _getJob<T>(
    _queueName: string,
    _jobId: string
  ): Promise<Result<Job<T> | null, QueueError>> {
    // SQS limitation: No message lookup API
    return Result.ok(null);
  }

  // ============================================================================
  // Phase 3: Pull Model Implementation (CRITICAL PATH)
  // ============================================================================

  /**
   * Internal: Fetch jobs from queue (pull model)
   * Phase 3: Implemented using ReceiveMessageCommand
   */
  async _fetchJobs<T>(
    queueName: string,
    count: number,
    waitTimeMs?: number
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    try {
      // check pause state first
      if (this.isPaused(queueName)) {
        return Result.ok([]); // return empty array when paused
      }

      const queueUrlResult = this.getQueueUrl(queueName);
      if (!queueUrlResult.success) {
        return queueUrlResult;
      }
      const queueUrl = queueUrlResult.data;

      // SQS batch limit is 10 messages
      const maxMessages = Math.min(count, this.capabilities.maxBatchSize);

      // convert wait time from ms to seconds (SQS uses seconds)
      // default to configured wait time, max 20 seconds (SQS limit)
      const waitTimeSeconds = waitTimeMs
        ? Math.min(Math.floor(waitTimeMs / 1000), 20)
        : this.defaultWaitTimeSeconds;

      const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
        VisibilityTimeout: this.defaultVisibilityTimeout,
        MessageAttributeNames: ["All"], // retrieve all message attributes
        MessageSystemAttributeNames: ["ApproximateReceiveCount", "SentTimestamp"], // MED-013/016: for attempt tracking and timestamp
      });

      const response = await this.client.send(command);

      // no messages available
      if (!response.Messages || response.Messages.length === 0) {
        return Result.ok([]);
      }

      // map SQS messages to jobs (receipt handle now stored in job.providerMetadata)
      // wrap each message in try-catch to prevent poison pill from killing entire batch
      const jobs: ActiveJob<T>[] = [];
      for (const message of response.Messages) {
        try {
          const job = this.mapSQSMessageToJob<T>(message, queueName, "main");
          jobs.push(job);
        } catch (mapError) {
          // poison pill detected - log and optionally delete to prevent infinite retry
          console.error(
            `[SQSProvider] Failed to map SQS message in queue ${queueName}. Skipping.`,
            { messageId: message.MessageId, error: mapError }
          );

          // attempt to delete poison pill from queue (best effort)
          if (message.ReceiptHandle) {
            try {
              await this.client.send(
                new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: message.ReceiptHandle,
                })
              );
            } catch (deleteError) {
              // log but don't fail batch - deletion is best effort
              console.error(
                `[SQSProvider] Failed to delete poison pill message ${message.MessageId}`,
                deleteError
              );
            }
          }
        }
      }

      return Result.ok(jobs);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Acknowledge job completion (delete from queue)
   * Phase 3: Implemented using DeleteMessageCommand
   */
  async _ackJob<T>(
    queueName: string,
    job: ActiveJob<T>,
    _result?: unknown
  ): Promise<Result<void, QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    try {
      const queueUrlResult = this.getQueueUrl(queueName);
      if (!queueUrlResult.success) {
        return queueUrlResult;
      }
      const queueUrl = queueUrlResult.data;

      // retrieve receipt handle from job metadata
      const receiptHandle = job.providerMetadata?.receiptHandle;
      if (!receiptHandle) {
        return Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Receipt handle not found for job ${job.id}. Job may have expired or already been processed.`,
          retryable: false,
          queueName,
          jobId: job.id,
        });
      }

      // delete message from queue (permanent removal)
      const command = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.client.send(command);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Reject job (make immediately visible for retry)
   * Phase 3: Implemented using ChangeMessageVisibilityCommand
   */
  async _nackJob<T>(
    queueName: string,
    job: ActiveJob<T>,
    _error: Error
  ): Promise<Result<void, QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    try {
      const queueUrlResult = this.getQueueUrl(queueName);
      if (!queueUrlResult.success) {
        return queueUrlResult;
      }
      const queueUrl = queueUrlResult.data;

      // retrieve receipt handle from job metadata
      const receiptHandle = job.providerMetadata?.receiptHandle;
      if (!receiptHandle) {
        return Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Receipt handle not found for job ${job.id}. Job may have expired or already been processed.`,
          retryable: false,
          queueName,
          jobId: job.id,
        });
      }

      // set visibility timeout to 0 (immediate retry)
      const command = new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 0, // make immediately visible
      });

      await this.client.send(command);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Map SQS Message to ActiveJob
   * Phase 3: Helper method to convert SQS message format to normalized ActiveJob
   */
  private mapSQSMessageToJob<T>(
    message: Message,
    queueName: string,
    source: "main" | "dlq" = "main"
  ): ActiveJob<T> {
    // parse message body to extract wrapped data
    const messageBody = JSON.parse(message.Body ?? "{}") as {
      _jobData: unknown;
      _metadata?: Record<string, unknown>;
    };
    const jobData = messageBody._jobData as T;
    const metadata = messageBody._metadata;

    // extract job fields from message attributes
    const jobId = message.MessageAttributes?.["job.id"]?.StringValue;

    // validate jobId exists - missing jobId is invalid message
    if (!jobId) {
      throw new Error(
        `Message missing required 'job.id' attribute. MessageId: ${message.MessageId}`
      );
    }

    const jobName = message.MessageAttributes?.["job.name"]?.StringValue ?? "";
    const maxAttempts = Number(
      message.MessageAttributes?.["job.maxAttempts"]?.StringValue ?? "3"
    );
    const createdAtTimestamp = Number(
      message.MessageAttributes?.["job.createdAt"]?.StringValue ?? Date.now()
    );

    // calculate attempts from ApproximateReceiveCount
    // SQS counts how many times message has been received
    // attempts = receiveCount - 1 (first receive is attempt 0)
    const receiveCount = Number(
      message.Attributes?.ApproximateReceiveCount ?? "1"
    );
    const attempts = receiveCount - 1;

    // construct normalized job
    return {
      id: jobId,
      name: jobName,
      queueName,
      data: jobData,
      status: source === "dlq" ? "failed" : "active", // dlq jobs are failed, main queue jobs are active
      attempts,
      maxAttempts,
      createdAt: new Date(createdAtTimestamp),
      // LOW-006: processedAt should be set by worker when processing starts, not when fetched
      processedAt: undefined,
      metadata,
      providerMetadata: {
        receiptHandle: message.ReceiptHandle,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _pauseQueue(queueName: string): Promise<Result<void, QueueError>> {
    this.pausedQueues.add(queueName);
    return Result.ok(undefined);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _resumeQueue(queueName: string): Promise<Result<void, QueueError>> {
    this.pausedQueues.delete(queueName);
    return Result.ok(undefined);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _deleteQueue(queueName: string): Promise<Result<void, QueueError>> {
    return Result.err({
      type: "ConfigurationError",
      code: "UNSUPPORTED_FEATURE",
      message:
        "SQS queue deletion must be done via AWS Console/CLI for safety. " +
        "DeleteQueue is permanent and takes 60 seconds to propagate.",
      retryable: false,
      queueName,
    });
  }

  // ============================================================================
  // Phase 4: Management Operations
  // ============================================================================

  /**
   * Internal: Get queue statistics
   * Phase 4: Implemented using GetQueueAttributesCommand
   */
  async _getStats(queueName: string): Promise<Result<QueueStats, QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    try {
      const queueUrlResult = this.getQueueUrl(queueName);
      if (!queueUrlResult.success) {
        return queueUrlResult;
      }
      const queueUrl = queueUrlResult.data;

      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          "ApproximateNumberOfMessages", // waiting
          "ApproximateNumberOfMessagesNotVisible", // active (being processed)
          "ApproximateNumberOfMessagesDelayed", // delayed
        ],
      });

      const response = await this.client.send(command);

      const attributes = response.Attributes ?? {};

      // MED-011: parse SQS attributes to queue stats with validation
      // LOW-011: Note - All SQS queue attributes are approximate and may lag behind actual state
      const stats: QueueStats = {
        queueName,
        waiting: this.parseAttribute(
          attributes.ApproximateNumberOfMessages,
          "ApproximateNumberOfMessages",
          queueName
        ),
        active: this.parseAttribute(
          attributes.ApproximateNumberOfMessagesNotVisible,
          "ApproximateNumberOfMessagesNotVisible",
          queueName
        ),
        delayed: this.parseAttribute(
          attributes.ApproximateNumberOfMessagesDelayed,
          "ApproximateNumberOfMessagesDelayed",
          queueName
        ),
        completed: 0, // SQS limitation: doesn't track completed jobs
        failed: 0, // SQS limitation: use DLQ for failed jobs
        paused: this.isPaused(queueName),
      };

      return Result.ok(stats);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Get queue health status
   * Phase 4: Calculated from stats
   */
  async _getHealth(
    queueName: string
  ): Promise<Result<HealthStatus, QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    // LOW-009: removed redundant try-catch - _getStats returns Result, never throws
    const statsResult = await this._getStats(queueName);

    if (!statsResult.success) {
      return Result.err(statsResult.error);
    }

    const stats = statsResult.data;

    // calculate queue depth (total messages)
    const queueDepth = stats.waiting + stats.active + stats.delayed;

    // calculate error rate from stats
    const totalProcessed = stats.completed + stats.failed;
    const errorRate =
      totalProcessed > 0 ? (stats.failed / totalProcessed) * 100 : 0;

    // Return raw metrics - userland determines health thresholds
    const health: HealthStatus = {
      activeWorkers: 0, // SQS limitation: can't track worker count
      queueDepth,
      errorRate,
      completedCount: stats.completed,
      failedCount: stats.failed,
      isPaused: stats.paused,
    };

    return Result.ok(health);
  }

  // ============================================================================
  // Phase 5: DLQ Operations
  // ============================================================================

  /**
   * Internal: Get jobs from Dead Letter Queue
   * Phase 5: Implemented using ReceiveMessageCommand on DLQ
   */
  async _getDLQJobs<T>(
    queueName: string,
    limit = 100
  ): Promise<Result<Job<T>[], QueueError>> {
    // HIGH-001: check shutdown flag
    if (this.isShuttingDown) {
      return Result.err({
        type: "RuntimeError",
        code: "SHUTDOWN",
        message: "Provider is shutting down.",
        queueName,
        retryable: false,
      });
    }

    // MED-014: validate and cap limit parameter
    if (limit < 1) {
      return Result.ok([]); // return empty array for invalid limit
    }
    const cappedLimit = Math.min(limit, 1000); // cap at 1000 to prevent excessive API calls

    try {
      // check if DLQ URL is configured for this queue
      const dlqUrl = this.getDLQUrl(queueName);
      if (!dlqUrl) {
        return Result.err({
          type: "ConfigurationError",
          code: "INVALID_CONFIG",
          message: `DLQ not configured for queue: ${queueName}. Add to dlqUrls in SQSProviderConfig.`,
          retryable: false,
          queueName,
        });
      }

      // fetch messages from DLQ (does NOT delete them)
      // SQS batch limit is 10, so we may need multiple fetches for larger limits
      const maxBatchSize = this.capabilities.maxBatchSize; // 10
      const batchCount = Math.ceil(cappedLimit / maxBatchSize);
      const jobs: Job<T>[] = [];

      for (let i = 0; i < batchCount && jobs.length < cappedLimit; i++) {
        const remainingLimit = cappedLimit - jobs.length;
        const batchSize = Math.min(remainingLimit, maxBatchSize);

        const command = new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: batchSize,
          WaitTimeSeconds: 0, // no long polling for DLQ
          MessageAttributeNames: ["All"],
          MessageSystemAttributeNames: ["ApproximateReceiveCount", "SentTimestamp"], // MED-016: add SentTimestamp
        });

        const response = await this.client.send(command);

        // no more messages in DLQ
        if (!response.Messages || response.Messages.length === 0) {
          break;
        }

        // map DLQ messages to jobs (receipt handle stored in job.providerMetadata)
        // wrap each message in try-catch - DLQ often contains corrupted messages
        for (const message of response.Messages) {
          try {
            const job = this.mapSQSMessageToJob<T>(message, queueName, "dlq");
            jobs.push(job);
          } catch (mappingError) {
            // DLQ poison pill detected - log and skip (don't delete, preserve for debugging)
            console.error(
              `[SQSProvider] Failed to map DLQ message for queue ${queueName}. Skipping.`,
              { messageId: message.MessageId, error: mappingError }
            );
            // skip this message, continue with rest
          }
        }
      }

      return Result.ok(jobs);
    } catch (error) {
      return Result.err(this.mapError(error, queueName));
    }
  }

  /**
   * Internal: Retry a job from DLQ
   * Phase 5: NOT IMPLEMENTED - SQS limitation
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return type
  async _retryJob(
    queueName: string,
    jobId: string
  ): Promise<Result<void, QueueError>> {
    return Result.err({
      type: "RuntimeError",
      code: "NOT_IMPLEMENTED",
      message:
        "SQS has no atomic message move operation. " +
        "Retry requires: Fetch from DLQ → Send to main queue → Delete from DLQ (not atomic). " +
        "Use AWS Console/CLI or implement custom retry logic in your application.",
      retryable: false,
      queueName,
      jobId,
    });
  }

  // ============================================================================
  // Phase 6: Error Mapping (VALIDATES MEDIUM-001)
  // ============================================================================

  /**
   * Check if error is AWS SDK error
   * Phase 6: Helper to detect AWS SDK v3 errors
   * MED-019: Strengthened type guard to validate name is string
   */
  private isAWSError(error: unknown): error is { name: string; $metadata?: unknown } {
    return (
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      typeof error.name === "string" && // TypeScript narrows error after "name" in error check
      "$metadata" in error // AWS SDK v3 signature
    );
  }

  /**
   * Map errors to QueueError
   * Phase 6: Comprehensive AWS SDK error mapping
   */
  private mapError(error: unknown, queueName: string): QueueError {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // AWS SDK v3 errors (type-safe error.name checks)
    if (this.isAWSError(error)) {
      const awsErrorName = error.name;

      // connection errors
      if (
        awsErrorName === "NetworkingError" ||
        awsErrorName === "TimeoutError"
      ) {
        return {
          type: "RuntimeError",
          code: "CONNECTION",
          message: `AWS SQS connection failed: ${errorMessage}`,
          queueName,
          retryable: true,
          cause: error instanceof Error ? error : undefined,
        };
      }

      // throttling errors (AWS-specific, retryable)
      if (
        awsErrorName === "RequestThrottled" ||
        awsErrorName === "ThrottlingException" ||
        awsErrorName === "TooManyRequestsException"
      ) {
        return {
          type: "RuntimeError",
          code: "THROTTLING", // LOW-015: use specific throttling code for better observability
          message: `AWS SQS throttling: ${errorMessage}. Retry with backoff.`,
          queueName,
          retryable: true,
          cause: error instanceof Error ? error : undefined,
        };
      }

      // service unavailable errors (AWS-specific, retryable)
      if (
        awsErrorName === "ServiceUnavailable" ||
        awsErrorName === "InternalError" ||
        awsErrorName === "ServiceException"
      ) {
        return {
          type: "RuntimeError",
          code: "PROCESSING",
          message: `AWS SQS service error: ${errorMessage}. Temporary issue, retry.`,
          queueName,
          retryable: true,
          cause: error instanceof Error ? error : undefined,
        };
      }

      // receipt handle errors (SQS-specific concept)
      // LOW-016: string matching for ReceiptHandle is brittle but necessary
      // as AWS doesn't provide a specific error code for this case
      if (
        awsErrorName === "ReceiptHandleIsInvalid" ||
        awsErrorName === "InvalidParameterValue" &&
          errorMessage.includes("ReceiptHandle") ||
        awsErrorName === "MessageNotInflight"
      ) {
        return {
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Receipt handle invalid or expired: ${errorMessage}`,
          queueName,
          retryable: false,
          cause: error instanceof Error ? error : undefined,
        };
      }

      // queue not found errors
      if (
        awsErrorName === "QueueDoesNotExist" ||
        awsErrorName === "AWS.SimpleQueueService.NonExistentQueue"
      ) {
        return {
          type: "ConfigurationError",
          code: "INVALID_CONFIG",
          message: `Queue does not exist: ${errorMessage}`,
          retryable: false,
          details: { queueName },
        };
      }

      // permission errors (AWS IAM)
      if (
        awsErrorName === "AccessDenied" ||
        awsErrorName === "AccessDeniedException" ||
        awsErrorName === "UnauthorizedOperation"
      ) {
        return {
          type: "ConfigurationError",
          code: "PROVIDER_ERROR",
          message: `AWS IAM permission denied: ${errorMessage}`,
          retryable: false,
          details: { queueName },
        };
      }

      // MED-017: credential/authentication errors
      if (
        awsErrorName === "InvalidClientTokenId" ||
        awsErrorName === "UnrecognizedClientException" ||
        awsErrorName === "InvalidSecurityToken"
      ) {
        return {
          type: "ConfigurationError",
          code: "PROVIDER_ERROR",
          message: `AWS IAM authentication/credential error: ${errorMessage}`,
          retryable: false,
          details: { queueName },
        };
      }

      // MED-017: KMS encryption errors
      if (awsErrorName.startsWith("Kms")) {
        return {
          type: "ConfigurationError",
          code: "PROVIDER_ERROR",
          message: `AWS KMS permission or configuration error: ${errorMessage}`,
          retryable: false,
          details: { queueName },
        };
      }

      // size/validation errors
      if (
        awsErrorName === "InvalidMessageContents" ||
        awsErrorName === "MessageTooLong"
      ) {
        return {
          type: "DataError",
          code: "VALIDATION",
          message: `Message validation failed: ${errorMessage}`,
          retryable: false,
          queueName,
        };
      }

      // parameter errors
      if (
        awsErrorName === "InvalidParameterValue" ||
        awsErrorName === "InvalidAttributeName" ||
        awsErrorName === "InvalidAttributeValue"
      ) {
        return {
          type: "ConfigurationError",
          code: "INVALID_CONFIG",
          message: `Invalid parameter: ${errorMessage}`,
          retryable: false,
          details: { queueName },
        };
      }

      // HIGH-014: default case for unhandled AWS errors
      // preserves error.name in message for better observability
      return {
        type: "RuntimeError",
        code: "PROVIDER_ERROR",
        message: `Unhandled AWS SQS Error (${awsErrorName}): ${errorMessage}`,
        queueName,
        retryable: false,
        cause: error instanceof Error ? error : undefined,
      };
    }

    // fallback for non-AWS errors
    const lowerMessage = errorMessage.toLowerCase();

    // MED-018: JSON parse errors (serialization) - strengthened with SyntaxError check
    if (
      error instanceof SyntaxError &&
      (lowerMessage.includes("json") || lowerMessage.includes("parse"))
    ) {
      return {
        type: "DataError",
        code: "SERIALIZATION",
        message: `Serialization error: ${errorMessage}`,
        retryable: false,
        queueName,
      };
    }

    // timeout errors (string matching fallback)
    if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
      return {
        type: "RuntimeError",
        code: "TIMEOUT",
        message: errorMessage,
        queueName,
        retryable: true,
        cause: error instanceof Error ? error : undefined,
      };
    }

    // default: generic processing error
    return {
      type: "RuntimeError",
      code: "PROCESSING",
      message: errorMessage,
      queueName,
      retryable: false, // explicitly non-retryable for safety - unknown errors should not retry infinitely
      cause: error instanceof Error ? error : undefined,
    };
  }
}

/**
 * BoundSQSProvider - Queue-scoped wrapper around SQSProvider
 * Implements IQueueProvider interface with queue-specific operations
 *
 * IMPORTANT: Does NOT implement process() method (pull-only provider)
 */
class BoundSQSProvider implements IQueueProvider {
  constructor(
    private readonly provider: SQSProvider,
    private readonly queueName: string
  ) {}

  get capabilities(): ProviderCapabilities {
    return this.provider.capabilities;
  }

  async connect(): Promise<void> {
    return this.provider.connect();
  }

  /**
   * Disconnects the underlying shared SQS client.
   * ⚠️ LOW-002: This will affect all queues managed by this provider instance.
   */
  async disconnect(): Promise<void> {
    return this.provider.disconnect();
  }

  async add<T>(job: Job<T>, options?: JobOptions): Promise<Result<Job<T>, QueueError>> {
    return this.provider._addJob(this.queueName, job, options);
  }

  async getJob<T>(jobId: string): Promise<Result<Job<T> | null, QueueError>> {
    return this.provider._getJob<T>(this.queueName, jobId);
  }

  async fetch<T>(
    batchSize: number,
    waitTimeMs?: number
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    return this.provider._fetchJobs<T>(this.queueName, batchSize, waitTimeMs);
  }

  async ack<T>(
    job: ActiveJob<T>,
    result?: unknown
  ): Promise<Result<void, QueueError>> {
    return this.provider._ackJob(this.queueName, job, result);
  }

  async nack<T>(job: ActiveJob<T>, error: Error): Promise<Result<void, QueueError>> {
    return this.provider._nackJob(this.queueName, job, error);
  }

  // ❌ NO process() method - pull-only provider!
  // Worker API will automatically use fetch/ack/nack pattern

  async pause(): Promise<Result<void, QueueError>> {
    return this.provider._pauseQueue(this.queueName);
  }

  async resume(): Promise<Result<void, QueueError>> {
    return this.provider._resumeQueue(this.queueName);
  }

  async delete(): Promise<Result<void, QueueError>> {
    return this.provider._deleteQueue(this.queueName);
  }

  async getStats(): Promise<Result<QueueStats, QueueError>> {
    return this.provider._getStats(this.queueName);
  }

  async getHealth(): Promise<Result<HealthStatus, QueueError>> {
    return this.provider._getHealth(this.queueName);
  }

  async getDLQJobs<T>(
    limit?: number
  ): Promise<Result<Job<T>[], QueueError>> {
    return this.provider._getDLQJobs<T>(this.queueName, limit);
  }

  async retryJob(jobId: string): Promise<Result<void, QueueError>> {
    return this.provider._retryJob(this.queueName, jobId);
  }
}
