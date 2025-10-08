# @satoshibits/queue

## 2.0.0

### Major Changes

- 3c3639c: complete architectural rewrite - migration to thin abstraction over queue providers

### Patch Changes

- Updated dependencies [7ad2599]
  - @satoshibits/functional@1.1.2

## 2.0.0 - 2025-10-08

**Complete architectural rewrite: migration to thin abstraction over queue providers**

This is a **major breaking release** that completely rewrites the queue package from the ground up. The package has evolved from a specific queue implementation into a **thin, type-safe abstraction layer** over different queue providers (in-memory, BullMQ, AWS SQS).

**Summary of Changes:**

- 35 files changed, 19,316 insertions(+), 317 deletions(-)
- Complete API redesign with Queue (producer) and Worker (consumer) separation
- Provider abstraction with 3 built-in implementations
- Functional error handling with Result<T, E>
- Type-safe event system for observability
- Comprehensive documentation (1,669-line ARCHITECTURE.md, 1,691-line README.md)

---

## Architecture: Thin Abstraction Layer

The v2 architecture follows the **"thin adapter over backend"** principle, providing a unified API across different queue providers while remaining lightweight and unopinionated.

### Core Design Principles

1. **Backend-Agnostic** - Single API works with Memory, BullMQ, SQS, or custom providers
2. **Type-Safe** - Full TypeScript support with discriminated unions and generics
3. **Functional Error Handling** - Result<T, E> monad eliminates thrown exceptions
4. **Observable** - Type-safe event system for monitoring and metrics
5. **Testable** - Provider contract test suite ensures compliance
6. **Minimal** - No framework batteries, users own policy decisions

See `ARCHITECTURE.md` for complete architectural documentation (1,669 lines).

---

## Breaking Changes

### 1. Complete API Redesign: Queue + Worker Separation

**OLD API (v1):**

```typescript
// Single class handled both producing and consuming
import { Queue } from "@satoshibits/queue";

const queue = new Queue("emails");
await queue.add({ to: "user@example.com" }); // throws on error
queue.process(async (job) => {
  // process job
});
```

**NEW API (v2):**

```typescript
// Separate producer and consumer APIs
import { Queue, Worker, MemoryProvider } from "@satoshibits/queue";

const provider = new MemoryProvider();

// Producer API
const queue = new Queue("emails", provider);
const result = await queue.add("send-email", { to: "user@example.com" });
if (result.isErr()) {
  console.error("Failed to add job:", result.error);
  return;
}

// Consumer API
const worker = new Worker(
  "emails",
  async (data, job) => {
    // process job
    return Result.ok(undefined);
  },
  provider,
);

await worker.start();
```

**Migration:** Separate queue operations into `Queue` (adding jobs, management) and `Worker` (processing jobs). Both accept a provider instance.

---

### 2. Provider Abstraction Layer

**What Changed:**

The queue implementation is now abstracted behind the `IQueueProvider` interface, allowing you to swap providers without changing application code.

**Provider Interface:**

All operations are **queue-scoped** (no `queueName` parameters):

```typescript
interface IQueueProvider {
  // Core operations
  add<T>(
    job: Job<T>,
    options?: JobOptions,
  ): Promise<Result<Job<T>, QueueError>>;
  getJob<T>(jobId: string): Promise<Result<Job<T> | null, QueueError>>;

  // Pull model (for Memory, SQS providers)
  fetch?<T>(
    batchSize: number,
    waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>>;
  ack?<T>(
    job: ActiveJob<T>,
    result?: unknown,
  ): Promise<Result<void, QueueError>>;
  nack?<T>(job: ActiveJob<T>, error: Error): Promise<Result<void, QueueError>>;

  // Push model (for BullMQ provider)
  process?<T>(
    handler: (job: ActiveJob<T>) => Promise<void>,
    options: ProcessOptions,
  ): () => Promise<void>;

  // Management
  pause(): Promise<Result<void, QueueError>>;
  resume(): Promise<Result<void, QueueError>>;
  delete(): Promise<Result<void, QueueError>>;
  getStats(): Promise<Result<QueueStats, QueueError>>;
  getHealth(): Promise<Result<HealthStatus, QueueError>>;

  // DLQ operations (optional)
  getDLQJobs?<T>(limit?: number): Promise<Result<Job<T>[], QueueError>>;
  retryJob?<T>(jobId: string): Promise<Result<Job<T>, QueueError>>;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Capabilities
  readonly capabilities: ProviderCapabilities;
}
```

**Provider Factory Pattern:**

For providers supporting multiple queues with shared connections:

```typescript
interface IProviderFactory {
  forQueue(queueName: string): IQueueProvider;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

**Built-in Providers:**

1. **MemoryProvider** - In-memory implementation for development and testing

   - Pull model with fetch/ack/nack
   - Full feature support (delays, priorities, retries, DLQ)
   - No external dependencies

2. **BullMQProvider** - Redis-backed production provider

   - Push model with native blocking operations
   - Leverages BullMQ's optimized job processing
   - Supports all BullMQ features (delays, priorities, retries, repeat jobs)
   - Requires Redis connection

3. **SQSProvider** - AWS SQS cloud-native provider
   - Pull model with long-polling support
   - FIFO and standard queue support
   - Native SQS dead-letter queue integration
   - Requires AWS credentials

**Migration:** Instantiate a provider and pass it to Queue/Worker constructors. See README.md for provider-specific configuration.

---

### 3. Functional Error Handling: Result<T, E>

**OLD API (v1):**

```typescript
// Methods threw errors
try {
  await queue.add({ data: "value" });
} catch (error) {
  console.error("Failed:", error);
}
```

**NEW API (v2):**

```typescript
// Methods return Result<T, E>
import { Result } from "@satoshibits/functional";

const result = await queue.add("job-name", { data: "value" });
if (result.isErr()) {
  const error: QueueError = result.error;
  console.error(`Failed: ${error.message}`, {
    type: error.type,
    code: error.code,
    retryable: error.retryable,
  });
  return;
}

const job = result.value;
console.log(`Job added: ${job.id}`);
```

**Structured Error Types:**

```typescript
type QueueError =
  | {
      type: "ConfigurationError";
      code: "INVALID_CONFIG" | "UNSUPPORTED_FEATURE" | "PROVIDER_ERROR";
      message: string;
      retryable: false;
      details?: unknown;
    }
  | {
      type: "RuntimeError";
      code:
        | "CONNECTION"
        | "TIMEOUT"
        | "ENQUEUE"
        | "PROCESSING"
        | "SHUTDOWN"
        | "RATE_LIMIT"
        | "THROTTLING";
      message: string;
      retryable: boolean;
      queueName?: string;
      jobId?: string;
      cause?: unknown;
    }
  | {
      type: "DataError";
      code: "SERIALIZATION" | "VALIDATION" | "DUPLICATE" | "INVALID_JOB_DATA";
      message: string;
      retryable: false;
      queueName?: string;
      jobId?: string;
      data?: unknown;
    }
  | {
      type: "NotFoundError";
      code: "JOB_NOT_FOUND" | "QUEUE_NOT_FOUND";
      message: string;
      retryable: false;
      resourceId: string;
      resourceType: "job" | "queue";
      queueName?: string;
    };
```

**Job Handler Signature:**

```typescript
type JobHandler<T> = (
  data: T,
  job: ActiveJob<T>,
) => Promise<Result<void, QueueError | Error>>;

// Example handler
const handler: JobHandler<EmailData> = async (data, job) => {
  try {
    await sendEmail(data);
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(error as Error);
  }
};
```

**Migration:** Wrap all queue operations in Result handling. Update job handlers to return `Result<void, QueueError | Error>`.

---

### 4. Job Type Separation: Job<T> vs ActiveJob<T>

**What Changed:**

Jobs now have two distinct types for clear separation between persistent state and runtime metadata.

**Job<T> - Persistent State Only:**

```typescript
interface Job<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly queueName: string;
  readonly data: T;
  readonly status: JobStatus; // "waiting" | "active" | "completed" | "failed" | "delayed"
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly processedAt?: Date;
  readonly completedAt?: Date;
  readonly failedAt?: Date;
  readonly scheduledFor?: Date; // for delayed jobs
  readonly error?: string;
  readonly priority?: number;
  readonly metadata?: Record<string, unknown>;
}
```

**ActiveJob<T> - Job with Runtime Metadata:**

```typescript
interface ActiveJob<T = unknown> extends Job<T> {
  readonly providerMetadata?: {
    readonly receiptHandle?: string; // SQS receipt handle
    readonly lockToken?: string; // Lock tokens for other providers
    readonly [key: string]: unknown; // Provider-specific fields
  };
}
```

**Usage:**

```typescript
// Queue.add() returns Job<T>
const result = await queue.add("send-email", emailData);
if (result.isOk()) {
  const job: Job<EmailData> = result.value;
}

// Job handlers receive ActiveJob<T>
const handler = async (data: EmailData, job: ActiveJob<EmailData>) => {
  // Access runtime metadata if needed
  if (job.providerMetadata?.receiptHandle) {
    console.log("SQS receipt:", job.providerMetadata.receiptHandle);
  }
  return Result.ok(undefined);
};
```

**Migration:** Job handlers now receive `ActiveJob<T>` instead of `Job<T>`. Runtime metadata is available via `job.providerMetadata`.

---

### 5. Type-Safe Event System

**What Changed:**

New `EventBus` class provides strongly-typed events for comprehensive observability.

**Event System:**

```typescript
import { EventBus } from "@satoshibits/queue";

import type { QueueEventMap } from "@satoshibits/queue";

const eventBus = new EventBus();

// Worker lifecycle events
eventBus.on("active", (payload) => {
  // Payload type: { jobId, queueName, attempts, status, workerId?, metadata? }
  console.log(`Job ${payload.jobId} started`);
});

eventBus.on("completed", (payload) => {
  // Payload type: { jobId, queueName, attempts, status, duration, metadata? }
  console.log(`Job ${payload.jobId} completed in ${payload.duration}ms`);
});

eventBus.on("failed", (payload) => {
  // Payload type: { jobId, queueName, error, errorType, attempts, status, duration, willRetry, structuredError? }
  console.error(`Job ${payload.jobId} failed:`, payload.error);
  if (payload.willRetry) {
    console.log(`Will retry (attempt ${payload.attempts})`);
  }
});

eventBus.on("job.retrying", (payload) => {
  // Payload type: { jobId, queueName, attempts, status, maxAttempts?, attempt? }
  console.log(`Retrying job ${payload.jobId}`);
});

// Queue events
eventBus.on("queue.error", (payload) => {
  console.error(`Queue error on ${payload.queueName}:`, payload.error);
});

eventBus.on("queue.paused", (payload) => {
  console.log(`Queue ${payload.queueName} paused`);
});

eventBus.on("queue.resumed", (payload) => {
  console.log(`Queue ${payload.queueName} resumed`);
});

eventBus.on("queue.drained", (payload) => {
  console.log(`Queue ${payload.queueName} has no more jobs`);
});

// Processor events
eventBus.on("processor.shutting_down", () => {
  console.log("Worker shutdown initiated");
});

eventBus.on("processor.shutdown_timeout", (payload) => {
  console.warn(
    `Shutdown timeout on ${payload.queueName}: ${payload.activeJobs} jobs still active`,
  );
});

// Pass eventBus to Queue and Worker
const queue = new Queue("emails", provider, { eventBus });
const worker = new Worker("emails", handler, provider, { eventBus });
```

**Available Events:**

| Event                        | When Emitted               | Payload                                                                                           |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `active`                     | Job starts processing      | `{ jobId, queueName, attempts, status, workerId?, metadata? }`                                    |
| `completed`                  | Job completes successfully | `{ jobId, queueName, attempts, status, duration, metadata? }`                                     |
| `failed`                     | Job fails (may retry)      | `{ jobId, queueName, error, errorType, attempts, status, duration, willRetry, structuredError? }` |
| `job.retrying`               | Job will be retried        | `{ jobId, queueName, attempts, status, maxAttempts?, attempt? }`                                  |
| `queue.error`                | Queue-level error          | `{ queueName, error: QueueError }`                                                                |
| `queue.drained`              | No more jobs in queue      | `{ queueName }`                                                                                   |
| `queue.paused`               | Queue paused               | `{ queueName }`                                                                                   |
| `queue.resumed`              | Queue resumed              | `{ queueName }`                                                                                   |
| `processor.shutting_down`    | Worker shutdown starts     | `{}`                                                                                              |
| `processor.shutdown_timeout` | Shutdown timeout exceeded  | `{ queueName, timeout, activeJobs, message }`                                                     |

**Migration:** Replace EventEmitter usage with EventBus. All event names and payloads are now strongly typed.

**Files:** `src/core/events.mts`, `src/core/events.test.mts`

---

### 6. Removed JobIdGenerators Export

**What Changed:**

The `JobIdGenerators` namespace export has been removed. Only `uuidId` is exported as the recommended default.

**OLD API (v1):**

```typescript
import { JobIdGenerators } from "@satoshibits/queue";

const queue = new Queue("emails", {
  defaultJobOptions: {
    jobId: JobIdGenerators.uuid, // or .timestamp, .nano, etc.
  },
});
```

**NEW API (v2):**

```typescript
import { uuidId } from "@satoshibits/queue";

const queue = new Queue("emails", provider, {
  defaultJobOptions: {
    jobId: uuidId, // wrapper for crypto.randomUUID()
  },
});

// Or bring your own
import { nanoid } from "nanoid";

const queue = new Queue("emails", provider, {
  defaultJobOptions: {
    jobId: () => nanoid(),
  },
});
```

**Removed Exports:**

- `JobIdGenerators` namespace
- `timestampId`
- `sequentialIdFactory`
- `nanoId`

**Kept Export:**

- `uuidId` - Production-safe UUID generator using `crypto.randomUUID()`

**Rationale:** Following the "userland owns policy" principle, the library provides sensible defaults without imposing framework-like batteries. Users needing specific ID strategies can easily provide their own.

**Migration:** Replace `JobIdGenerators.*` with `uuidId` or provide custom generator function.

---

### 7. Queue and Worker Constructor Changes

**Queue Constructor:**

```typescript
// OLD (v1)
new Queue(name: string, options?: QueueOptions)

// NEW (v2)
new Queue(
  name: string,
  provider: IQueueProvider | IProviderFactory | ProviderConstructor,
  options?: {
    defaultJobOptions?: {
      jobId?: () => string;
      priority?: number;
      maxAttempts?: number;
      backoff?: number | ((attempt: number) => number);
      removeOnComplete?: boolean | number;
      removeOnFail?: boolean | number;
    };
    onUnsupportedFeature?: (feature: string, fallback: string) => void;
    eventBus?: EventBus;
  }
)
```

**Worker Constructor:**

```typescript
// OLD (v1)
queue.process(handler, options?)

// NEW (v2)
new Worker(
  queueName: string,
  handler: JobHandler<T>,
  provider: IQueueProvider | IProviderFactory | ProviderConstructor,
  options?: {
    concurrency?: number;
    pollInterval?: number;
    errorBackoff?: number;
    batchSize?: number;
    longPollMs?: number;
    eventBus?: EventBus;
  }
)
```

**Migration:** Update constructors to accept provider and new options structure.

---

## New Features

### 1. Provider Capabilities System

Providers declare their feature support via the `ProviderCapabilities` interface:

```typescript
interface ProviderCapabilities {
  supportsDelayedJobs: boolean; // Scheduled jobs
  supportsPriority: boolean; // Job prioritization
  supportsLongPolling: boolean; // Efficient polling (SQS, etc.)
  supportsBatching: boolean; // Batch operations
  supportsRetries: boolean; // Automatic retry logic
  supportsDLQ: boolean; // Dead-letter queue
  maxJobSize: number; // Max job payload size (bytes, 0 = unlimited)
  maxBatchSize: number; // Max batch size (0 = unlimited)
  maxDelaySeconds: number; // Max delay duration (seconds, 0 = unlimited)
}
```

Queue and Worker automatically adapt based on provider capabilities. Unsupported features trigger `onUnsupportedFeature` callback.

---

### 2. Graceful Shutdown

**Queue.close():**

```typescript
await queue.close({
  disconnectProvider: false, // Set true if queue owns the provider
});
```

**Worker.close():**

```typescript
await worker.close({
  timeout: 30000, // Max wait time for active jobs (ms)
  finishActiveJobs: true, // Wait for active jobs to complete
  disconnectProvider: false, // Set true if worker owns the provider
});
```

**Shared Provider Example:**

```typescript
const provider = new BullMQProvider({ connection: redisConfig });

const queue1 = new Queue("emails", provider);
const queue2 = new Queue("jobs", provider);
const worker = new Worker("emails", handler, provider);

// Close without disconnecting (provider is shared)
await worker.close({ disconnectProvider: false });
await queue1.close({ disconnectProvider: false });
await queue2.close({ disconnectProvider: false });

// Disconnect provider once
await provider.disconnect();
```

---

### 3. Long-Polling Support

For providers supporting long-polling (SQS, etc.), Worker automatically uses efficient long-polling:

```typescript
const worker = new Worker("queue", handler, sqsProvider, {
  longPollMs: 20000, // 20-second long-polling (SQS max)
});
```

Provider's `fetch()` method accepts `waitTimeMs` parameter for long-polling.

---

### 4. Pull and Push Processing Models

**Pull Model** (Memory, SQS providers):

Worker manages fetch loop, calls provider's `fetch()`, `ack()`, `nack()` primitives:

```typescript
class MemoryProvider implements IQueueProvider {
  async fetch<T>(
    batchSize: number,
    waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    // Fetch jobs from storage
  }

  async ack<T>(
    job: ActiveJob<T>,
    result?: unknown,
  ): Promise<Result<void, QueueError>> {
    // Mark job complete
  }

  async nack<T>(
    job: ActiveJob<T>,
    error: Error,
  ): Promise<Result<void, QueueError>> {
    // Handle failure, retry, or DLQ
  }
}
```

**Push Model** (BullMQ provider):

Provider manages job fetching using native blocking operations:

```typescript
class BullMQProvider implements IQueueProvider {
  async process<T>(
    handler: (job: ActiveJob<T>) => Promise<void>,
    options: ProcessOptions,
  ): Promise<() => Promise<void>> {
    // Register BullMQ worker with native blocking fetch
    // Returns shutdown function
  }
}
```

Worker detects which model the provider supports and adapts automatically.

---

### 5. Provider Contract Test Suite

Reusable test suite for provider implementations:

```typescript
import { runProviderContractTests } from "../__shared__/provider-contract.suite.mts";

describe("MyProvider Contract", () => {
  runProviderContractTests({
    providerName: "MyProvider",
    createProvider: () => new MyProvider(config),
    cleanup: async (provider) => {
      await provider.disconnect();
    },
    capabilities: {
      supportsDelayedJobs: true,
      supportsPriority: true,
      // ... declare capabilities
    },
  });
});
```

Ensures all providers meet the `IQueueProvider` contract with 800+ lines of comprehensive tests.

**Files:** `src/providers/__shared__/provider-contract.suite.mts`

---

### 6. Runtime Validation with Clear Error Messages

**ConstructorValidator** utility for fail-fast validation:

```typescript
import { ConstructorValidator } from "./core/validators.mjs";

class Queue {
  constructor(name: string, provider: unknown, options?: QueueOptions) {
    const validator = new ConstructorValidator("Queue", name);

    validator.requireString("name", name);
    validator.requireFunction(
      "defaultJobOptions.jobId",
      options?.defaultJobOptions?.jobId,
    );
    // ... more validations
  }
}
```

**Benefits:**

- Fails immediately with clear error messages
- Prevents silent failures and runtime crashes
- Type assertion signatures enable TypeScript type narrowing

**Files:** `src/core/validators.mts`, `src/core/validators.test.mts`

---

### 7. Provider Helper for Flexible Instantiation

**ProviderHelper** resolves providers from multiple formats:

```typescript
import { ProviderHelper } from "./core/provider-helpers.mjs";

// Accepts:
// 1. IQueueProvider instance (already bound to queue)
// 2. IProviderFactory instance (will call forQueue())
// 3. Provider constructor (will instantiate)

const provider = ProviderHelper.resolve(providerInput, queueName);
```

Enables flexible Queue/Worker construction:

```typescript
// Direct provider instance
new Queue("emails", new MemoryProvider());

// Factory instance (shared connection)
const factory = new BullMQProvider({ connection: redis });
new Queue("emails", factory);
new Queue("jobs", factory);

// Provider constructor
new Queue("emails", MemoryProvider);
```

**Files:** `src/core/provider-helpers.mts`, `src/core/provider-helpers.test.mts`

---

## Bug Fixes

### Critical: Queue Constructor Validation

**Issue:** Queue constructor accepted explicit `undefined` for `jobId` or `onUnsupportedFeature`, leading to runtime crashes during job creation.

**Fix:** Added runtime validation to reject explicit `undefined`:

```typescript
if (
  options?.defaultJobOptions?.jobId !== undefined &&
  typeof options.defaultJobOptions.jobId !== "function"
) {
  throw new TypeError(
    "[Queue:test] defaultJobOptions.jobId must be a function, got undefined",
  );
}
```

**Impact:** Fail-fast behavior prevents confusing runtime crashes.

**Files:** `src/api/queue.mts:42-62`, `src/api/queue.test.mts:888-979`

---

### High: Worker Constructor Validation (CPU Spin-Loop Prevention)

**Issue:** Explicit `undefined` for `pollInterval` or `errorBackoff` created catastrophic CPU spin-loop because `setTimeout(callback, undefined)` behaves like `setTimeout(callback, 0)`.

**Fix:** Added validation for timing parameters:

```typescript
validator.requireFiniteNonNegativeNumber("pollInterval", pollInterval);
validator.requireFiniteNonNegativeNumber("errorBackoff", errorBackoff);
```

**Impact:** Prevents silent performance death that can bring services to their knees.

**Files:** `src/api/worker.mts:89-107`, `src/api/worker.test.mts:1077-1196`

---

### High: Non-Null Assertion Safety in Queue.add()

**Issue:** Non-null assertions (`!`) on `jobId` and `attempts` bypassed TypeScript safety without runtime guarantees.

**Fix:** Added validation after merging options:

```typescript
if (typeof sanitizedOptions.jobId !== "string" || !sanitizedOptions.jobId) {
  return Result.err({
    type: "DataError",
    code: "INVALID_JOB_DATA",
    message: `jobId must be a non-empty string`,
  });
}
```

**Impact:** Type-safe job creation with meaningful error messages.

**Files:** `src/api/queue.mts:149-165`

---

## Documentation

### ARCHITECTURE.md (1,669 lines)

Comprehensive architectural documentation covering:

- Design principles and philosophy
- Provider abstraction layer
- Job vs ActiveJob architecture
- Event system design
- Provider development patterns
- Error handling strategies
- Lifecycle management
- Provider contract requirements
- Performance considerations
- Testing strategies

### README.md (1,691 lines)

Complete user guide with:

- Quick start examples
- Provider configuration guides (Memory, BullMQ, SQS)
- Job handler patterns
- Error handling examples
- Event system usage
- Lifecycle management
- Advanced patterns (batching, priorities, delays, DLQ)
- Monitoring and observability
- Testing guide
- Migration guide from v1
- API reference

### DOCUMENTATION_FIXES_SUMMARY.md

Tracking document for 18 documentation fixes ensuring docs match implementation.

---

## Test Coverage

**New Test Files:**

- `src/api/queue.test.mts` - Queue API tests (578 lines)
- `src/api/worker.test.mts` - Worker API tests (937 lines)
- `src/core/events.test.mts` - Event system tests (265 lines)
- `src/core/provider-helpers.test.mts` - Provider resolution tests (397 lines)
- `src/core/validators.test.mts` - Validation tests (379 lines)
- `src/providers/memory/memory.provider.test.mts` - Memory provider tests (916 lines)
- `src/providers/bullmq/bullmq.provider.test.mts` - BullMQ provider tests (1,335 lines)
- `src/providers/sqs/sqs.provider.test.mts` - SQS provider tests (2,874 lines)
- `src/providers/__shared__/provider-contract.suite.mts` - Contract test suite (842 lines)

**Integration Tests:**

- `src/providers/bullmq/bullmq.provider.contract.integration.test.mts`
- `src/providers/sqs/sqs.provider.contract.integration.test.mts`

**Test Utilities:**

- `src/test-utils.mts` - Mock providers and test helpers (576 lines)

---

## New Dependencies

**Production:**

- `bullmq` - BullMQ provider support
- `@aws-sdk/client-sqs` - SQS provider support

**Development:**

- Updated test framework configuration for integration tests

---

## Files Changed

**New Files (27):**

- `ARCHITECTURE.md`, `README.md`, `DOCUMENTATION_FIXES_SUMMARY.md`
- `src/api/queue.mts`, `src/api/queue.test.mts`
- `src/api/worker.mts`, `src/api/worker.test.mts`
- `src/core/events.mts`, `src/core/events.test.mts`
- `src/core/types.mts`
- `src/core/utils.mts`
- `src/core/validators.mts`, `src/core/validators.test.mts`
- `src/core/provider-helpers.mts`, `src/core/provider-helpers.test.mts`
- `src/core/job-id-generators.mts`
- `src/providers/provider.interface.mts`
- `src/providers/memory/memory.provider.mts`, `src/providers/memory/memory.provider.test.mts`
- `src/providers/bullmq/bullmq.provider.mts`, `src/providers/bullmq/bullmq.provider.test.mts`
- `src/providers/bullmq/bullmq.provider.contract.integration.test.mts`
- `src/providers/sqs/sqs.provider.mts`, `src/providers/sqs/sqs.provider.test.mts`
- `src/providers/sqs/sqs.provider.contract.integration.test.mts`
- `src/providers/__shared__/provider-contract.suite.mts`
- `src/test-utils.mts`

**Modified Files (6):**

- `src/index.mts` - Updated exports for v2 API
- `package.json` - Added provider dependencies
- `CHANGELOG.md` - This file
- `vitest.config.mts` - Test configuration updates
- `eslint.config.mts` - Linting configuration
- `tsconfig.node.json` - TypeScript configuration

**Deleted Files (2):**

- `src/dev-loader.mjs` - No longer needed
- `src/index.test.mts` - Replaced by specific API tests

---

## Migration Guide Summary

1. **Install provider dependencies:**

   ```bash
   # For BullMQ
   npm install bullmq ioredis

   # For SQS
   npm install @aws-sdk/client-sqs
   ```

2. **Update imports:**

   ```typescript
   // OLD
   import { Queue, JobIdGenerators } from "@satoshibits/queue";

   // NEW
   import { Queue, Worker, MemoryProvider, uuidId } from "@satoshibits/queue";
   ```

3. **Instantiate provider:**

   ```typescript
   const provider = new MemoryProvider();
   // or new BullMQProvider({ connection: redisConfig })
   // or new SQSProvider({ region: 'us-east-1', queueUrl: '...' })
   ```

4. **Update Queue usage:**

   ```typescript
   const queue = new Queue("emails", provider, {
     defaultJobOptions: { jobId: uuidId },
   });

   const result = await queue.add("send-email", emailData);
   if (result.isErr()) {
     console.error("Failed:", result.error);
     return;
   }
   ```

5. **Update Worker usage:**

   ```typescript
   const worker = new Worker(
     "emails",
     async (data, job) => {
       try {
         await processEmail(data);
         return Result.ok(undefined);
       } catch (error) {
         return Result.err(error as Error);
       }
     },
     provider,
   );

   await worker.start();
   ```

6. **Handle Result types:**

   ```typescript
   // Check result.isOk() or result.isErr()
   // Access result.value or result.error
   ```

7. **Set up events (optional):**

   ```typescript
   const eventBus = new EventBus();
   eventBus.on("completed", (payload) => {
     console.log(`Job ${payload.jobId} completed`);
   });

   const queue = new Queue("emails", provider, { eventBus });
   const worker = new Worker("emails", handler, provider, { eventBus });
   ```

For complete migration guide, see README.md.

---

## Breaking Changes Summary

- ✅ Complete API redesign (Queue + Worker separation)
- ✅ Provider abstraction layer required
- ✅ Result<T, E> error handling (no thrown errors)
- ✅ Job<T> vs ActiveJob<T> type separation
- ✅ Type-safe event system
- ✅ Removed JobIdGenerators namespace
- ✅ Constructor signature changes
- ✅ Job handler signature changes

## New Features Summary

- ✅ Three built-in providers (Memory, BullMQ, SQS)
- ✅ Provider capabilities system
- ✅ Graceful shutdown
- ✅ Long-polling support
- ✅ Pull and push processing models
- ✅ Provider contract test suite
- ✅ Runtime validation utilities
- ✅ Provider helper for flexible instantiation
- ✅ Comprehensive documentation (3,360 lines)

---

**Total Changes:** 35 files, 19,316 insertions(+), 317 deletions(-)
