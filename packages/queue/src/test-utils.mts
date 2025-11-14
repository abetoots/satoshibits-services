/**
 * Test Utilities for @satoshibits/queue
 *
 * Provides helper functions for creating mock objects and providers
 * Used across test files to reduce duplication and improve consistency
 */

import { Result } from "@satoshibits/functional";
import { vi } from "vitest";

import type {
  HealthStatus,
  Job,
  JobOptions,
  ProviderCapabilities,
  QueueStats,
} from "./core/types.mjs";
import type { IQueueProvider } from "./providers/provider.interface.mjs";

/**
 * Create a test job with sensible defaults
 *
 * @param overrides - Partial job properties to override defaults
 * @returns Complete job object
 *
 * @example
 * ```typescript
 * const job = createMockJob({ id: 'job-1', data: { value: 42 } });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockJob<T = any>(
  overrides: Partial<Job<T>> = {},
): Job<T> {
  const now = new Date();

  return {
    id: "test-job-id",
    name: "test-job",
    queueName: "test-queue",
    data: {} as T,
    status: "waiting",
    attempts: 0,
    maxAttempts: 3,
    createdAt: now,
    processedAt: undefined,
    completedAt: undefined,
    failedAt: undefined,
    scheduledFor: undefined,
    priority: 0,
    metadata: {},
    ...overrides,
  };
}

/**
 * Create mock provider capabilities with sensible defaults
 *
 * @param overrides - Partial capabilities to override defaults
 * @returns Complete capabilities object
 *
 * @example
 * ```typescript
 * const caps = createMockCapabilities({ supportsPriority: false });
 * ```
 */
export function createMockCapabilities(
  overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
  return {
    supportsDelayedJobs: true,
    supportsPriority: true,
    supportsRetries: true,
    supportsDLQ: true,
    supportsBatching: true,
    supportsLongPolling: false,
    maxJobSize: 0,
    maxBatchSize: 0,
    maxDelaySeconds: 0,
    ...overrides,
  };
}

/**
 * Create mock queue statistics with sensible defaults
 *
 * @param overrides - Partial stats to override defaults
 * @returns Complete stats object
 *
 * @example
 * ```typescript
 * const stats = createMockStats({ waiting: 10, active: 2 });
 * ```
 */
export function createMockStats(
  overrides: Partial<QueueStats> = {},
): QueueStats {
  return {
    queueName: "test-queue",
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: false,
    ...overrides,
  };
}

/**
 * Create mock health status with sensible defaults
 *
 * @param overrides - Partial health status to override defaults
 * @returns Complete health status object
 *
 * @example
 * ```typescript
 * const health = createMockHealth({ errorRate: 50, isPaused: true });
 * ```
 */
export function createMockHealth(
  overrides: Partial<HealthStatus> = {},
): HealthStatus {
  return {
    activeWorkers: 0,
    queueDepth: 0,
    errorRate: 0,
    completedCount: 0,
    failedCount: 0,
    isPaused: false,
    ...overrides,
  };
}

/**
 * Create a fully mocked IQueueProvider for testing
 *
 * All methods return successful Results by default
 * Individual methods can be overridden or customized via options
 *
 * @param options - Configuration for mock behavior
 * @returns Mocked provider with vi.fn() stubs
 *
 * @example
 * ```typescript
 * // Basic mock
 * const provider = createMockProvider();
 *
 * // Custom capabilities
 * const provider = createMockProvider({
 *   capabilities: { supportsPriority: false }
 * });
 *
 * // Custom behavior
 * const provider = createMockProvider({
 *   fetch: vi.fn().mockResolvedValue(Result.ok([job1, job2]))
 * });
 * ```
 */
export function createMockProvider(
  options: {
    capabilities?: Partial<ProviderCapabilities>;
    queueName?: string;
    methods?: Partial<IQueueProvider>;
  } = {},
): IQueueProvider {
  const queueName = options.queueName ?? "test-queue";
  const capabilities = createMockCapabilities(options.capabilities);

  const defaultProvider: IQueueProvider = {
    capabilities,

    // lifecycle
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),

    // core operations
    add: vi.fn().mockImplementation((job) => Promise.resolve(Result.ok(job))),

    fetch: vi.fn().mockResolvedValue(Result.ok([])),

    ack: vi.fn().mockResolvedValue(Result.ok(undefined)),

    nack: vi.fn().mockResolvedValue(Result.ok(undefined)),

    // optional operations
    getJob: vi.fn().mockResolvedValue(Result.ok(null)),

    pause: vi.fn().mockResolvedValue(Result.ok(undefined)),

    resume: vi.fn().mockResolvedValue(Result.ok(undefined)),

    delete: vi.fn().mockResolvedValue(Result.ok(undefined)),

    // monitoring
    getStats: vi
      .fn()
      .mockResolvedValue(Result.ok(createMockStats({ queueName }))),

    getHealth: vi.fn().mockResolvedValue(Result.ok(createMockHealth())),

    // optional features (initially undefined)
    getDLQJobs: undefined,
    retryJob: undefined,
    process: undefined,
  };

  // merge with custom methods
  return {
    ...defaultProvider,
    ...options.methods,
  };
}

/**
 * Create job options with sensible defaults
 *
 * @param overrides - Partial options to override defaults
 * @returns Complete job options object
 *
 * @example
 * ```typescript
 * const options = createMockJobOptions({ attempts: 5, priority: 10 });
 * ```
 */
export function createMockJobOptions(
  overrides: Partial<JobOptions> = {},
): JobOptions {
  return {
    jobId: undefined,
    attempts: 3,
    delay: undefined,
    priority: 0,
    removeOnComplete: undefined,
    removeOnFail: undefined,
    metadata: {},
    ...overrides,
  };
}

/**
 * Create a mock provider that simulates realistic fetch behavior
 *
 * Useful for testing concurrency, batching, and job processing
 * Respects the requested count parameter
 *
 * @param jobs - Array of jobs to return from fetch
 * @param options - Configuration for fetch behavior
 * @returns Mocked provider with realistic fetch implementation
 *
 * @example
 * ```typescript
 * const jobs = [job1, job2, job3];
 * const provider = createMockProviderWithJobs(jobs, {
 *   respectCount: true // will only return requested number of jobs
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockProviderWithJobs<T = any>(
  jobs: Job<T>[],
  options: {
    capabilities?: Partial<ProviderCapabilities>;
    respectCount?: boolean;
    queueName?: string;
  } = {},
): IQueueProvider {
  const remainingJobs = [...jobs];
  const respectCount = options.respectCount ?? true;

  return createMockProvider({
    capabilities: options.capabilities,
    queueName: options.queueName,
    methods: {
      fetch: vi.fn().mockImplementation((count: number) => {
        if (respectCount) {
          const jobsToReturn = remainingJobs.splice(0, count);
          return Promise.resolve(Result.ok(jobsToReturn));
        } else {
          const jobsToReturn = [...remainingJobs];
          remainingJobs.length = 0;
          return Promise.resolve(Result.ok(jobsToReturn));
        }
      }),
    },
  });
}

/**
 * Create a mock provider that supports DLQ operations
 *
 * @param dlqJobs - Array of jobs in the DLQ
 * @param options - Configuration for DLQ behavior
 * @returns Mocked provider with DLQ support
 *
 * @example
 * ```typescript
 * const dlqJobs = [failedJob1, failedJob2];
 * const provider = createMockProviderWithDLQ(dlqJobs);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockProviderWithDLQ<T = any>(
  dlqJobs: Job<T>[] = [],
  options: {
    capabilities?: Partial<ProviderCapabilities>;
    queueName?: string;
  } = {},
): IQueueProvider {
  return createMockProvider({
    capabilities: {
      supportsDLQ: true,
      ...options.capabilities,
    },
    queueName: options.queueName,
    methods: {
      getDLQJobs: vi.fn().mockResolvedValue(Result.ok(dlqJobs)),
      retryJob: vi.fn().mockResolvedValue(Result.ok(undefined)),
    },
  });
}

/**
 * Create a batch of test jobs with sequential IDs
 *
 * @param count - Number of jobs to create
 * @param overrides - Partial job properties to apply to all jobs
 * @returns Array of jobs
 *
 * @example
 * ```typescript
 * const jobs = createMockJobBatch(10, { queueName: 'my-queue' });
 * // Returns 10 jobs with IDs 'job-0', 'job-1', ..., 'job-9'
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockJobBatch<T = any>(
  count: number,
  overrides: Partial<Job<T>> = {},
): Job<T>[] {
  return Array.from({ length: count }, (_, i) =>
    createMockJob<T>({
      id: `job-${i}`,
      name: `test-job-${i}`,
      ...overrides,
    }),
  );
}

/**
 * Create BullMQ-specific mocks for testing BullMQ provider
 *
 * Returns mock instances of Queue, Worker, QueueEvents, and BullJob
 * that can be used with vi.mock() to test the BullMQ provider
 *
 * @returns Object containing all BullMQ mocks
 *
 * @example
 * ```typescript
 * const mocks = createBullMQMocks();
 * const { mockQueue, mockWorker, mockQueueEvents, mockBullJob } = mocks;
 *
 * // use in tests
 * mockQueue.add.mockResolvedValue(mockBullJob);
 * ```
 */
export function createBullMQMocks() {
  const mockQueue = {
    add: vi.fn(),
    getJob: vi.fn(),
    getWaiting: vi.fn(),
    getFailed: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn(),
    getJobCounts: vi.fn(),
    obliterate: vi.fn(),
    close: vi.fn(),
  };

  const mockWorker = {
    name: "test-queue",
    on: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getNextJob: vi.fn(),
    isRunning: vi.fn(() => true),
    run: vi.fn().mockResolvedValue(undefined),
  };

  const mockQueueEvents = {
    close: vi.fn(),
  };

  const mockBullJob = {
    id: "job-1",
    name: "test-job",
    data: { _jobData: { foo: "bar" }, _metadata: { key: "value" } },
    opts: { attempts: 3, priority: 1 },
    timestamp: Date.now(),
    attemptsMade: 0,
    processedOn: undefined,
    finishedOn: undefined,
    failedReason: undefined,
    getState: vi.fn().mockResolvedValue("waiting"),
    moveToCompleted: vi.fn(),
    moveToFailed: vi.fn(),
    retry: vi.fn(),
  };

  return { mockQueue, mockWorker, mockQueueEvents, mockBullJob };
}

/**
 * Setup default mock behaviors for BullMQ mocks
 *
 * Configures common default return values for BullMQ mock methods
 * Call this in beforeEach() after vi.clearAllMocks() to reset to defaults
 *
 * @param mocks - The mocks object returned from createBullMQMocks()
 *
 * @example
 * ```typescript
 * const mocks = createBullMQMocks();
 *
 * beforeEach(() => {
 *   vi.clearAllMocks();
 *   setupBullMQMockDefaults(mocks);
 * });
 * ```
 */
export function setupBullMQMockDefaults(
  mocks: ReturnType<typeof createBullMQMocks>,
) {
  const { mockQueue, mockBullJob } = mocks;

  mockQueue.getJob.mockResolvedValue(mockBullJob);
  mockQueue.getWaiting.mockResolvedValue([mockBullJob]);
  mockQueue.getFailed.mockResolvedValue([mockBullJob]);
  mockQueue.isPaused.mockResolvedValue(false);
  mockQueue.getJobCounts.mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  });
  mockQueue.add.mockResolvedValue(mockBullJob);
  mockBullJob.getState.mockResolvedValue("waiting");
}

/**
 * Assert that a Result is successful and return the data
 * Provides better error messages and type narrowing
 *
 * @param result - Result to check
 * @returns The success data
 * @throws Error if result is an error
 *
 * @example
 * ```typescript
 * const result = await queue.add("job", {});
 * const job = expectSuccess(result); // job is typed correctly
 * ```
 */
export function expectSuccess<T, E>(result: Result<T, E>): T {
  if (!result.success) {
    throw new Error(
      `Expected success but got error: ${JSON.stringify(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Assert that a Result is an error and return the error
 * Provides better error messages and type narrowing
 *
 * @param result - Result to check
 * @returns The error data
 * @throws Error if result is successful
 *
 * @example
 * ```typescript
 * const result = await queue.add("job", { jobId: "" }); // invalid
 * const error = expectError(result); // error is typed correctly
 * ```
 */
export function expectError<T, E>(result: Result<T, E>): E {
  if (result.success) {
    throw new Error(
      `Expected error but got success: ${JSON.stringify(result.data)}`,
    );
  }
  return result.error;
}

/**
 * Create a mock provider specifically for API layer tests (Queue and Worker)
 * Provides sensible defaults optimized for testing the API layer
 *
 * @param options - Configuration for the mock provider
 * @returns Mocked provider suitable for API testing
 *
 * @example
 * ```typescript
 * // For Queue tests (push + pull)
 * const mockProvider = createMockProviderForAPITests({
 *   capabilities: { supportsDelayedJobs: true, supportsPriority: true },
 * });
 *
 * // For Worker tests (pull only)
 * const mockProvider = createMockProviderForAPITests({
 *   model: "pull"
 * });
 * ```
 */
export function createMockProviderForAPITests(
  options: {
    capabilities?: Partial<ProviderCapabilities>;
    model?: "pull" | "push" | "both";
    queueName?: string;
  } = {},
): IQueueProvider {
  const { capabilities = {}, model = "both", queueName = "test-queue" } = options;

  const mock: IQueueProvider = {
    capabilities: {
      supportsDelayedJobs: false,
      supportsPriority: false,
      supportsRetries: true,
      supportsDLQ: false,
      supportsBatching: false,
      supportsLongPolling: false,
      maxJobSize: 0,
      maxBatchSize: 0,
      maxDelaySeconds: 0,
      ...capabilities,
    },

    // Core operations (always present)
    add: vi.fn().mockImplementation((job: Job<unknown>) =>
      Promise.resolve(Result.ok(job)),
    ),

    getJob: vi.fn().mockResolvedValue(Result.ok(null)),

    getStats: vi.fn().mockResolvedValue(Result.ok(createMockStats({ queueName }))),

    pause: vi.fn().mockResolvedValue(Result.ok(undefined)),

    resume: vi.fn().mockResolvedValue(Result.ok(undefined)),

    delete: vi.fn().mockResolvedValue(Result.ok(undefined)),

    getHealth: vi.fn().mockResolvedValue(Result.ok(createMockHealth())),

    // Lifecycle methods (always present)
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  // Add pull-model methods if needed
  if (model === "pull" || model === "both") {
    mock.fetch = vi.fn().mockResolvedValue(Result.ok([]));
    mock.ack = vi.fn().mockResolvedValue(Result.ok(undefined));
    mock.nack = vi.fn().mockResolvedValue(Result.ok(undefined));
  }

  // Add push-model methods if needed
  if (model === "push" || model === "both") {
    mock.process = vi.fn();
  }

  return mock;
}
