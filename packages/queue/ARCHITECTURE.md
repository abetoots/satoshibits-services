# Architecture: @satoshibits/queue

**Last Updated**: 2025-10-08

This document describes the architectural principles and implementation approach for `@satoshibits/queue`, a thin, honest abstraction layer over queue providers.

## Table of Contents
1. [Core Philosophy](#core-philosophy)
2. [Architectural Layers](#architectural-layers)
3. [Provider Interface](#provider-interface)
4. [Worker Lifecycle](#worker-lifecycle)
5. [Observability](#observability)
6. [State Normalization](#state-normalization)
7. [Configuration Translation](#configuration-translation)
8. [Implementation Guidelines](#implementation-guidelines)

---

## Core Philosophy

### What We Are

**A thin translation layer** that maps a unified API to native provider capabilities, with a **lightweight managed worker** for the consumer side.

The `Queue` and provider interfaces are pure translation. The `Worker` class provides managed orchestration (fetch loops, concurrency, backpressure) as a pragmatic convenience—most applications need this, and implementing it correctly is complex. See [Worker Lifecycle](#worker-lifecycle) for detailed justification.

### What We Are Not

- ❌ Not a full framework with batteries included (only Worker provides orchestration)
- ❌ Not a replacement for provider features (retries, state management)
- ❌ Not a business logic layer (circuit breaking, idempotency)
- ❌ Not a feature virtualizer (we don't fake missing capabilities)

### Guiding Principles

#### 1. Translation Over Reimplementation

**Do**: Translate API calls to native provider SDK calls
```typescript
// User calls
await queue.add('job', data, { attempts: 3 });

// We translate to
await bullmq.add('job', data, { attempts: 3 });  // BullMQ
await sqs.sendMessage({ ... }); // SQS with Redrive Policy
```

**Don't**: Build parallel retry engines, state machines, or health monitors

#### 2. Client-Side Responsibility

**We manage**: The worker process
- Job fetch loop
- In-process concurrency control
- Instrumentation (spans, metrics)
- Graceful shutdown

**We don't manage**: Backend state
- Retry scheduling (provider does this)
- Stale job detection (provider does this)
- Priority queue implementation (provider does this)

#### 3. Events Over Implementation

**We provide**: Events at key lifecycle points
```typescript
worker.on('failed', (payload) => { /* userland handles */ });
worker.on('active', (payload) => { /* userland decides */ });
```

**Userland implements**:
- Circuit breaking logic
- Idempotency checks
- Logging strategies
- Observability integration

#### 4. Honest Abstractions

**Warn-and-Degrade Policy**: If a provider doesn't support a feature:
1. Log a prominent warning
2. Continue execution (don't crash)
3. Ignore the unsupported option

```typescript
// User code
await queue.add('job', data, { priority: 1 });

// SQS provider (no priority support)
logger.warn('SQS provider does not support job priorities. The "priority" option will be ignored.');
// Continue without error
```

**Never**: Fake features that don't exist. No custom retry engines for Postgres. No simulated priorities for SQS.

---

## Architectural Layers

The system is organized into three clean layers:

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│  (User's business logic, circuit breaking, idempotency) │
├─────────────────────────────────────────────────────────┤
│                    Queue API Layer                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  - Unified interface (Queue, Worker classes)     │   │
│  │  - Input validation                              │   │
│  │  - TypeScript generics for type safety           │   │
│  │  - Event emission                                │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                 Thin Adapter Layer                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  - Configuration translation                     │   │
│  │  - State label mapping                           │   │
│  │  - Event emission                                │   │
│  │  - Direct provider SDK calls                     │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  Provider SDKs                           │
│  [BullMQ]      [SQS SDK]      [RabbitMQ]                │
│  (Native implementations of queuing primitives)          │
└─────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**Queue API Layer**: Public interface users interact with
- Validates inputs
- Maintains backward compatibility
- Provides TypeScript types
- Emits lifecycle events

**Thin Adapter Layer**: Translates unified API to provider-specific calls
- Maps configuration options to provider equivalents
- Translates provider states to normalized labels
- Emits events for lifecycle hooks
- Calls provider SDK methods directly

**Provider SDKs**: Battle-tested queue implementations
- BullMQ, SQS, RabbitMQ, etc.
- Handle retries, state management, dead letter queues
- We leverage their strengths, don't replace them

---

## Provider Interface

The provider interface defines the minimal contract all providers must implement.

### Core Interface

The provider interface uses `Result<T, E>` for explicit error handling and separates **Job** (persistent state) from **ActiveJob** (runtime metadata).

```typescript
/**
 * IQueueProvider - Queue-scoped provider interface
 * All operations are for the bound queue (no queueName parameter needed)
 */
interface IQueueProvider {
  // ========================================
  // Core Job Operations
  // ========================================

  /**
   * Add a job to this queue
   * @param job Job persistent state (id, name, data, status, etc.)
   * @param options Optional job creation options
   * @returns Result with added job or error
   */
  add<T>(job: Job<T>, options?: JobOptions): Promise<Result<Job<T>, QueueError>>;

  /**
   * Get a specific job by ID
   * @returns Result with job (null if not found) or error
   */
  getJob<T>(jobId: string): Promise<Result<Job<T> | null, QueueError>>;

  // ========================================
  // Pull Model (for simple providers like Memory, SQS)
  // ========================================

  /**
   * Fetch jobs for processing
   * Returns ActiveJob with runtime metadata (receiptHandle, lockToken, etc.)
   * needed for subsequent ack/nack operations
   */
  fetch?<T>(
    batchSize: number,
    waitTimeMs?: number,
  ): Promise<Result<ActiveJob<T>[], QueueError>>;

  /**
   * Acknowledge successful job completion
   * @param job ActiveJob with runtime metadata
   */
  ack?<T>(job: ActiveJob<T>, result?: unknown): Promise<Result<void, QueueError>>;

  /**
   * Negative acknowledge - job failed
   * Provider handles retry logic, DLQ movement, etc.
   * @param job ActiveJob with runtime metadata
   */
  nack?<T>(job: ActiveJob<T>, error: Error): Promise<Result<void, QueueError>>;

  // ========================================
  // Push Model (for efficient providers like BullMQ)
  // ========================================

  /**
   * Register a job processor (push model)
   * Provider fetches jobs and calls handler using native mechanisms
   * @param handler Function to process each ActiveJob
   * @param options Processing options (concurrency, error callback)
   * @returns Shutdown function to stop processing
   */
  process?<T>(
    handler: (job: ActiveJob<T>) => Promise<void>,
    options: {
      concurrency?: number;
      onError?: (error: QueueError) => void;
    },
  ): () => Promise<void>;

  // ========================================
  // Queue Management
  // ========================================

  pause(): Promise<Result<void, QueueError>>;
  resume(): Promise<Result<void, QueueError>>;
  delete(): Promise<Result<void, QueueError>>;
  getStats(): Promise<Result<QueueStats, QueueError>>;
  getHealth(): Promise<Result<HealthStatus, QueueError>>;

  // ========================================
  // Dead Letter Queue Operations (optional)
  // ========================================

  getDLQJobs?<T>(limit?: number): Promise<Result<Job<T>[], QueueError>>;
  retryJob?(jobId: string): Promise<Result<void, QueueError>>;

  // ========================================
  // Lifecycle
  // ========================================

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // ========================================
  // Capabilities Declaration
  // ========================================

  readonly capabilities: ProviderCapabilities;
}

interface HealthStatus {
  activeWorkers: number;
  queueDepth: number;
  errorRate: number;  // error rate as percentage
  completedCount: number;
  failedCount: number;
  isPaused: boolean;
}

interface ProviderCapabilities {
  supportsDelayedJobs: boolean;
  supportsPriority: boolean;
  supportsBatching: boolean;
  supportsRetries: boolean;
  supportsDLQ: boolean;
  supportsLongPolling: boolean;  // can fetch() wait for jobs?
  maxJobSize: number;            // bytes, 0 = unlimited
  maxBatchSize: number;          // max jobs per fetch, 0 = unlimited
  maxDelaySeconds: number;       // max delay in seconds, 0 = unlimited
}
```

### Job vs ActiveJob Architecture

The library separates **persistent state** (Job) from **runtime metadata** (ActiveJob):

**Job<T> - Persistent State Only:**
```typescript
interface Job<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly queueName: string;
  readonly data: T;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly processedAt?: Date;
  readonly completedAt?: Date;
  readonly failedAt?: Date;
  readonly scheduledFor?: Date;
  readonly error?: string;
  readonly priority?: number;
  readonly metadata?: Record<string, unknown>;
}
```

**ActiveJob<T> - Job + Runtime Metadata:**
```typescript
interface ActiveJob<T = unknown> extends Job<T> {
  readonly providerMetadata?: {
    readonly receiptHandle?: string;  // SQS: needed to acknowledge message
    readonly lockToken?: string;      // other providers: needed to release locks
    readonly [key: string]: unknown;  // other provider-specific data
  };
}
```

**Why This Separation?**

1. **Provider Independence**: Runtime metadata (receiptHandle, lockToken) is provider-specific and should not be persisted
2. **Clear Contracts**: `add()` takes Job (what to store), `fetch()` returns ActiveJob (what to process), `ack/nack()` take ActiveJob (what to acknowledge)
3. **Type Safety**: Handler receives `ActiveJob<T>` with all data needed for processing and acknowledgment

**Data Flow:**
```
Queue.add(job: Job<T>)
  → Provider.add(job: Job<T>)
    → Store in backend

Provider.fetch()
  → Retrieve from backend
    → Add runtime metadata (receiptHandle, etc.)
      → Return ActiveJob<T>[]

Worker calls handler(data: T, job: ActiveJob<T>)
  → Handler processes data
    → Worker calls Provider.ack(job: ActiveJob<T>)
      → Provider uses job.providerMetadata.receiptHandle to acknowledge
```

### Provider Implementation Example

Here's how a memory provider implements the pull model:

```typescript
class MemoryProvider implements IQueueProvider {
  private jobs = new Map<string, Job>();
  private activeJobs = new Map<string, ActiveJob>();

  capabilities = {
    supportsDelayedJobs: true,
    supportsPriority: true,
    supportsBatching: true,
    supportsRetries: true,
    supportsDLQ: true,
    supportsLongPolling: false,  // no blocking in memory
    maxJobSize: 0,               // unlimited
    maxBatchSize: 0,             // unlimited
    maxDelaySeconds: 0           // unlimited
  };

  /**
   * Add job - stores persistent state
   */
  async add<T>(job: Job<T>, options?: JobOptions): Promise<Result<Job<T>, QueueError>> {
    try {
      // check for duplicate IDs
      if (this.jobs.has(job.id)) {
        return Result.err({
          type: "DataError",
          code: "DUPLICATE",
          message: `Job with ID ${job.id} already exists`,
          retryable: false,
          jobId: job.id,
          queueName: job.queueName,
        });
      }

      // store persistent state
      this.jobs.set(job.id, job);

      return Result.ok(job);
    } catch (error) {
      return Result.err({
        type: "RuntimeError",
        code: "ENQUEUE",
        message: `Failed to add job: ${error.message}`,
        retryable: true,
        cause: error,
      });
    }
  }

  /**
   * Fetch jobs - returns ActiveJob with runtime metadata
   */
  async fetch<T>(
    batchSize: number,
    waitTimeMs?: number
  ): Promise<Result<ActiveJob<T>[], QueueError>> {
    try {
      const waitingJobs = Array.from(this.jobs.values())
        .filter(job => job.status === 'waiting')
        .slice(0, batchSize);

      // convert to ActiveJob by adding runtime metadata
      const activeJobs: ActiveJob<T>[] = waitingJobs.map(job => ({
        ...job,
        providerMetadata: {
          lockToken: `lock-${job.id}-${Date.now()}`,  // in-memory lock
        },
      } as ActiveJob<T>));

      // track as active
      activeJobs.forEach(job => this.activeJobs.set(job.id, job));

      return Result.ok(activeJobs);
    } catch (error) {
      return Result.err({
        type: "RuntimeError",
        code: "CONNECTION",
        message: `Fetch failed: ${error.message}`,
        retryable: true,
        cause: error,
      });
    }
  }

  /**
   * Acknowledge - uses runtime metadata from ActiveJob
   */
  async ack<T>(job: ActiveJob<T>, result?: unknown): Promise<Result<void, QueueError>> {
    try {
      // validate lock token from runtime metadata
      const activeJob = this.activeJobs.get(job.id);
      if (!activeJob) {
        return Result.err({
          type: "RuntimeError",
          code: "PROCESSING",
          message: `Job ${job.id} is not active`,
          retryable: false,
          jobId: job.id,
        });
      }

      // update persistent state
      const persistedJob = this.jobs.get(job.id);
      if (persistedJob) {
        this.jobs.set(job.id, {
          ...persistedJob,
          status: 'completed',
          completedAt: new Date(),
        });
      }

      // remove from active tracking
      this.activeJobs.delete(job.id);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err({
        type: "RuntimeError",
        code: "PROCESSING",
        message: `Ack failed: ${error.message}`,
        retryable: true,
        jobId: job.id,
        cause: error,
      });
    }
  }

  /**
   * Negative acknowledge - handles retry/DLQ logic
   */
  async nack<T>(job: ActiveJob<T>, error: Error): Promise<Result<void, QueueError>> {
    try {
      const persistedJob = this.jobs.get(job.id);
      if (!persistedJob) {
        return Result.err({
          type: "NotFoundError",
          code: "JOB_NOT_FOUND",
          message: `Job ${job.id} not found`,
          retryable: false,
          resourceId: job.id,
          resourceType: "job",
        });
      }

      // increment attempts
      const newAttempts = persistedJob.attempts + 1;

      if (newAttempts >= persistedJob.maxAttempts) {
        // move to DLQ (failed state)
        this.jobs.set(job.id, {
          ...persistedJob,
          status: 'failed',
          attempts: newAttempts,
          failedAt: new Date(),
          error: error.message,
        });
      } else {
        // retry - move back to waiting
        this.jobs.set(job.id, {
          ...persistedJob,
          status: 'waiting',
          attempts: newAttempts,
          error: error.message,
        });
      }

      // remove from active tracking
      this.activeJobs.delete(job.id);

      return Result.ok(undefined);
    } catch (err) {
      return Result.err({
        type: "RuntimeError",
        code: "PROCESSING",
        message: `Nack failed: ${err.message}`,
        retryable: true,
        jobId: job.id,
        cause: err,
      });
    }
  }

  async getDLQJobs<T>(limit: number = 100): Promise<Result<Job<T>[], QueueError>> {
    try {
      const failedJobs = Array.from(this.jobs.values())
        .filter(job => job.status === 'failed')
        .slice(0, limit);

      return Result.ok(failedJobs as Job<T>[]);
    } catch (error) {
      return Result.err({
        type: "RuntimeError",
        code: "PROVIDER_ERROR",
        message: `Failed to get DLQ jobs: ${error.message}`,
        retryable: true,
        cause: error,
      });
    }
  }

  async retryJob(jobId: string): Promise<Result<void, QueueError>> {
    try {
      const job = this.jobs.get(jobId);
      if (!job) {
        return Result.err({
          type: "NotFoundError",
          code: "JOB_NOT_FOUND",
          message: `Job ${jobId} not found`,
          retryable: false,
          resourceId: jobId,
          resourceType: "job",
        });
      }

      // move from failed back to waiting
      this.jobs.set(jobId, {
        ...job,
        status: 'waiting',
        attempts: 0,  // reset attempts
      });

      return Result.ok(undefined);
    } catch (error) {
      return Result.err({
        type: "RuntimeError",
        code: "PROVIDER_ERROR",
        message: `Failed to retry job: ${error.message}`,
        retryable: true,
        cause: error,
      });
    }
  }

  // ... other methods (pause, resume, getStats, etc.)
}
```

**Key Patterns:**

1. **Job → ActiveJob Transformation**: `fetch()` adds runtime metadata (lockToken, receiptHandle) to convert Job to ActiveJob
2. **Runtime Metadata Usage**: `ack()` and `nack()` use `job.providerMetadata` to validate/track active jobs
3. **Persistent State Updates**: `ack()` and `nack()` update the stored Job, not the ActiveJob
4. **Result Type**: All operations return `Result<T, QueueError>` for explicit error handling

### The `nack()` Contract

**What `nack()` Does**:
When a job fails processing, calling `nack(jobId, error)` signals the failure to the provider, which then handles retry/DLQ logic using its native mechanisms.

**Provider-Specific Behavior**:

**BullMQ**:
- Increments the job's attempt counter
- If `attempts < maxAttempts`: Re-queues job with backoff delay
- If `attempts >= maxAttempts`: Moves job to failed queue (DLQ)

**SQS**:
- Returns message to queue (makes it visible again)
- SQS tracks receive count internally
- If `receiveCount >= maxReceiveCount`: Moves to configured Dead Letter Queue

**RabbitMQ**:
- Sends `nack` with `requeue=true` for retryable failures
- If max retries exceeded (tracked via headers): Routes to dead letter exchange

**Key Principle**: The library does NOT implement retry logic. It delegates to the provider's battle-tested native implementation.

---

## Provider Development Patterns

The library provides utilities to help maintain consistency across the codebase.

### ConstructorValidator Pattern

Validates constructor arguments with clear, actionable error messages.

**Purpose**:
- Fail fast on misconfiguration
- Provide actionable error messages with context
- Catch explicit `undefined`/`null` (user confusion indicators)

**Usage Example:**
```typescript
class Queue<T = unknown> {
  constructor(
    public readonly name: string,
    options?: Partial<QueueOptions>
  ) {
    const validator = new ConstructorValidator(`Queue:${name}`);

    // validate queue name first - critical for routing
    validator.requireNonEmptyString("queueName", name);

    // validate explicit undefined/null - fail fast to catch user confusion
    if (
      options?.defaultJobOptions &&
      "jobId" in options.defaultJobOptions &&
      options.defaultJobOptions.jobId === undefined
    ) {
      validator.rejectExplicitUndefined("defaultJobOptions.jobId", undefined, "a function");
    }

    // validate types after normalization
    validator.requireFunction("defaultJobOptions.jobId", normalizedOptions.defaultJobOptions.jobId);
    validator.requireFunction("onUnsupportedFeature", normalizedOptions.onUnsupportedFeature);

    // ... rest of constructor
  }
}
```

**Available Methods:**
- `requireNonEmptyString(field, value)`: Validates non-empty strings
- `requireFunction(field, value)`: Validates functions
- `requireNonNegativeNumber(field, value)`: Validates numbers >= 0
- `rejectExplicitUndefined(field, value, expected)`: Catches `undefined` passed explicitly

**Error Messages:**
```
[Queue:emails] queueName must be a non-empty string, got: ""
[Queue:emails] defaultJobOptions.jobId cannot be undefined. Expected: a function
[Queue:emails] onUnsupportedFeature must be a function, got: undefined
```

### ProviderHelper Pattern

Resolves provider instances from various input formats.

**Purpose**:
- Accept flexible provider input (instance, factory, undefined)
- Default to MemoryProvider for zero-config development
- Bind provider to queue name (queue-scoped providers)

**Usage Example:**
```typescript
import { ProviderHelper } from '../core/provider-helpers.mjs';

class Queue<T = unknown> {
  private readonly boundProvider: IQueueProvider;

  constructor(
    public readonly name: string,
    options?: { provider?: IQueueProvider | IProviderFactory }
  ) {
    // resolve provider (default to MemoryProvider if not specified)
    this.boundProvider = ProviderHelper.resolveBoundProvider(
      options?.provider,
      name
    );
  }
}
```

**Supported Input Formats:**
```typescript
// 1. No provider - uses MemoryProvider (development default)
const queue = new Queue('emails');

// 2. IQueueProvider instance (already bound to queue)
const queue = new Queue('emails', {
  provider: new MemoryProvider('emails')
});

// 3. IProviderFactory (creates queue-scoped provider)
const factory = new BullMQProviderFactory({ connection: redis });
const queue = new Queue('emails', { provider: factory });
// calls factory.forQueue('emails') internally
```

**Key Methods:**
- `resolveBoundProvider(provider, queueName)`: Resolves any provider format to `IQueueProvider`
- `isProviderFactory(provider)`: Type guard for factory vs instance

**Why This Matters**:
- **Zero-config**: `new Queue('emails')` just works (defaults to memory)
- **Shared connections**: Use factory for multiple queues with same backend
- **Type safety**: Compile-time checks for provider compatibility

---

## Security Considerations

### Provider Authentication

The library does not implement authentication logic. Instead, credentials are passed directly to the provider's native SDK through the provider constructor.

**Redis/BullMQ Authentication**:
```typescript
const provider = new RedisProvider({
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,  // use environment variables
    tls: {                                  // enable TLS for production
      rejectUnauthorized: true
    }
  }
});
```

**AWS SQS Authentication**:
```typescript
const provider = new SQSProvider({
  region: process.env.AWS_REGION,
  // uses AWS SDK credential chain (IAM roles, env vars, ~/.aws/credentials)
  queueUrl: process.env.SQS_QUEUE_URL
});

// minimum IAM permissions required:
// {
//   "Effect": "Allow",
//   "Action": [
//     "sqs:SendMessage",
//     "sqs:ReceiveMessage",
//     "sqs:DeleteMessage",
//     "sqs:GetQueueAttributes"
//   ],
//   "Resource": "arn:aws:sqs:region:account:queue-name"
// }
```

**RabbitMQ Authentication**:
```typescript
const provider = new RabbitMQProvider({
  url: process.env.RABBITMQ_URL,  // amqps://user:pass@host:port
  // or explicit credentials
  connection: {
    hostname: process.env.RABBITMQ_HOST,
    port: 5671,  // use 5671 for TLS
    username: process.env.RABBITMQ_USER,
    password: process.env.RABBITMQ_PASSWORD,
    protocol: 'amqps'  // enable TLS
  }
});
```

### Data Encryption

**In-Transit Encryption**:
- Always use TLS-enabled connections in production
- Redis: Use `tls` option in connection config
- SQS: Enforced by AWS (HTTPS only)
- RabbitMQ: Use `amqps://` protocol

**At-Rest Encryption**:
- Redis: Configure Redis with encryption at rest (Redis Enterprise, AWS ElastiCache encryption)
- SQS: Enable server-side encryption via AWS KMS in queue settings
- RabbitMQ: Configure disk encryption at the infrastructure level

**Payload Encryption** (if handling sensitive data):
```typescript
// userland responsibility - encrypt before queueing
const encrypted = await encrypt(jobData, encryptionKey);
await queue.add('process', { encrypted });

// decrypt in worker
worker.process(async (job) => {
  const decrypted = await decrypt(job.data.encrypted, encryptionKey);
  return processData(decrypted);
});
```

### Secret Management

**Best Practices**:
- Store credentials in environment variables, never in code
- Use secret management services (AWS Secrets Manager, HashiCorp Vault, Kubernetes Secrets)
- Rotate credentials regularly
- Use IAM roles when running on cloud platforms (AWS, GCP, Azure)

**Example with AWS Secrets Manager**:
```typescript
const secrets = await secretsManager.getSecretValue({ SecretId: 'queue-credentials' }).promise();
const creds = JSON.parse(secrets.SecretString);

const provider = new RedisProvider({
  connection: {
    host: creds.redis_host,
    password: creds.redis_password,
    tls: { rejectUnauthorized: true }
  }
});
```

### Payload Validation

**Userland Responsibility**: The library passes payloads opaquely. Applications must validate and sanitize job data.

```typescript
import { z } from 'zod';

const JobSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(['email', 'sms', 'push']),
  data: z.record(z.unknown())
});

worker.process(async (job) => {
  // validate before processing
  const validated = JobSchema.parse(job.data);
  return processJob(validated);
});
```

### Audit Logging

**Use events for audit trails**:
```typescript
worker.on('active', (payload) => {
  auditLog.info('Job started', {
    jobId: payload.jobId,
    queueName: payload.queueName,
    attempts: payload.attempts,
    timestamp: Date.now()
  });
});

worker.on('completed', (payload) => {
  auditLog.info('Job completed', {
    jobId: payload.jobId,
    queueName: payload.queueName,
    duration: payload.duration,
    timestamp: Date.now()
  });
});

worker.on('failed', (payload) => {
  auditLog.error('Job failed', {
    jobId: payload.jobId,
    queueName: payload.queueName,
    error: payload.error,
    willRetry: payload.willRetry,
    timestamp: Date.now()
  });
});
```

---

## Worker Lifecycle

The worker manages the client-side job processing loop.

**Architectural Note**: The `Worker` class is the library's single framework-like component. While the `Queue` and provider interfaces remain true to the "thin translator" philosophy, the `Worker` provides a managed processing framework that handles fetch loops, concurrency control, backpressure, and graceful shutdown. This is a deliberate trade-off for developer experience—most applications need this orchestration, and implementing it correctly is non-trivial. A pure translator would only expose `fetch()`, `ack()`, and `nack()` primitives, requiring users to build their own worker loops.

**Justification**: This managed approach serves the library's mission of getting out of your way. By handling the complex plumbing (fetch coordination, concurrency limits, shutdown sequencing), the Worker lets you focus on your job handler logic. The dual-model support (push vs pull) further demonstrates translation—we adapt to each provider's native consumption pattern (BullMQ's push-based worker, SQS's pull-based consumer) so you get optimal performance without learning provider-specific APIs.

### Worker Architecture

```typescript
class Worker<T = any> extends TypedEventEmitter {
  private running = false;
  private activeJobs = 0;
  private concurrency: number;
  private batchSize: number;
  private pollInterval: number;
  private errorBackoff: number;

  constructor(
    queueName: string,
    private readonly handler: JobHandler<T>,  // receives (data: T, job: ActiveJob<T>)
    options?: WorkerOptions
  ) {
    this.concurrency = options?.concurrency || 1;
    this.batchSize = options?.batchSize || 1;
    this.pollInterval = options?.pollInterval || 100;
    this.errorBackoff = options?.errorBackoff || 1000;
  }

  async start(): Promise<void> {
    this.running = true;
    this.fetchLoop();
  }

  private async fetchLoop(): Promise<void> {
    while (this.running) {
      try {
        // backpressure: respect concurrency limit
        if (this.activeJobs >= this.concurrency) {
          await this.wait(this.pollInterval);
          continue;
        }

        const availableSlots = this.concurrency - this.activeJobs;
        const fetchCount = Math.min(this.batchSize, availableSlots);

        // fetch batch of jobs (returns ActiveJob with runtime metadata)
        const result = await this.provider.fetch<T>(fetchCount);

        if (!result.success) {
          // emit error and backoff
          this.emit('queue.error', {
            queueName: this.queueName,
            error: result.error,
          });
          await this.wait(this.errorBackoff);
          continue;
        }

        const jobs = result.data;

        if (jobs.length === 0) {
          await this.wait(this.pollInterval);
          continue;
        }

        // process jobs concurrently
        for (const job of jobs) {
          this.processJob(job); // fire and forget
        }
      } catch (error) {
        // unexpected error in fetch loop
        this.emit('queue.error', {
          queueName: this.queueName,
          error,
        });
        await this.wait(this.errorBackoff);
      }
    }
  }

  private async processJob(job: ActiveJob<T>): Promise<void> {
    this.activeJobs++;
    const startTime = Date.now();

    try {
      this.emit('active', {
        jobId: job.id,
        queueName: this.queueName,
        attempts: job.attempts,
        status: job.status,
      });

      // call handler with data and ActiveJob
      const result = await this.handler(job.data, job);

      if (!result.success) {
        throw result.error;
      }

      // acknowledge with ActiveJob (includes runtime metadata)
      const ackResult = await this.provider.ack(job);

      if (!ackResult.success) {
        this.emit('queue.error', {
          queueName: this.queueName,
          error: ackResult.error,
        });
      }

      const duration = Date.now() - startTime;
      this.emit('completed', {
        jobId: job.id,
        queueName: this.queueName,
        duration,
        attempts: job.attempts,
        status: 'completed',
      });
    } catch (error) {
      // nack with ActiveJob (includes runtime metadata)
      const nackResult = await this.provider.nack(job, error);

      if (!nackResult.success) {
        this.emit('queue.error', {
          queueName: this.queueName,
          error: nackResult.error,
        });
      }

      const duration = Date.now() - startTime;
      const willRetry = job.attempts + 1 < job.maxAttempts;

      this.emit('failed', {
        jobId: job.id,
        queueName: this.queueName,
        error: error.message,
        errorType: error.type || 'Error',
        attempts: job.attempts + 1,
        status: willRetry ? 'waiting' : 'failed',
        duration,
        willRetry,
      });

      if (willRetry) {
        this.emit('job.retrying', {
          jobId: job.id,
          queueName: this.queueName,
          attempts: job.attempts + 1,
          status: 'waiting',
          maxAttempts: job.maxAttempts,
        });
      }
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * Gracefully shutdown worker
   *
   * @param options.timeout - Max time to wait for active jobs (default: 30s)
   * @param options.finishActiveJobs - Wait for active jobs to complete (default: true)
   * @param options.disconnectProvider - Disconnect provider after shutdown (default: false)
   */
  async close(options?: {
    timeout?: number;
    finishActiveJobs?: boolean;
    disconnectProvider?: boolean;
  }): Promise<void> {
    const {
      timeout = 30000,
      finishActiveJobs = true,
      disconnectProvider = false,
    } = options || {};

    // stop fetching new jobs
    this.running = false;

    this.emit('processor.shutting_down', {});

    // wait for currently active jobs to complete
    if (finishActiveJobs) {
      const deadline = Date.now() + timeout;
      while (this.activeJobs > 0 && Date.now() < deadline) {
        await this.wait(100);
      }

      // if timeout exceeded, emit event (userland decides how to handle)
      if (this.activeJobs > 0) {
        this.emit('processor.shutdown_timeout', {
          queueName: this.queueName,
          timeout,
          activeJobs: this.activeJobs,
          message: `Shutdown timeout exceeded after ${timeout}ms. ${this.activeJobs} jobs still active.`,
        });
      }
    }

    // optionally disconnect provider (for owned providers)
    if (disconnectProvider) {
      await this.provider.disconnect();
    }
  }
}
```

### Graceful Shutdown Behavior

**Important Clarification**: The `finishActiveJobs` option (formerly called `drain`) controls whether the worker waits for **currently active jobs only**, not the entire queue.

**What It Does**:
- `finishActiveJobs: true` (default): Wait for jobs that are **already being processed** to complete
- `finishActiveJobs: false`: Immediately disconnect, abandoning active jobs

**What It Does NOT Do**:
- ❌ Does NOT fetch new jobs from the queue
- ❌ Does NOT process all remaining jobs in the entire queue
- ❌ Does NOT guarantee zero jobs left in queue after shutdown

**Example**:
```typescript
// graceful shutdown - finish active jobs, keep provider connected
await worker.close({
  timeout: 30000,           // wait up to 30s
  finishActiveJobs: true,   // let active jobs complete
  disconnectProvider: false // keep provider connected (for shared providers)
});

// graceful shutdown - finish active jobs and disconnect owned provider
await worker.close({
  timeout: 30000,
  finishActiveJobs: true,
  disconnectProvider: true  // disconnect provider (for owned providers)
});

// immediate shutdown - abandon active jobs
await worker.close({
  finishActiveJobs: false,  // disconnect immediately
  disconnectProvider: true
});
```

**Use Cases**:
- `finishActiveJobs: true`: Production deployments, rolling updates, graceful restarts
- `finishActiveJobs: false`: Emergency shutdown, development, when jobs are idempotent and can be retried
- `disconnectProvider: true`: Worker owns the provider instance (not shared with other queues/workers)
- `disconnectProvider: false`: Provider is shared across multiple queues/workers (user manages lifecycle)

**Shared Provider Pattern**:
```typescript
// shared provider across multiple queues/workers
const provider = new BullMQProviderFactory({ connection: redis });

const emailQueue = new Queue('emails', { provider });
const emailWorker = new Worker('emails', emailHandler, { provider });

const smsQueue = new Queue('sms', { provider });
const smsWorker = new Worker('sms', smsHandler, { provider });

// shutdown workers - keep provider connected
await emailWorker.close({ disconnectProvider: false });
await smsWorker.close({ disconnectProvider: false });

// user explicitly disconnects shared provider
await provider.disconnect();
```

### Backpressure Mechanism

The worker implements **automatic backpressure** to prevent memory exhaustion:

**How It Works**:
1. Track `activeJobs` count (jobs currently being processed)
2. Before fetching new jobs, check: `if (activeJobs >= concurrency) { wait() }`
3. Only fetch when slots are available: `fetchCount = min(batchSize, concurrency - activeJobs)`

**Why This Matters**:
```typescript
// without backpressure (BAD):
while (running) {
  const jobs = await fetch(100);  // always fetch 100
  for (job of jobs) process(job); // activeJobs grows unbounded
}
// result: OOM if processing is slower than fetching

// with backpressure (GOOD):
while (running) {
  if (activeJobs >= concurrency) { wait(); continue; }
  const jobs = await fetch(concurrency - activeJobs);  // only fetch what we can handle
  for (job of jobs) process(job);
}
// result: memory bounded by concurrency setting
```

**Configuration**:
```typescript
const worker = new Worker('jobs', handler, {
  concurrency: 10  // max 10 jobs in memory simultaneously
});
```

This ensures the worker never holds more jobs in memory than it can actively process.

### Concurrency Control

**In-process concurrency** is managed by the worker:
- Track active job count
- Don't fetch more jobs than `concurrency - activeJobs`
- Simple, predictable behavior

**Provider-side concurrency** (multiple worker processes) is deployment concern:
- Kubernetes replica count
- AWS ECS task count
- pm2 instance count

---

## Observability

**Userland Responsibility**: This library does NOT provide built-in observability instrumentation. Instead, it emits events that allow you to integrate with your observability stack of choice.

### Available Events

**Worker Events**:
- `active`: Job processing started
  - Payload: `{ jobId, queueName, attempts, status, workerId?, metadata? }`
- `completed`: Job processing succeeded
  - Payload: `{ jobId, queueName, attempts, status, duration, metadata? }`
- `failed`: Job processing failed
  - Payload: `{ jobId, queueName, error, errorType, attempts, status, duration, willRetry, retryDelay? }`
- `job.retrying`: Job is being retried
  - Payload: `{ jobId, queueName, attempts, status, maxAttempts?, attempt? }`
- `processor.shutting_down`: Worker is shutting down
  - Payload: `{}`
- `processor.shutdown_timeout`: Graceful shutdown timeout exceeded (active jobs still running)
  - Payload: `{ queueName, timeout, activeJobs, message }`

**Queue Events**:
- `queue.error`: Queue-level error occurred
  - Payload: `{ queueName, error }`
- `queue.drained`: Queue has no more jobs
  - Payload: `{ queueName }`
- `queue.paused`: Queue was paused
  - Payload: `{ queueName }`
- `queue.resumed`: Queue was resumed
  - Payload: `{ queueName }`

### Usage Examples

```typescript
// logging
worker.on('active', (payload) => {
  console.log(`Job ${payload.jobId} started on ${payload.queueName}`);
});

worker.on('completed', (payload) => {
  console.log(`Job ${payload.jobId} completed in ${payload.duration}ms`);
});

worker.on('failed', (payload) => {
  console.error(`Job ${payload.jobId} failed: ${payload.error}`);
  if (payload.willRetry) {
    console.log(`Will retry in ${payload.retryDelay}ms`);
  }
});

// error tracking
queue.on('queue.error', (payload) => {
  errorTracker.captureException(payload.error, {
    tags: { queue: payload.queueName }
  });
});
```

### Why Userland Observability?

**Thin Abstraction Philosophy**: Observability strategies vary widely across organizations (OpenTelemetry, Datadog, New Relic, custom solutions). Building observability into the library would:
- Increase bundle size with dependencies most users won't need
- Force opinions on metric naming, sampling, and export strategies
- Create version lock-in with observability SDKs
- Violate the "thin translation layer" principle

**Events Provide the Hook**: By emitting comprehensive events with rich payloads, we give you complete control to integrate with your existing observability stack

---

## State Normalization

We translate provider-specific states to consistent labels.

### Normalized States

```typescript
enum JobState {
  WAITING = 'waiting',      // queued, not yet processing
  DELAYED = 'delayed',      // scheduled for future
  ACTIVE = 'active',        // currently processing
  COMPLETED = 'completed',  // successfully finished
  FAILED = 'failed'         // permanently failed (in DLQ or exhausted retries)
}
```

### Provider State Mappings

**BullMQ**:
```typescript
const bullmqStateMap = {
  'waiting': 'waiting',
  'delayed': 'delayed',
  'active': 'active',
  'completed': 'completed',
  'failed': 'failed'
};
```

**SQS**:
```typescript
// SQS doesn't have explicit states - we infer from lifecycle
const sqsStateMap = {
  'message in queue': 'waiting',
  'message received (visibility timeout active)': 'active',
  'message deleted': 'completed',
  'message in DLQ': 'failed'
};
```

**RabbitMQ**:
```typescript
const rabbitStateMap = {
  'message in queue': 'waiting',
  'message unacked': 'active',
  'message acked': 'completed',
  'message in DLQ': 'failed'
};
```

### Important: Label Mapping, Not State Management

We **label** provider states consistently. We **don't**:
- Run our own state machine in a separate database
- Implement state transitions that fight with provider logic
- Track job state independently of the provider

The provider is the source of truth. We just translate its state to our vocabulary.

---

## Configuration Translation

We normalize common options and translate to provider-specific configuration.

### Configuration Flow

```typescript
class ConfigTranslator {
  translate(normalized: JobOptions, provider: string): any {
    const base = this.translateBase(normalized);

    // add provider-specific options via escape hatch
    const specific = normalized.providerOptions?.[provider] || {};

    return { ...base, ...specific };
  }

  private translateBase(options: JobOptions): any {
    return {
      attempts: options.attempts,
      backoff: options.backoff,
      delay: options.delay,
      priority: options.priority,
      removeOnComplete: options.removeOnComplete,
      removeOnFail: options.removeOnFail
    };
  }
}
```

### Provider-Specific Translation

**BullMQ**: Direct mapping (our API is inspired by BullMQ)
```typescript
const bullmqOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  delay: 5000,
  priority: 1
};
```

**SQS**: Map to SQS concepts
```typescript
const sqsOptions = {
  // attempts → Redrive Policy
  RedrivePolicy: {
    deadLetterTargetArn: dlqArn,
    maxReceiveCount: 3
  },
  // delay → DelaySeconds
  DelaySeconds: 5,
  // priority not supported - warn and ignore
  // backoff not supported - fixed visibility timeout
};
```

**RabbitMQ**: Map to AMQP concepts
```typescript
const rabbitOptions = {
  // attempts → x-max-retries header
  headers: {
    'x-max-retries': 3,
    'x-retry-delay': 1000
  },
  // delay → x-delayed-type exchange
  // priority → native priority field
  priority: 1
};
```

### Warn-and-Degrade Implementation

```typescript
class ProviderAdapter {
  add(input: JobInput): Promise<string> {
    const capabilities = this.provider.capabilities;

    // check for unsupported features
    if (input.options?.priority && !capabilities.supportsPriority) {
      logger.warn(
        `${this.providerName} does not support job priorities. ` +
        `The 'priority' option will be ignored.`
      );
      delete input.options.priority;
    }

    if (input.options?.delay && !capabilities.supportsDelay) {
      logger.warn(
        `${this.providerName} does not support delayed jobs. ` +
        `The 'delay' option will be ignored.`
      );
      delete input.options.delay;
    }

    // continue with supported options
    return this.provider.add(input);
  }
}
```

---

## Implementation Guidelines

### For Library Maintainers

**When adding a new provider**:
1. Implement `IQueueProvider` interface
2. Declare accurate `capabilities` object
3. Translate normalized options to provider-specific format
4. Map provider states to normalized labels
5. Document provider-specific limitations
6. Add provider to capability matrix in README

**When adding a new feature**:
1. Check if all providers can support it natively
2. If not, make it optional and use warn-and-degrade
3. Don't implement custom logic to fake the feature
4. Document which providers support it in capability matrix

**When debugging issues**:
1. Emit comprehensive events at key lifecycle points
2. Provide clear error messages with context
3. Don't hide errors - surface them clearly
4. Document available events for userland observability

### For Provider Implementers

**Required methods**:
- `connect()`, `disconnect()` - lifecycle
- `add()` - enqueue jobs
- `fetch()` - retrieve jobs for processing
- `ack()` - mark job complete
- `nack()` - mark job failed
- `getMetrics()` - current queue state
- `getHealth()` - health check data

**Capabilities declaration**:
Be honest about what your provider supports:
```typescript
capabilities = {
  supportsDelay: true,        // can schedule future jobs?
  supportsPriority: false,    // has priority queues?
  supportsBatching: true,     // can fetch multiple jobs efficiently?
  supportsRetries: true,      // has native retry mechanism?
  supportsDLQ: true,          // has dead letter queue?
  maxJobSize: 256_000,        // max payload bytes (0 = unlimited)
  maxConcurrency: 0           // max workers (0 = unlimited)
};
```

**State mapping**:
Map your provider's states to normalized labels:
```typescript
private translateState(providerState: string): JobState {
  // return 'waiting' | 'delayed' | 'active' | 'completed' | 'failed'
}
```

**Error handling**:
Surface errors clearly. Don't swallow them:
```typescript
async add(input: JobInput): Promise<string> {
  try {
    return await this.nativeSDK.enqueue(input);
  } catch (error) {
    // wrap with context, don't hide
    throw new QueueError(
      `Failed to add job to ${this.providerName}: ${error.message}`,
      { cause: error, jobName: input.name }
    );
  }
}
```

---

## Testing Strategy

### Unit Tests

Test the thin adapter layer:
```typescript
describe('RedisProvider', () => {
  it('translates normalized options to BullMQ options', () => {
    const input = {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    };

    const result = provider.translateOptions(input);

    expect(result).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });
  });

  it('warns when priority is not supported', () => {
    provider.capabilities.supportsPriority = false;

    provider.add({ name: 'job', data: {}, options: { priority: 1 } });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not support job priorities')
    );
  });
});
```

### Integration Tests

Test against real providers:
```typescript
describe('Queue with Redis', () => {
  let queue: Queue;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis();
    queue = new Queue('test', {
      provider: new RedisProvider({ connection: redis })
    });
  });

  it('processes jobs successfully', async () => {
    const results: any[] = [];

    const worker = new Worker('test', async (job) => {
      results.push(job.data);
      return { processed: true };
    });

    await queue.add('test-job', { value: 42 });

    await waitFor(() => results.length === 1);

    expect(results[0]).toEqual({ value: 42 });
  });
});
```

### Provider Compatibility Tests

Ensure all providers behave consistently:
```typescript
const providers = [
  new InMemoryProvider(),
  new RedisProvider({ connection: redis }),
  new SQSProvider({ region: 'us-east-1', queueUrl: url })
];

for (const provider of providers) {
  describe(`Queue with ${provider.name}`, () => {
    // run same test suite against each provider
    testQueueBehavior(provider);
  });
}
```

---

## Performance Considerations

### Batch Fetching

Use provider's native batching when available:
```typescript
// efficient
const jobs = await provider.fetch(10);  // fetch 10 jobs in one call

// inefficient
for (let i = 0; i < 10; i++) {
  const job = await provider.fetch(1);  // 10 separate calls
}
```

### Concurrency

Balance concurrency with memory:
```typescript
// reasonable for most workloads
const worker = new Worker('jobs', handler, {
  concurrency: 10  // process 10 jobs in parallel
});

// may cause OOM if jobs are memory-intensive
const worker = new Worker('jobs', handler, {
  concurrency: 1000  // probably too high
});
```

Monitor and adjust based on your application metrics:
```typescript
// userland monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  if (memUsage.rss > threshold) {
    worker.setConcurrency(1);  // throttle
  }
}, 5000);
```

### Connection Pooling

Reuse provider connections:
```typescript
// good - single provider instance, shared connection
const provider = new RedisProvider({ connection: redis });
const queue1 = new Queue('emails', { provider });
const queue2 = new Queue('jobs', { provider });

// bad - separate connections
const queue1 = new Queue('emails', {
  provider: new RedisProvider({ connection: redis1 })
});
const queue2 = new Queue('jobs', {
  provider: new RedisProvider({ connection: redis2 })
});
```

---

## Conclusion

This architecture delivers:

✅ **Thin abstraction** - ~1,500-2,000 lines vs. 5,000+ for framework approach
✅ **Honest behavior** - No hidden magic, clear capability communication
✅ **Provider strengths** - Leverage native features instead of reimplementing
✅ **Event-driven hooks** - Comprehensive events for userland observability integration
✅ **Maintainability** - Simple codebase, clear responsibilities
✅ **Extensibility** - Easy to add new providers

By staying focused on translation rather than reimplementation, we deliver genuine value without the complexity and brittleness of a framework approach.

---

**For detailed analysis and rationale, see [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md)**