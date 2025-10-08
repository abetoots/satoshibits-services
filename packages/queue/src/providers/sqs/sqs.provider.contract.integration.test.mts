/**
 * SQS Provider Contract Tests (Integration)
 *
 * These tests validate that SQSProvider correctly implements the IQueueProvider
 * interface contract. Unlike unit tests, these run against REAL AWS SQS (via LocalStack).
 *
 * Prerequisites:
 * - LocalStack must be running on localhost:4566
 * - Run via: pnpm test:integration
 * - CI: docker-compose.test.yml provides LocalStack container
 *
 * Purpose:
 * - Ensures SQSProvider behavior matches contract expectations
 * - Validates consistency with BullMQ and Memory providers
 * - Catches provider-specific bugs that mocks would miss
 */

import {
  CreateQueueCommand,
  ListQueuesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe } from "vitest";

import { createProviderContractTests } from "../__shared__/provider-contract.suite.mjs";
import { SQSProvider } from "./sqs.provider.mjs";

let sqsClient: SQSClient;
const createdQueueUrls: string[] = [];

// setup: create SQS client for LocalStack and wait for it to be ready
beforeAll(async () => {
  const endpoint = process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566";
  sqsClient = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint,
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  });

  // warmup: poll LocalStack until SQS is ready
  let isReady = false;
  for (let i = 0; i < 10; i++) {
    try {
      await sqsClient.send(new ListQueuesCommand({}));
      isReady = true;
      break;
    } catch {
      // wait 500ms before retrying
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!isReady) {
    throw new Error("LocalStack SQS did not become ready in time.");
  }
}, 15000); // increase timeout for beforeAll to allow for warmup

// cleanup: delete all created queues
// eslint-disable-next-line @typescript-eslint/require-await
afterAll(async () => {
  // note: LocalStack cleans up automatically on container restart
  // but this helps if running multiple test suites
  if (sqsClient) {
    sqsClient.destroy();
  }
});

// helper: create a test queue in LocalStack
async function createTestQueue(queueName: string): Promise<string> {
  const result = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        // explicitly set DelaySeconds to 0 to ensure message-level
        // delays are not affected by queue-level defaults
        DelaySeconds: "0",
      },
    }),
  );

  const queueUrl = result.QueueUrl!;
  createdQueueUrls.push(queueUrl);
  return queueUrl;
}

// run shared contract tests against real SQS (LocalStack)
describe("SQSProvider - Contract Compliance (Integration)", () => {
  createProviderContractTests(
    async () => {
      // create a unique queue for each test
      const queueName = `test-queue-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const queueUrl = await createTestQueue(queueName);

      const endpoint =
        process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566";
      const provider = new SQSProvider({
        region: process.env.AWS_REGION ?? "us-east-1",
        endpoint,
        credentials: {
          accessKeyId: "test",
          secretAccessKey: "test",
        },
        queueUrls: {
          [queueName]: queueUrl,
        },
      });

      return provider.forQueue(queueName);
    },
    {
      providerName: "SQSProvider",
      supportsConcurrentFetch: true,
      supportsGetJob: false, // SQS doesn't support getJob by ID
      supportsDLQ: false, // DLQ requires separate queue setup
      supportsDelayedJobs: true, // SQS supports DelaySeconds (up to 15 minutes)
      supportsDelete: false, // SQS delete requires AWS Console/CLI for safety
      ackNackTakesJob: true, // SQS takes full Job<T> object
    },
  );
});
