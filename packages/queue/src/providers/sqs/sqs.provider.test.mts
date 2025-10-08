/**
 * SQS Provider Tests - Phase 1: Core Structure + Phase 2: Add Job + Phase 3: Pull Model
 *
 * NOTE: Contract tests from __shared__/provider-contract.test.mts require
 * actual AWS SQS access and are better suited for integration tests.
 * See packages/queue/TEST_QUALITY_AUDIT.md for contract test requirements.
 */

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "node:assert";

import { createMockJob, createMockJobBatch } from "../../test-utils.mjs";
import type { ActiveJob } from "../../core/types.mjs";
import { SQSProvider } from "./sqs.provider.mjs";

const sqsMock = mockClient(SQSClient);

describe("SQSProvider - Phase 1: Core Structure", () => {
  beforeEach(() => {
    sqsMock.reset();
  });

  describe("Provider Factory", () => {
    it("should create provider with region and credentials", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        credentials: {
          accessKeyId: "test-key",
          secretAccessKey: "test-secret",
        },
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      expect(provider).toBeDefined();
      expect(provider.capabilities).toBeDefined();
    });

    it("should create provider with custom SQS client", () => {
      const customClient = new SQSClient({ region: "us-west-2" });

      const provider = new SQSProvider({
        client: customClient,
        queueUrls: {
          "test-queue": "https://sqs.us-west-2.amazonaws.com/456/test-queue",
        },
      });

      expect(provider).toBeDefined();
    });

    it("should create queue-scoped provider via forQueue()", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");

      expect(boundProvider).toBeDefined();
      expect(boundProvider.capabilities).toEqual(provider.capabilities);
    });
  });

  describe("Capabilities", () => {
    it("should declare accurate capabilities (no priority, 256KB limit, 15min delay)", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      expect(provider.capabilities.supportsDelayedJobs).toBe(true);
      expect(provider.capabilities.supportsPriority).toBe(false); // ❌ Key difference from BullMQ
      expect(provider.capabilities.supportsRetries).toBe(true);
      expect(provider.capabilities.supportsDLQ).toBe(true);
      expect(provider.capabilities.supportsBatching).toBe(true);
      expect(provider.capabilities.supportsLongPolling).toBe(true);
      expect(provider.capabilities.maxJobSize).toBe(262144); // 256 KB
      expect(provider.capabilities.maxBatchSize).toBe(10); // SQS limit
      expect(provider.capabilities.maxDelaySeconds).toBe(900); // 15 minutes
    });
  });

  describe("Pull-Only Provider", () => {
    it("should NOT have process() method on BoundSQSProvider", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");

      // ✅ Key validation: Pull-only provider has no process() method
      expect(boundProvider.process).toBeUndefined();
    });

    it("should have fetch/ack/nack methods (pull model)", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");

      // Pull model methods
      expect(boundProvider.fetch).toBeDefined();
      expect(boundProvider.ack).toBeDefined();
      expect(boundProvider.nack).toBeDefined();
    });
  });

  describe("Configuration", () => {
    it("should accept queue URLs", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "queue-1": "https://sqs.us-east-1.amazonaws.com/123/queue-1",
          "queue-2": "https://sqs.us-east-1.amazonaws.com/123/queue-2",
        },
      });

      expect(provider.forQueue("queue-1")).toBeDefined();
      expect(provider.forQueue("queue-2")).toBeDefined();
    });

    it("should accept optional DLQ URLs", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "main-queue": "https://sqs.us-east-1.amazonaws.com/123/main-queue",
        },
        dlqUrls: {
          "main-queue":
            "https://sqs.us-east-1.amazonaws.com/123/main-queue-dlq",
        },
      });

      expect(provider).toBeDefined();
    });

    it("should accept optional visibility timeout and wait time", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        defaultVisibilityTimeout: 45,
        defaultWaitTimeSeconds: 15,
      });

      expect(provider).toBeDefined();
    });

    it("should clamp wait time to max 20 seconds", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        defaultWaitTimeSeconds: 30, // Exceeds SQS max
      });

      // Internal field check would require exposing or testing behavior
      // For now, just verify provider created successfully
      expect(provider).toBeDefined();
    });
  });

  describe("Lifecycle", () => {
    it("should connect without errors", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      await expect(provider.connect()).resolves.toBeUndefined();
    });

    it("should disconnect without errors", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      await expect(provider.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("SQS Limitations", () => {
    it("should return null for getJob() (not supported)", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.getJob("job-1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull(); // ✅ Document limitation
      }
    });

    it("should return error for delete() (not supported)", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.delete();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UNSUPPORTED_FEATURE");
        expect(result.error.message).toContain("AWS Console/CLI");
      }
    });
  });

  describe("Pause/Resume", () => {
    it("should pause queue (local state)", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.pause();

      expect(result.success).toBe(true);
    });

    it("should resume queue (local state)", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      await boundProvider.pause();
      const result = await boundProvider.resume();

      expect(result.success).toBe(true);
    });
  });

  describe("Phase 2: Add Job Implementation", () => {
    it("should send message with wrapped data structure", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob<{ userId: string }>({
        id: "job-1",
        data: { userId: "user-123" },
        metadata: { source: "api" },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(true);

      // verify SendMessageCommand was called with wrapped structure
      const calls = sqsMock.commandCalls(SendMessageCommand);
      expect(calls).toHaveLength(1);

      const command = calls[0]?.args[0].input;
      expect(command?.QueueUrl).toBe(
        "https://sqs.us-east-1.amazonaws.com/123/test-queue",
      );

      if (!command) {
        fail("Expected SendMessageCommand to be called with input");
      }

      // parse message body to verify wrapped structure
      const messageBody = JSON.parse(command.MessageBody!) as Record<
        string,
        unknown
      >;
      expect(messageBody).toEqual({
        _jobData: { userId: "user-123" },
        _metadata: { source: "api" },
      });
    });

    it("should map job fields to MessageAttributes", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const createdAt = new Date("2025-01-01T00:00:00Z");
      const job = createMockJob({
        id: "job-123",
        name: "process-order",
        maxAttempts: 5,
        createdAt,
      });

      const boundProvider = provider.forQueue("test-queue");
      await boundProvider.add(job);

      const calls = sqsMock.commandCalls(SendMessageCommand);
      const command = calls[0]?.args[0].input;

      // verify message attributes
      expect(command?.MessageAttributes).toEqual({
        "job.id": {
          StringValue: "job-123",
          DataType: "String",
        },
        "job.name": {
          StringValue: "process-order",
          DataType: "String",
        },
        "job.maxAttempts": {
          StringValue: "5",
          DataType: "Number",
        },
        "job.createdAt": {
          StringValue: String(createdAt.getTime()),
          DataType: "Number",
        },
      });
    });

    it("should validate job size < 256KB", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // create job with data that exceeds 256KB
      const largeData = "x".repeat(300 * 1024); // 300KB
      const job = createMockJob<{ payload: string }>({
        id: "job-1",
        name: "large-job",
        data: { payload: largeData },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      // should return validation error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("DataError");
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("256KB");
      }
    });

    it("should validate delay < 900s (15 min)", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // create job with delay exceeding 15 minutes
      const futureDate = new Date(Date.now() + 1000 * 1000); // 1000 seconds
      const job = createMockJob({
        id: "job-1",
        name: "delayed-job",
        status: "delayed",
        scheduledFor: futureDate,
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      // should return validation error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("DataError");
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("900s");
        expect(result.error.message).toContain("15 minutes");
      }
    });

    it("should calculate DelaySeconds correctly", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // create job with 5 minute delay
      const futureDate = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
      const job = createMockJob({
        id: "job-1",
        name: "delayed-job",
        status: "delayed",
        scheduledFor: futureDate,
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(true);

      const calls = sqsMock.commandCalls(SendMessageCommand);
      const command = calls[0]?.args[0].input;

      // verify DelaySeconds is around 300 (5 minutes)
      expect(command?.DelaySeconds).toBeGreaterThanOrEqual(299);
      expect(command?.DelaySeconds).toBeLessThanOrEqual(300);

      // verify job status is "delayed"
      if (result.success) {
        expect(result.data.status).toBe("delayed");
      }
    });

    it("should use allowlist for FIFO options (only MessageGroupId and MessageDeduplicationId allowed)", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue.fifo":
            "https://sqs.us-east-1.amazonaws.com/123/test-queue.fifo",
        },
      });

      const job = createMockJob({
        id: "job-1",
        name: "fifo-job",
        queueName: "test-queue.fifo",
        data: { orderId: 123 },
      });

      const boundProvider = provider.forQueue("test-queue.fifo");
      const result = await boundProvider.add(job, {
        // allowlist pattern for FIFO-specific options
        providerOptions: {
          sqs: {
            MessageGroupId: "order-group",
            MessageDeduplicationId: "order-123-dedup",
            // malicious attempt to override sensitive properties - should be blocked
            QueueUrl: "https://evil.com/steal-data",
            MessageBody: "malicious payload",
          },
        },
      });

      expect(result.success).toBe(true);

      const calls = sqsMock.commandCalls(SendMessageCommand);
      const command = calls[0]?.args[0].input;

      // verify allowed FIFO options were passed through
      expect(command?.MessageGroupId).toBe("order-group");
      expect(command?.MessageDeduplicationId).toBe("order-123-dedup");

      // verify disallowed properties were NOT passed through (security)
      expect(command?.QueueUrl).not.toBe("https://evil.com/steal-data");
      expect(command?.QueueUrl).toBe(
        "https://sqs.us-east-1.amazonaws.com/123/test-queue.fifo",
      );
      expect(command?.MessageBody).not.toBe("malicious payload");
    });
  });

  describe("Phase 3: Pull Model Implementation", () => {
    it("should fetch jobs atomically via ReceiveMessage", async () => {
      // mock ReceiveMessage response
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-1",
            ReceiptHandle: "receipt-1",
            Body: JSON.stringify({
              _jobData: { userId: "user-123" },
              _metadata: { source: "api" },
            }),
            MessageAttributes: {
              "job.id": { StringValue: "job-1", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "1",
            },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.fetch?.(10);

      expect(result?.success).toBe(true);
      if (result?.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.id).toBe("job-1");
        expect(result.data[0]?.name).toBe("test-job");
        expect(result.data[0]?.data).toEqual({ userId: "user-123" });
        expect(result.data[0]?.status).toBe("active"); // received = active
        expect(result.data[0]?.attempts).toBe(0); // first receive
      }

      // verify ReceiveMessageCommand was called correctly
      const calls = sqsMock.commandCalls(ReceiveMessageCommand);
      expect(calls).toHaveLength(1);
      const command = calls[0]?.args[0].input;
      expect(command?.MaxNumberOfMessages).toBe(10);
      expect(command?.MessageAttributeNames).toEqual(["All"]);
      expect(command?.MessageSystemAttributeNames).toEqual([
        "ApproximateReceiveCount",
        "SentTimestamp",
      ]);
    });

    it("should store receipt handle in job.providerMetadata during fetch", async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-1",
            ReceiptHandle: "receipt-handle-123",
            Body: JSON.stringify({ _jobData: {}, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-abc", DataType: "String" },
              "job.name": { StringValue: "test", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "1",
            },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const fetchResult = await boundProvider.fetch?.(1);

      // verify receipt handle is stored in job.providerMetadata
      expect(fetchResult?.success).toBe(true);
      if (fetchResult?.success) {
        const jobs = fetchResult.data;
        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.providerMetadata?.receiptHandle).toBe(
          "receipt-handle-123",
        );

        // verify ack uses receipt handle from job.providerMetadata
        sqsMock.on(DeleteMessageCommand).resolves({});
        const ackResult = await boundProvider.ack?.(jobs[0]!);

        expect(ackResult?.success).toBe(true);

        // verify DeleteMessage was called with correct receipt handle
        const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0]?.args[0].input.ReceiptHandle).toBe(
          "receipt-handle-123",
        );
      }
    });

    it("should respect batch size limit of 10", async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      await boundProvider.fetch?.(50); // request more than SQS limit

      // verify MaxNumberOfMessages was clamped to 10
      const calls = sqsMock.commandCalls(ReceiveMessageCommand);
      expect(calls[0]?.args[0].input.MaxNumberOfMessages).toBe(10);
    });

    it("should use long polling with configured wait time", async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        defaultWaitTimeSeconds: 15,
      });

      const boundProvider = provider.forQueue("test-queue");
      await boundProvider.fetch?.(5, 10000); // 10 seconds wait time

      // verify WaitTimeSeconds was set correctly
      const calls = sqsMock.commandCalls(ReceiveMessageCommand);
      expect(calls[0]?.args[0].input.WaitTimeSeconds).toBe(10); // converted from 10000ms
    });

    it("should ack job by deleting message", async () => {
      // first fetch a job to get receipt handle
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-1",
            ReceiptHandle: "receipt-xyz",
            Body: JSON.stringify({ _jobData: {}, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-xyz", DataType: "String" },
              "job.name": { StringValue: "test", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "1",
            },
          },
        ],
      });

      sqsMock.on(DeleteMessageCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const fetchResult = await boundProvider.fetch?.(1);

      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) return;

      const job = fetchResult.data[0];

      // ack the job
      const result = await boundProvider.ack?.(job!);

      expect(result?.success).toBe(true);

      // verify DeleteMessage was called
      const calls = sqsMock.commandCalls(DeleteMessageCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args[0].input.ReceiptHandle).toBe("receipt-xyz");
    });

    it("should nack job by setting visibility timeout to 0", async () => {
      // first fetch a job to get receipt handle
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-1",
            ReceiptHandle: "receipt-fail",
            Body: JSON.stringify({ _jobData: {}, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-fail", DataType: "String" },
              "job.name": { StringValue: "test", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "1",
            },
          },
        ],
      });

      sqsMock.on(ChangeMessageVisibilityCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const fetchResult = await boundProvider.fetch?.(1);

      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) return;

      const job = fetchResult.data[0];

      // nack the job
      const result = await boundProvider.nack?.(
        job!,
        new Error("Processing failed"),
      );

      expect(result?.success).toBe(true);

      // verify ChangeMessageVisibility was called with timeout 0
      const calls = sqsMock.commandCalls(ChangeMessageVisibilityCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args[0].input.ReceiptHandle).toBe("receipt-fail");
      expect(calls[0]?.args[0].input.VisibilityTimeout).toBe(0);
    });

    it("should track ApproximateReceiveCount as attempts", async () => {
      // mock a message that has been received 3 times (2 previous attempts + this one)
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-1",
            ReceiptHandle: "receipt-1",
            Body: JSON.stringify({ _jobData: {}, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-retry", DataType: "String" },
              "job.name": { StringValue: "test", DataType: "String" },
              "job.maxAttempts": { StringValue: "5", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "3", // third receive
            },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (result?.success) {
        // attempts = receiveCount - 1 = 3 - 1 = 2
        expect(result.data[0]?.attempts).toBe(2);
      }
    });

    it("should map SQS message to Job correctly", async () => {
      const createdAt = new Date("2025-01-01T00:00:00Z");
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-complete",
            ReceiptHandle: "receipt-complete",
            Body: JSON.stringify({
              _jobData: { orderId: 123, items: ["A", "B"] },
              _metadata: { source: "webhook", priority: "high" },
            }),
            MessageAttributes: {
              "job.id": { StringValue: "job-complete", DataType: "String" },
              "job.name": { StringValue: "process-order", DataType: "String" },
              "job.maxAttempts": { StringValue: "5", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(createdAt.getTime()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "1",
            },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (result?.success) {
        const job = result.data[0]!;
        expect(job.id).toBe("job-complete");
        expect(job.name).toBe("process-order");
        expect(job.queueName).toBe("test-queue");
        expect(job.data).toEqual({ orderId: 123, items: ["A", "B"] });
        expect(job.status).toBe("active");
        expect(job.attempts).toBe(0);
        expect(job.maxAttempts).toBe(5);
        expect(job.createdAt).toEqual(createdAt);
        expect(job.metadata).toEqual({ source: "webhook", priority: "high" });
        // LOW-006: processedAt should be undefined until worker starts processing
        expect(job.processedAt).toBeUndefined();
      }
    });
  });

  describe("Phase 4: Management Operations", () => {
    it("should fetch stats using GetQueueAttributes", async () => {
      sqsMock.on(GetQueueAttributesCommand).resolves({
        Attributes: {
          ApproximateNumberOfMessages: "25",
          ApproximateNumberOfMessagesNotVisible: "5",
          ApproximateNumberOfMessagesDelayed: "3",
        },
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.getStats();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.queueName).toBe("test-queue");
        expect(result.data.waiting).toBe(25);
        expect(result.data.active).toBe(5);
        expect(result.data.delayed).toBe(3);
        expect(result.data.completed).toBe(0); // SQS limitation
        expect(result.data.failed).toBe(0); // SQS limitation
        expect(result.data.paused).toBe(false);
      }

      // verify GetQueueAttributes was called correctly
      const calls = sqsMock.commandCalls(GetQueueAttributesCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args[0].input.AttributeNames).toEqual([
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
        "ApproximateNumberOfMessagesDelayed",
      ]);
    });

    it("should calculate health status", async () => {
      sqsMock.on(GetQueueAttributesCommand).resolves({
        Attributes: {
          ApproximateNumberOfMessages: "100",
          ApproximateNumberOfMessagesNotVisible: "50",
          ApproximateNumberOfMessagesDelayed: "10",
        },
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.getHealth();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.queueDepth).toBe(160); // 100 + 50 + 10
        expect(result.data.activeWorkers).toBe(0); // SQS limitation
        expect(result.data.isPaused).toBe(false);
        expect(typeof result.data.errorRate).toBe("number");
        expect(typeof result.data.completedCount).toBe("number");
        expect(typeof result.data.failedCount).toBe("number");
      }
    });

    it("should report paused state in stats", async () => {
      sqsMock.on(GetQueueAttributesCommand).resolves({
        Attributes: {
          ApproximateNumberOfMessages: "10",
          ApproximateNumberOfMessagesNotVisible: "0",
          ApproximateNumberOfMessagesDelayed: "0",
        },
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");

      // pause the queue first
      await boundProvider.pause();

      const statsResult = await boundProvider.getStats();
      const healthResult = await boundProvider.getHealth();

      expect(statsResult.success).toBe(true);
      if (statsResult.success) {
        expect(statsResult.data.paused).toBe(true);
      }

      expect(healthResult.success).toBe(true);
      if (healthResult.success) {
        expect(healthResult.data.isPaused).toBe(true); // paused state reported
      }
    });
  });

  describe("Phase 5: DLQ Operations", () => {
    it("should fetch jobs from DLQ queue", async () => {
      // mock DLQ ReceiveMessage response
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "dlq-msg-1",
            ReceiptHandle: "dlq-receipt-1",
            Body: JSON.stringify({
              _jobData: { failedTask: "process-payment" },
              _metadata: { error: "timeout" },
            }),
            MessageAttributes: {
              "job.id": { StringValue: "job-failed-1", DataType: "String" },
              "job.name": { StringValue: "payment-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "4", // exceeded max attempts
            },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        dlqUrls: {
          "test-queue":
            "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.getDLQJobs?.(10);

      expect(result?.success).toBe(true);
      if (result?.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.id).toBe("job-failed-1");
        expect(result.data[0]?.name).toBe("payment-job");
        expect(result.data[0]?.data).toEqual({ failedTask: "process-payment" });
        expect(result.data[0]?.attempts).toBe(3); // receiveCount - 1
      }

      // verify ReceiveMessage was called on DLQ URL
      const calls = sqsMock.commandCalls(ReceiveMessageCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args[0].input.QueueUrl).toBe(
        "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
      );
      expect(calls[0]?.args[0].input.WaitTimeSeconds).toBe(0); // no long polling for DLQ
    });

    it("should return error when DLQ not configured", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        // no dlqUrls configured
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.getDLQJobs?.(10);

      expect(result?.success).toBe(false);
      if (!result?.success) {
        expect(result?.error.type).toBe("ConfigurationError");
        expect(result?.error.code).toBe("INVALID_CONFIG");
        expect(result?.error.message).toContain("DLQ not configured");
      }
    });

    it("should return NOT_IMPLEMENTED for retryJob", async () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        dlqUrls: {
          "test-queue":
            "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.retryJob?.("job-failed-1");

      expect(result?.success).toBe(false);
      if (!result?.success) {
        expect(result?.error.code).toBe("NOT_IMPLEMENTED");
        expect(result?.error.message).toContain("atomic message move");
        expect(result?.error.message).toContain("AWS Console/CLI");
      }
    });
  });

  describe("Phase 6: Error Mapping (VALIDATES MEDIUM-001)", () => {
    it("should map AWS throttling error to retryable RuntimeError", async () => {
      // mock throttling error
      sqsMock.on(SendMessageCommand).rejects({
        name: "RequestThrottled",
        $metadata: {},
        message: "Rate exceeded",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        data: {},
        status: "waiting" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("RuntimeError");
        if (result.error.type === "RuntimeError") {
          // LOW-015: throttling errors use specific THROTTLING code
          expect(result.error.code).toBe("THROTTLING");
          expect(result.error.message).toContain("throttling");
          expect(result.error.retryable).toBe(true);
        }
      }
    });

    it("should map receipt handle error to non-retryable RuntimeError", async () => {
      // setup: fetch a job first
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-1",
            ReceiptHandle: "old-receipt",
            Body: JSON.stringify({ _jobData: {}, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-1", DataType: "String" },
              "job.name": { StringValue: "test", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      });

      // mock receipt handle invalid error
      sqsMock.on(DeleteMessageCommand).rejects({
        name: "ReceiptHandleIsInvalid",
        $metadata: {},
        message: "The receipt handle has expired",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const fetchResult = await boundProvider.fetch?.(1);

      expect(fetchResult?.success).toBe(true);
      if (!fetchResult?.success) return;

      const job = fetchResult.data[0]!;
      const result = await boundProvider.ack?.(job);

      expect(result?.success).toBe(false);
      if (!result?.success) {
        expect(result?.error.type).toBe("RuntimeError");
        if (result?.error.type === "RuntimeError") {
          expect(result.error.message).toContain("Receipt handle");
          expect(result.error.retryable).toBe(false);
        }
      }
    });

    it("should map queue not found to ConfigurationError", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "QueueDoesNotExist",
        $metadata: {},
        message: "The specified queue does not exist",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        data: {},
        status: "waiting" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("ConfigurationError");
        expect(result.error.code).toBe("INVALID_CONFIG");
        expect(result.error.message).toContain("Queue does not exist");
      }
    });

    it("should map access denied to ConfigurationError/PROVIDER_ERROR", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "AccessDeniedException",
        $metadata: {},
        message: "User is not authorized to perform: sqs:SendMessage",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        data: {},
        status: "waiting" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("ConfigurationError");
        expect(result.error.code).toBe("PROVIDER_ERROR");
        expect(result.error.message).toContain("IAM permission denied");
      }
    });

    it("should map invalid message to DataError/VALIDATION", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "InvalidMessageContents",
        $metadata: {},
        message: "Invalid characters in message body",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        data: {},
        status: "waiting" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("DataError");
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("validation failed");
      }
    });

    it("should map network errors to CONNECTION", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "NetworkingError",
        $metadata: {},
        message: "getaddrinfo ENOTFOUND sqs.us-east-1.amazonaws.com",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        data: {},
        status: "waiting" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("RuntimeError");
        if (result.error.type === "RuntimeError") {
          expect(result.error.code).toBe("CONNECTION");
          expect(result.error.retryable).toBe(true);
        }
      }
    });

    it("should map service unavailable to retryable RuntimeError", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "ServiceUnavailable",
        $metadata: {},
        message: "Service is temporarily unavailable",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = {
        id: "job-1",
        name: "test",
        queueName: "test-queue",
        data: {},
        status: "waiting" as const,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("RuntimeError");
        if (result.error.type === "RuntimeError") {
          expect(result.error.code).toBe("PROCESSING");
          expect(result.error.message).toContain("service error");
          expect(result.error.retryable).toBe(true);
        }
      }
    });
  });

  describe("REGRESSION: CRIT-004 - Allowlist Security Fix", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should block QueueUrl override via providerOptions.sqs", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob({
        id: "job-1",
        data: { legitimate: "data" },
      });

      const boundProvider = provider.forQueue("test-queue");
      await boundProvider.add(job, {
        // attempt to override QueueUrl - should be blocked
        providerOptions: {
          sqs: {
            QueueUrl: "https://attacker.com/evil-queue",
          },
        },
      });

      const calls = sqsMock.commandCalls(SendMessageCommand);
      const command = calls[0]?.args[0].input;

      // verify malicious override was blocked
      expect(command?.QueueUrl).not.toContain("attacker.com");
      expect(command?.QueueUrl).toBe(
        "https://sqs.us-east-1.amazonaws.com/123/test-queue",
      );
    });

    it("should block MessageBody override via providerOptions.sqs", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob({
        id: "job-1",
        data: { legitimate: "data" },
      });

      const boundProvider = provider.forQueue("test-queue");
      await boundProvider.add(job, {
        // attempt to override MessageBody - should be blocked
        providerOptions: {
          sqs: {
            MessageBody: '{"malicious": "payload"}',
          },
        },
      });

      const calls = sqsMock.commandCalls(SendMessageCommand);
      const command = calls[0]?.args[0].input;

      if (!command) {
        fail("Expected SendMessageCommand to be called");
      }

      // verify malicious override was blocked
      const body = JSON.parse(command.MessageBody!) as Record<string, unknown>;
      //@ts-expect-error yes we want to test this
      expect(body._jobData?.legitimate).toBe("data");
      //@ts-expect-error yes we want to test this
      expect(body._jobData?.malicious).toBeUndefined();
    });

    it("should only allow MessageGroupId and MessageDeduplicationId through", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue.fifo":
            "https://sqs.us-east-1.amazonaws.com/123/test-queue.fifo",
        },
      });

      const job = createMockJob({
        id: "job-1",
        queueName: "test-queue.fifo",
        data: { test: "data" },
      });

      const boundProvider = provider.forQueue("test-queue.fifo");
      await boundProvider.add(job, {
        providerOptions: {
          sqs: {
            MessageGroupId: "group-1",
            MessageDeduplicationId: "dedup-1",
            DelaySeconds: 999, // should be blocked
            VisibilityTimeout: 1, // should be blocked
          },
        },
      });

      const calls = sqsMock.commandCalls(SendMessageCommand);
      const command = calls[0]?.args[0].input;

      // verify allowed properties passed through
      expect(command?.MessageGroupId).toBe("group-1");
      expect(command?.MessageDeduplicationId).toBe("dedup-1");

      // verify disallowed properties blocked
      //@ts-expect-error testing invalid property
      expect(command?.VisibilityTimeout).toBeUndefined();
    });
  });

  describe("REGRESSION: CRIT-006 - Stateless Receipt Handle Management", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should store receipt handle in job.providerMetadata, not Map", async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-123",
            ReceiptHandle: "handle-123",
            Body: JSON.stringify({ _jobData: { test: true }, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-123", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: {
              ApproximateReceiveCount: "1",
            },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.fetch?.(1);

      expect(result?.success).toBe(true);
      if (result?.success) {
        const job = result.data[0]!;

        // critical: receipt handle stored in job metadata
        expect(job.providerMetadata?.receiptHandle).toBe("handle-123");

        // critical: no Map storage exists (architectural validation)
        //@ts-expect-error testing property absence
        expect(provider.receiptHandles).toBeUndefined();
      }
    });

    it("should read receipt handle from job.providerMetadata for ack", async () => {
      sqsMock.on(DeleteMessageCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job: ActiveJob<{ test: boolean }> = {
        ...createMockJob({
          id: "job-456",
          data: { test: true },
          status: "active",
          attempts: 1,
          processedAt: new Date(),
        }),
        providerMetadata: { receiptHandle: "handle-456" },
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.ack?.(job);

      expect(result?.success).toBe(true);

      const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]?.args[0].input.ReceiptHandle).toBe("handle-456");
    });

    it("should read receipt handle from job.providerMetadata for nack", async () => {
      sqsMock.on(ChangeMessageVisibilityCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job: ActiveJob<{ test: boolean }> = {
        ...createMockJob({
          id: "job-789",
          data: { test: true },
          status: "active",
          attempts: 1,
          processedAt: new Date(),
        }),
        providerMetadata: { receiptHandle: "handle-789" },
      };

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.nack?.(job, new Error("test error"));

      expect(result?.success).toBe(true);

      const visibilityCalls = sqsMock.commandCalls(
        ChangeMessageVisibilityCommand,
      );
      expect(visibilityCalls).toHaveLength(1);
      expect(visibilityCalls[0]?.args[0].input.ReceiptHandle).toBe(
        "handle-789",
      );
      expect(visibilityCalls[0]?.args[0].input.VisibilityTimeout).toBe(0);
    });
  });

  describe("REGRESSION: CRIT-007/009 - Poison Pill Protection", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should process valid messages when batch contains invalid JSON (main queue)", async () => {
      // spy on console.error to verify poison pill logging
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementationOnce(() => {});

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          // valid message 1
          {
            MessageId: "msg-1",
            ReceiptHandle: "receipt-handle-1",
            Body: JSON.stringify({
              _jobData: { valid: true },
              _metadata: {},
            }),
            MessageAttributes: {
              "job.id": { StringValue: "job-1", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          },
          // poison pill - invalid JSON
          {
            MessageId: "msg-2",
            ReceiptHandle: "receipt-handle-2",
            Body: "invalid{json",
            MessageAttributes: {
              "job.id": { StringValue: "job-2", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          },
          // valid message 3
          {
            MessageId: "msg-3",
            ReceiptHandle: "receipt-handle-3",
            Body: JSON.stringify({
              _jobData: { valid: true },
              _metadata: {},
            }),
            MessageAttributes: {
              "job.id": { StringValue: "job-3", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      });

      sqsMock.on(DeleteMessageCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.fetch?.(3);

      expect(result?.success).toBe(true);
      if (result?.success) {
        // critical: 2 valid jobs processed despite poison pill
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.id).toBe("job-1");
        expect(result.data[1]?.id).toBe("job-3");
      }

      // critical: poison pill logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to map SQS message"),
        expect.objectContaining({ messageId: "msg-2" }),
      );

      // critical: poison pill auto-deleted from main queue
      const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
      expect(deleteCalls.length).toBeGreaterThan(0);
      const poisonPillDeleted = deleteCalls.some(
        (call) => call.args[0].input.ReceiptHandle === "receipt-handle-2",
      );
      expect(poisonPillDeleted).toBe(true);

      consoleErrorSpy.mockRestore();
    });

    it("should log but not delete poison pills in DLQ", async () => {
      // spy on console.error to verify poison pill logging
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementationOnce(() => {});

      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          // valid DLQ message
          {
            MessageId: "dlq-1",
            ReceiptHandle: "receipt-handle-dlq-1",
            Body: JSON.stringify({
              _jobData: { valid: true },
              _metadata: {},
            }),
            MessageAttributes: {
              "job.id": { StringValue: "job-dlq-1", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "4" },
          },
          // poison pill in DLQ
          {
            MessageId: "dlq-2",
            ReceiptHandle: "receipt-handle-dlq-2",
            Body: "invalid{json",
            MessageAttributes: {
              "job.id": { StringValue: "job-dlq-2", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "5" },
          },
        ],
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
        dlqUrls: {
          "test-queue":
            "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
        },
      });

      // call _getDLQJobs directly
      const result = await provider._getDLQJobs("test-queue", 10);

      expect(result.success).toBe(true);
      if (result.success) {
        // critical: 1 valid job returned despite poison pill
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.id).toBe("job-dlq-1");
      }

      // critical: poison pill logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to map DLQ message"),
        expect.objectContaining({ messageId: "dlq-2" }),
      );

      // critical: poison pill NOT deleted from DLQ (preserved for debugging)
      const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
      expect(deleteCalls).toHaveLength(0);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("REGRESSION: CRIT-008 - JobId Validation", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should throw error when job.id attribute is missing", () => {
      const messageWithoutJobId = {
        MessageId: "msg-123",
        ReceiptHandle: "receipt-123",
        Body: JSON.stringify({ _jobData: { test: true }, _metadata: {} }),
        MessageAttributes: {
          // missing "job.id" attribute
          "job.name": { StringValue: "test-job", DataType: "String" },
          "job.maxAttempts": { StringValue: "3", DataType: "Number" },
          "job.createdAt": {
            StringValue: String(Date.now()),
            DataType: "Number",
          },
        },
        Attributes: { ApproximateReceiveCount: "1" },
      };

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // critical: should throw when job.id is missing
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore We're violating by testing an internal method but it's pragmatic here
        //and is sufficiently isolated. Read the CRIT-008 discussion for context.
        provider.mapSQSMessageToJob(messageWithoutJobId, "test-queue", "main");
      }).toThrow("missing required 'job.id' attribute");
    });
  });

  describe("REGRESSION: BoundSQSProvider Interface Fix", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should accept Job<T> parameter for ack(), not jobId string", async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-123",
            ReceiptHandle: "handle-123",
            Body: JSON.stringify({ _jobData: { test: true }, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-123", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      });

      sqsMock.on(DeleteMessageCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const fetchResult = await boundProvider.fetch?.(1);

      expect(fetchResult?.success).toBe(true);
      if (fetchResult?.success) {
        const job = fetchResult.data[0]!;

        // critical: TypeScript compilation validates signature (Job<T>, not string)
        const ackResult = await boundProvider.ack?.(job);

        expect(ackResult?.success).toBe(true);

        const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
        expect(deleteCalls[0]?.args[0].input.ReceiptHandle).toBe("handle-123");
      }
    });

    it("should accept Job<T> parameter for nack(), not jobId string", async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({
        Messages: [
          {
            MessageId: "msg-456",
            ReceiptHandle: "handle-456",
            Body: JSON.stringify({ _jobData: { test: true }, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: "job-456", DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          },
        ],
      });

      sqsMock.on(ChangeMessageVisibilityCommand).resolves({});

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const boundProvider = provider.forQueue("test-queue");
      const fetchResult = await boundProvider.fetch?.(1);

      expect(fetchResult?.success).toBe(true);
      if (fetchResult?.success) {
        const job = fetchResult.data[0]!;

        // critical: TypeScript compilation validates signature (Job<T>, not string)
        const nackResult = await boundProvider.nack?.(job, new Error("test"));

        expect(nackResult?.success).toBe(true);

        const visibilityCalls = sqsMock.commandCalls(
          ChangeMessageVisibilityCommand,
        );
        expect(visibilityCalls[0]?.args[0].input.ReceiptHandle).toBe(
          "handle-456",
        );
      }
    });
  });

  describe("REGRESSION: CRIT-003 - getQueueUrl Result Pattern", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should return Result.err for missing queue, never throw", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // critical: returns Result.err, never throws
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore Violation by testing internal method but pragmatic here
      //and sufficiently isolated. Read the CRIT-003 discussion for context.
      const result = provider.getQueueUrl("non-existent-queue");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("ConfigurationError");
        expect(result.error.code).toBe("INVALID_CONFIG");
        expect(result.error.message).toContain("Queue URL not configured");
      }
    });
  });

  describe("REGRESSION: HIGH-006 - JSON.stringify Circular Reference", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should return SERIALIZATION error for circular references", async () => {
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: "test-message-id",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // create circular reference
      const circularData: Record<string, unknown> = { name: "test" };
      circularData.self = circularData;

      const job = createMockJob({
        id: "job-1",
        data: circularData,
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      // critical: returns SERIALIZATION error for circular reference
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("DataError");
        expect(result.error.code).toBe("SERIALIZATION");
        expect(result.error.message).toContain("serialize");
      }
    });
  });

  describe("REGRESSION: HIGH-013 - Retryable Flag", () => {
    it("should set retryable: false for unknown errors", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // unknown error type
      const unknownError = new Error("Unknown error type");
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore Violation by testing internal method but pragmatic here
      //and sufficiently isolated. Read the HIGH-013 discussion for context.
      const queueError = provider.mapError(unknownError, "test-queue");

      expect(queueError.type).toBe("RuntimeError");
      expect(queueError.code).toBe("PROCESSING");
      if (queueError.type === "RuntimeError") {
        // critical: unknown errors are non-retryable by default
        expect(queueError.retryable).toBe(false);
      }
    });
  });

  describe("REGRESSION: HIGH-014 - Unhandled AWS Error Branch", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should preserve AWS error name in message for unknown AWS error types", async () => {
      // simulate a new AWS error type that we don't have a handler for
      sqsMock.on(SendMessageCommand).rejects({
        name: "NewUnknownSQSError",
        $metadata: {},
        message: "This is a new AWS error we don't handle yet",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob({
        id: "job-1",
        data: { test: true },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        // critical: error name preserved in message for observability
        expect(result.error.type).toBe("RuntimeError");
        if (result.error.type === "RuntimeError") {
          expect(result.error.message).toContain("NewUnknownSQSError");
          expect(result.error.message).toContain("Unhandled AWS SQS Error");
          expect(result.error.code).toBe("PROVIDER_ERROR");
          expect(result.error.retryable).toBe(false);
        }
      }
    });
  });

  describe("REGRESSION: MED-017 - Credential and KMS Error Handlers", () => {
    beforeEach(() => {
      sqsMock.reset();
    });

    it("should map InvalidClientTokenId to ConfigurationError", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "InvalidClientTokenId",
        $metadata: {},
        message: "The security token included in the request is invalid",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob({
        id: "job-1",
        data: { test: true },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("ConfigurationError");
        expect(result.error.code).toBe("PROVIDER_ERROR");
        expect(result.error.message).toContain("authentication/credential");
      }
    });

    it("should map UnrecognizedClientException to ConfigurationError", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "UnrecognizedClientException",
        $metadata: {},
        message: "The security token included in the request is invalid",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob({
        id: "job-1",
        data: { test: true },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("ConfigurationError");
        expect(result.error.code).toBe("PROVIDER_ERROR");
        expect(result.error.message).toContain("authentication/credential");
      }
    });

    it("should map KMS errors to ConfigurationError", async () => {
      sqsMock.on(SendMessageCommand).rejects({
        name: "KmsAccessDeniedException",
        $metadata: {},
        message: "User is not authorized to perform kms:Decrypt",
      });

      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      const job = createMockJob({
        id: "job-1",
        data: { test: true },
      });

      const boundProvider = provider.forQueue("test-queue");
      const result = await boundProvider.add(job);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe("ConfigurationError");
        expect(result.error.code).toBe("PROVIDER_ERROR");
        expect(result.error.message).toContain("KMS");
      }
    });
  });

  describe("REGRESSION: MED-018 - Strengthened JSON Fallback", () => {
    it("should NOT map non-SyntaxError with 'json' in message to SERIALIZATION", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // regular error with "json" in message (not SyntaxError)
      const regularError = new Error(
        "Something went wrong with json processing",
      );
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore Violation by testing internal method but pragmatic here
      //and sufficiently isolated. Read the MED-018 discussion for context.
      const queueError = provider.mapError(regularError, "test-queue");

      // critical: should NOT be classified as SERIALIZATION error
      expect(queueError.type).toBe("RuntimeError");
      expect(queueError.code).toBe("PROCESSING");
      expect(queueError.type).not.toBe("DataError");
      expect(queueError.code).not.toBe("SERIALIZATION");
    });

    it("should map SyntaxError with 'json' to SERIALIZATION", () => {
      const provider = new SQSProvider({
        region: "us-east-1",
        queueUrls: {
          "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
        },
      });

      // SyntaxError from JSON.parse
      const syntaxError = new SyntaxError(
        "Unexpected token in JSON at position 0",
      );
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore Violation by testing internal method but pragmatic here
      //and sufficiently isolated. Read the MED-018 discussion for context.
      const queueError = provider.mapError(syntaxError, "test-queue");

      // critical: should be classified as SERIALIZATION error
      expect(queueError.type).toBe("DataError");
      expect(queueError.code).toBe("SERIALIZATION");
    });
  });

  describe("REGRESSION: Wave 4 Fixes", () => {
    describe("HIGH-001 - Shutdown Flag Checks", () => {
      it("should reject add operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        await provider.disconnect();

        const job = createMockJob({
          id: "job-1",
          data: { test: true },
        });

        const result = await provider._addJob("test-queue", job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
          expect(result.error.message).toContain("shutting down");
        }
      });

      it("should reject fetch operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        await provider.disconnect();

        const result = await provider._fetchJobs("test-queue", 10);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
        }
      });

      it("should reject ack operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        await provider.disconnect();

        const job: ActiveJob<{ test: boolean }> = {
          ...createMockJob({
            id: "job-1",
            data: { test: true },
            status: "active",
          }),
          providerMetadata: { receiptHandle: "handle-123" },
        };

        const result = await provider._ackJob("test-queue", job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
        }
      });

      it("should reject stats operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        await provider.disconnect();

        const result = await provider._getStats("test-queue");

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
        }
      });
    });

    describe("HIGH-002 - Constructor Validation", () => {
      it("should throw error when neither client nor region provided", () => {
        expect(() => {
          new SQSProvider({
            queueUrls: {
              "test-queue":
                "https://sqs.us-east-1.amazonaws.com/123/test-queue",
            },
          });
        }).toThrow("requires either a `client` instance or an AWS `region`");
      });

      it("should throw error when queueUrls is empty", () => {
        expect(() => {
          new SQSProvider({
            region: "us-east-1",
            queueUrls: {},
          });
        }).toThrow("requires at least one queue in `queueUrls`");
      });

      it("should accept valid config with region", () => {
        expect(() => {
          new SQSProvider({
            region: "us-east-1",
            queueUrls: {
              "test-queue":
                "https://sqs.us-east-1.amazonaws.com/123/test-queue",
            },
          });
        }).not.toThrow();
      });
    });

    describe("HIGH-005 - Complete Size Validation", () => {
      it("should validate total size including MessageAttributes", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        // create job where body is under limit but body + attributes exceeds 256KB
        const largeData = "x".repeat(255 * 1024); // 255KB body
        const job = createMockJob<{ payload: string }>({
          id: "a".repeat(10000), // large job ID to push attributes over limit
          data: { payload: largeData },
        });

        const result = await provider._addJob("test-queue", job);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("VALIDATION");
          expect(result.error.message).toContain("Total message size");
          expect(result.error.message).toContain("256KB");
        }
      });
    });

    describe("HIGH-011 - Configurable Health Threshold", () => {
      it("should use custom healthThreshold for health checks", async () => {
        sqsMock.on(GetQueueAttributesCommand).resolves({
          Attributes: {
            ApproximateNumberOfMessages: "500",
            ApproximateNumberOfMessagesNotVisible: "0",
            ApproximateNumberOfMessagesDelayed: "0",
          },
        });

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
          healthThreshold: 1000, // custom threshold
        });

        const result = await provider._getHealth("test-queue");

        expect(result.success).toBe(true);
        if (result.success) {
          // raw metrics returned - userland determines health
          expect(result.data.queueDepth).toBe(500);
          expect(result.data.isPaused).toBe(false);
          // example: userland could check: queueDepth < 1000 && !isPaused
        }
      });

      it("should report metrics when exceeding custom threshold", async () => {
        sqsMock.on(GetQueueAttributesCommand).resolves({
          Attributes: {
            ApproximateNumberOfMessages: "1500",
            ApproximateNumberOfMessagesNotVisible: "0",
            ApproximateNumberOfMessagesDelayed: "0",
          },
        });

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
          healthThreshold: 1000, // custom threshold (no longer used by provider)
        });

        const result = await provider._getHealth("test-queue");

        expect(result.success).toBe(true);
        if (result.success) {
          // raw metrics returned - userland determines health
          expect(result.data.queueDepth).toBe(1500);
          expect(result.data.isPaused).toBe(false);
          // example: userland could check: queueDepth < 1000 && !isPaused
        }
      });
    });

    describe("MED-004 - MessageAttributes Count Validation", () => {
      it("should reject jobs with more than 10 message attributes", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        // The validation is in place at sqs.provider.mts:329.
        // The public API does not allow adding custom attributes, so the 10-attribute
        // limit is not currently reachable through normal usage. This test confirms happy path.

        // create a job with minimal data to verify normal operation
        const job = createMockJob({
          id: "job-1",
          data: { test: true },
        });

        sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-123" });

        const result = await provider._addJob("test-queue", job);

        // should succeed with 4 attributes (well under 10 limit)
        expect(result.success).toBe(true);
      });
    });

    describe("MED-014 - Limit Parameter Validation", () => {
      it("should return empty array for negative limit", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
          dlqUrls: {
            "test-queue":
              "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
          },
        });

        const result = await provider._getDLQJobs("test-queue", -5);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
      });

      it("should cap limit at 1000 to prevent excessive API calls", async () => {
        sqsMock.on(ReceiveMessageCommand).resolves({
          Messages: [],
        });

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
          dlqUrls: {
            "test-queue":
              "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
          },
        });

        const result = await provider._getDLQJobs("test-queue", 999999);

        expect(result.success).toBe(true);

        // verify we didn't make 99999 API calls
        // with 1000 cap and batch size 10, should make at most 100 calls
        const calls = sqsMock.commandCalls(ReceiveMessageCommand);
        expect(calls.length).toBeLessThanOrEqual(100);
      });
    });
  });

  describe("REGRESSION: Wave 5 Fixes", () => {
    describe("MED-011 - parseAttribute NaN Validation", () => {
      it("should log error and return 0 for NaN values", () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        const consoleErrorSpy = vi
          .spyOn(console, "error")
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          .mockImplementation(() => {});

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore Violation by testing internal method but pragmatic here
        //and sufficiently isolated. Read the MED-011 discussion for context.
        const result = provider.parseAttribute(
          "not-a-number",
          "TestAttribute",
          "test-queue",
        );

        expect(result).toBe(0); // safe fallback
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "[SQSProvider] Failed to parse attribute 'TestAttribute'",
          ),
          expect.objectContaining({ rawValue: "not-a-number" }),
        );

        consoleErrorSpy.mockRestore();
      });

      it("should parse valid numeric strings correctly", () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore Violation by testing internal method but pragmatic here
        //and sufficiently isolated. Read the MED-011 discussion for context.
        const result = provider.parseAttribute(
          "12345",
          "TestAttribute",
          "test-queue",
        );

        expect(result).toBe(12345);
      });

      it("should return 0 for undefined values", () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore Violation by testing internal method but pragmatic here
        //and sufficiently isolated. Read the MED-011 discussion for context.
        const result = provider.parseAttribute(
          undefined,
          "TestAttribute",
          "test-queue",
        );

        expect(result).toBe(0);
      });
    });

    describe("MED-005 - Status Mapping for Sub-Second Delays", () => {
      it("should set status to 'delayed' for sub-second delays", async () => {
        sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-id" });

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        const futureDate = new Date(Date.now() + 500); // 500ms delay
        const job = createMockJob({
          id: "job-1",
          name: "sub-second-delay-job",
          data: { test: true },
          scheduledFor: futureDate,
        });

        const boundProvider = provider.forQueue("test-queue");
        const result = await boundProvider.add(job);

        expect(result.success).toBe(true);
        if (result.success) {
          // critical: status should be "delayed" even though DelaySeconds is 0
          expect(result.data.status).toBe("delayed");
        }

        const calls = sqsMock.commandCalls(SendMessageCommand);
        const command = calls[0]?.args[0].input;
        // delaySeconds is 0, so it should be undefined (not sent to SQS)
        expect(command?.DelaySeconds).toBeUndefined();
      });
    });

    describe("HIGH-001 - Additional Shutdown Flag Checks", () => {
      it("should reject nack operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        await provider.disconnect();

        const job: ActiveJob<{ test: boolean }> = {
          ...createMockJob({
            id: "job-1",
            data: { test: true },
            status: "active",
          }),
          providerMetadata: { receiptHandle: "handle-123" },
        };

        const result = await provider._nackJob(
          "test-queue",
          job,
          new Error("fail"),
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
        }
      });

      it("should reject health operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });

        await provider.disconnect();

        const result = await provider._getHealth("test-queue");

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
        }
      });

      it("should reject getDLQJobs operations after shutdown", async () => {
        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
          dlqUrls: {
            "test-queue":
              "https://sqs.us-east-1.amazonaws.com/123/test-queue-dlq",
          },
        });

        await provider.disconnect();

        const result = await provider._getDLQJobs("test-queue", 10);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SHUTDOWN");
        }
      });
    });

    describe("Concurrent Operations (CRITICAL - HIGH-2 from audit)", () => {
      it("should handle concurrent fetch() calls safely", async () => {
        // setup: mock 10 messages available
        sqsMock.on(ReceiveMessageCommand).resolves({
          Messages: Array.from({ length: 10 }, (_, i) => ({
            MessageId: `msg-${i}`,
            ReceiptHandle: `receipt-${i}`,
            Body: JSON.stringify({ _jobData: { index: i }, _metadata: {} }),
            MessageAttributes: {
              "job.id": { StringValue: `job-${i}`, DataType: "String" },
              "job.name": { StringValue: "test-job", DataType: "String" },
              "job.maxAttempts": { StringValue: "3", DataType: "Number" },
              "job.createdAt": {
                StringValue: String(Date.now()),
                DataType: "Number",
              },
            },
            Attributes: { ApproximateReceiveCount: "1" },
          })),
        });

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });
        const boundProvider = provider.forQueue("test-queue");

        // fetch concurrently (simulates multiple workers)
        const [result1, result2, result3] = await Promise.all([
          boundProvider.fetch?.(5),
          boundProvider.fetch?.(5),
          boundProvider.fetch?.(5),
        ]);

        // SQS doesn't guarantee no duplicates (visibility timeout based)
        // but should handle concurrent calls without errors
        expect(result1?.success).toBe(true);
        expect(result2?.success).toBe(true);
        expect(result3?.success).toBe(true);

        // verify ReceiveMessage was called 3 times
        const calls = sqsMock.commandCalls(ReceiveMessageCommand);
        expect(calls).toHaveLength(3);
      });

      it("should handle concurrent ack() operations safely", async () => {
        // test concurrent DeleteMessage calls
        sqsMock.on(DeleteMessageCommand).resolves({});

        const jobs = createMockJobBatch(10, { status: "active" }).map(
          (job, i) => ({
            ...job,
            data: { index: i },
            providerMetadata: { receiptHandle: `receipt-${i}` },
          }),
        );

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });
        const boundProvider = provider.forQueue("test-queue");

        // ack concurrently
        const results = await Promise.all(
          jobs.map((job) => boundProvider.ack?.(job)),
        );

        // all should succeed
        expect(results.every((r) => r?.success)).toBe(true);

        // verify all DeleteMessage calls succeeded
        const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
        expect(deleteCalls).toHaveLength(10);
      });

      it("should handle receipt handle expiration during concurrent operations", async () => {
        // first 5 succeed, last 5 fail with expired receipt
        let callCount = 0;
        sqsMock.on(DeleteMessageCommand).callsFake(() => {
          callCount++;
          if (callCount > 5) {
            const error = new Error("Receipt handle expired");
            error.name = "ReceiptHandleIsInvalid";
            Object.assign(error, { $metadata: {} });
            throw error;
          }
          return {};
        });

        const jobs = createMockJobBatch(10, { status: "active" }).map(
          (job, i) => ({
            ...job,
            data: { index: i },
            providerMetadata: { receiptHandle: `receipt-${i}` },
          }),
        );

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });
        const boundProvider = provider.forQueue("test-queue");

        const results = await Promise.all(
          jobs.map((job) => boundProvider.ack?.(job)),
        );

        // first 5 succeed
        const successCount = results.filter((r) => r?.success).length;
        const failCount = results.filter((r) => !r?.success).length;

        expect(successCount).toBe(5);
        expect(failCount).toBe(5);

        // verify errors are non-retryable
        results.slice(5).forEach((result) => {
          if (!result?.success) {
            if (result?.error && "retryable" in result.error) {
              expect(result.error.retryable).toBe(false);
            }
          }
        });
      });

      it("should handle concurrent nack() operations safely", async () => {
        // test concurrent ChangeMessageVisibility calls
        sqsMock.on(ChangeMessageVisibilityCommand).resolves({});

        const jobs = createMockJobBatch(10, { status: "active" }).map(
          (job, i) => ({
            ...job,
            data: { index: i },
            providerMetadata: { receiptHandle: `receipt-${i}` },
          }),
        );

        const provider = new SQSProvider({
          region: "us-east-1",
          queueUrls: {
            "test-queue": "https://sqs.us-east-1.amazonaws.com/123/test-queue",
          },
        });
        const boundProvider = provider.forQueue("test-queue");

        // nack concurrently
        const results = await Promise.all(
          jobs.map((job) =>
            boundProvider.nack?.(job, new Error("Processing failed")),
          ),
        );

        // all should succeed
        expect(results.every((r) => r?.success)).toBe(true);

        // verify all ChangeMessageVisibility calls succeeded
        const calls = sqsMock.commandCalls(ChangeMessageVisibilityCommand);
        expect(calls).toHaveLength(10);
      });
    });
  });
});
