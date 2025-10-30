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

### Design Decisions

**Result<T, E> for Error Handling**
We use Result types instead of throwing exceptions for predictable error handling. This forces consumers to explicitly handle failure cases at the type level, preventing silent failures in production.

**Dual Processing Models**
The interface supports both pull (fetch/ack/nack) and push (process) models because different providers have different strengths:
- **Pull Model**: Simple, predictable, works everywhere (Memory, SQS, Postgres)
- **Push Model**: More efficient for providers with native worker mechanisms (BullMQ, RabbitMQ)

Methods marked with `?` are optional because not all providers support all patterns. See src/providers/provider.interface.mts:IQueueProvider for the complete interface definition.

**Queue-Scoped Providers**
Providers are bound to a specific queue (no queueName parameter in methods). This prevents routing errors and allows providers to optimize connections per queue. The factory pattern (IProviderFactory.forQueue()) handles the binding.

**Complete Interface**: See src/providers/provider.interface.mts:IQueueProvider for all methods, including:
- Core operations (add, getJob)
- Pull model (fetch, ack, nack)
- Push model (process)
- Management (pause, resume, delete, getStats, getHealth)
- DLQ operations (getDLQJobs, retryJob)
- Lifecycle (connect, disconnect)
- Capability declaration

**Capability Declaration**: See src/core/types.mts:ProviderCapabilities for the complete structure. Providers must honestly declare what they support (delays, priorities, batching, retries, DLQ, etc.) to enable warn-and-degrade behavior.

### Job vs ActiveJob Architecture

**Why Separate Persistent State from Runtime Metadata?**

The library separates **persistent state** (Job) from **runtime metadata** (ActiveJob) to maintain provider independence and clear contracts.

**Design Rationale:**
1. **Provider Independence**: Runtime metadata (SQS receiptHandle, Redis lockToken) is provider-specific and ephemeral. It should never be persisted alongside job data.
2. **Clear Contracts**: Type signatures make intent explicit:
   - `add(job: Job<T>)` - "Here's what to store"
   - `fetch() → ActiveJob<T>[]` - "Here's what to process (with runtime metadata)"
   - `ack(job: ActiveJob<T>)` - "Here's what to acknowledge (needs metadata)"
3. **Type Safety**: Handlers receive `ActiveJob<T>` with all data needed for both processing and acknowledgment. No need to separately track receipt handles or lock tokens.

**Trade-off**: Slightly more complex types, but prevents mixing concerns (persistent data vs. ephemeral runtime state) and enables clean provider implementations.

**Complete Definitions**: See src/core/types.mts:Job and src/core/types.mts:ActiveJob for full interface definitions.

**Data Flow:**
```
add() → Provider stores Job<T>
fetch() → Provider retrieves Job<T>, adds providerMetadata, returns ActiveJob<T>[]
handler() → Processes ActiveJob<T>
ack()/nack() → Provider uses providerMetadata to acknowledge/reject
```

### Provider Implementation Patterns

**Reference Implementation**: See src/providers/memory/memory.provider.mts for a complete working example of the pull model.

**Key Implementation Patterns:**

1. **Job → ActiveJob Transformation**:
   - `fetch()` must add provider-specific runtime metadata (lockToken, receiptHandle, etc.) to Job objects
   - This metadata is used later by `ack()`/`nack()` to acknowledge with the provider's backend

2. **Runtime Metadata Usage**:
   - `ack()` and `nack()` use `job.providerMetadata` to validate active jobs and communicate with backend
   - Example: SQS needs receiptHandle to delete messages, Redis needs lockToken to release locks

3. **Persistent State Updates**:
   - `ack()` and `nack()` update the stored Job (status, timestamps), NOT the ActiveJob metadata
   - Runtime metadata is ephemeral and discarded after acknowledgment

4. **Result Type**:
   - All operations return `Result<T, QueueError>` for explicit error handling
   - Forces callers to handle failures at the type level, preventing silent errors

**Alternative Implementation**: See src/providers/bullmq/bullmq.provider.mts for push model using BullMQ's native worker mechanism.

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

### Provider-Specific Namespaces

**Architecture Decision**: For features that exist in only one provider (or a subset of providers) and cannot be meaningfully abstracted, we use **typed namespaces** rather than adding optional methods to the core `IQueueProvider` interface.

**Problem**: Some providers have advanced features with no equivalents in other backends:
- BullMQ: Recurring job schedulers (cron-like scheduling)
- SQS: FIFO message groups and deduplication
- RabbitMQ: Exchange routing patterns

**Anti-Pattern**: Adding optional methods to `IQueueProvider` for provider-specific features
```typescript
// ❌ DON'T: Pollutes core interface with provider-specific methods
interface IQueueProvider {
  // ... core methods ...
  upsertJobScheduler?(id: string, options: SchedulerOptions): Promise<Result<void>>;  // BullMQ only
  setMessageGroup?(groupId: string): Promise<Result<void>>;  // SQS only
}
```

**Recommended Pattern**: Provider-specific typed namespaces
```typescript
// ✅ DO: Use typed namespaces for provider-specific features
class Queue<T = unknown> {
  // core methods available for all providers
  async add(name: string, data: T): Promise<Result<Job<T>, QueueError>>;

  // provider-specific namespace (returns undefined for unsupported providers)
  get bullmq(): IBullMQExtensions | undefined;
  get sqs(): ISQSExtensions | undefined;
}
```

**Implementation Guidelines**:

1. **Create Extension Interface** (`bullmq-extensions.interface.mts`):
```typescript
export interface IBullMQExtensions {
  upsertJobScheduler<T>(id: string, options: JobSchedulerOptions<T>): Promise<Result<void, QueueError>>;
  getJobSchedulers(): Promise<Result<JobScheduler[], QueueError>>;
  removeJobScheduler(id: string): Promise<Result<void, QueueError>>;
}
```

2. **Implement Extension Class** (in provider file):
```typescript
class BullMQExtensions implements IBullMQExtensions {
  constructor(
    private readonly provider: BullMQProvider,
    private readonly queueName: string
  ) {}

  async upsertJobScheduler<T>(id: string, options: JobSchedulerOptions<T>) {
    const queue = this.provider.getBullMQQueue(this.queueName);
    // ... implementation using BullMQ's native API
  }
}
```

3. **Add Method to Bound Provider**:
```typescript
class BoundBullMQProvider implements IQueueProvider {
  getBullMQExtensions(): IBullMQExtensions {
    return new BullMQExtensions(this.provider, this.queueName);
  }
}
```

4. **Expose via Queue Class**:
```typescript
class Queue<T = unknown> {
  get bullmq(): IBullMQExtensions | undefined {
    if ('getBullMQExtensions' in this.boundProvider &&
        typeof (this.boundProvider as any).getBullMQExtensions === 'function') {
      return (this.boundProvider as any).getBullMQExtensions();
    }
    return undefined;
  }
}
```

**Benefits**:
- **Clean separation**: Core interface remains provider-agnostic
- **Type safety**: TypeScript enforces existence checks (`if (queue.bullmq)`)
- **Discoverability**: IDE autocomplete shows available provider extensions
- **Explicit non-portability**: Namespace signals "this code is BullMQ-specific"
- **No interface pollution**: Adding SQS-specific features won't bloat the BullMQ interface

**When to Use**:
- ✅ Features with no equivalent in other providers (e.g., cron schedulers)
- ✅ Provider-specific optimizations or advanced features
- ✅ Features that would require "virtualization" to abstract

**When NOT to Use**:
- ❌ Per-job options (use `providerOptions` escape hatch instead)
- ❌ Features common across providers (abstract into core interface)
- ❌ Features that violate the "thin translation layer" principle

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

**Purpose**: Resolve flexible provider input (instance, factory, or undefined) into a bound IQueueProvider.

**Design Decisions:**
- **Zero-config default**: When no provider specified, defaults to MemoryProvider for immediate usability
- **Factory pattern support**: Accepts IProviderFactory to enable shared connections across multiple queues
- **Type safety**: Uses type guards to distinguish factory from instance at compile-time

**Why Multiple Input Formats?**
- Developer experience: `new Queue('emails')` should just work (development)
- Production efficiency: Factory pattern allows sharing Redis/database connections across queues
- Flexibility: Direct instance injection for testing or custom providers

**Implementation**: See src/core/provider-helpers.mts:ProviderHelper for the resolution logic.

---

## Security Considerations

**Design Philosophy**: Security is a userland responsibility. This library is a thin translator and does not implement security features like authentication, authorization, encryption, or audit logging.

### Provider Authentication

**Decision**: Pass credentials directly to provider SDKs.

**Why?** Each provider has its own authentication mechanism (Redis password, AWS IAM, RabbitMQ credentials). Abstracting authentication would create a leaky abstraction that adds complexity without providing value.

**Consequence**: Users must configure authentication according to each provider's requirements. See provider-specific documentation (BullMQ, SQS, RabbitMQ) for authentication setup.

### Data Encryption

**Decision**: No built-in payload encryption.

**Why?** Encryption requirements vary (symmetric vs asymmetric, key management strategies, compliance requirements). A one-size-fits-all solution would be opinionated and limiting.

**Consequence**:
- **In-Transit**: Users must configure TLS at the provider level (Redis tls option, amqps:// for RabbitMQ, HTTPS for SQS)
- **At-Rest**: Users must configure provider backend encryption (Redis Enterprise, AWS KMS for SQS, disk encryption for RabbitMQ)
- **Payload**: Users must encrypt sensitive data before queueing and decrypt in handlers if needed

### Payload Validation

**Decision**: Pass job payloads opaquely (no validation).

**Why?** Validation logic is application-specific. The library can't know what constitutes valid data for your domain.

**Consequence**: Users must validate job payloads in their handlers before processing (recommended: use schema validation libraries like Zod, Joi, or Yup).

### Audit Logging

**Decision**: Emit comprehensive events, but don't log them.

**Why?** Logging strategies vary (structured logs, audit trails, compliance requirements, PII considerations). Built-in logging would force opinions on format, destination, and retention.

**Consequence**: Users must attach event listeners to Worker/Queue instances and integrate with their logging infrastructure. See Observability section for available events.

---

## Worker Lifecycle

The worker manages the client-side job processing loop.

**Architectural Note**: The `Worker` class is the library's single framework-like component. While the `Queue` and provider interfaces remain true to the "thin translator" philosophy, the `Worker` provides a managed processing framework that handles fetch loops, concurrency control, backpressure, and graceful shutdown. This is a deliberate trade-off for developer experience—most applications need this orchestration, and implementing it correctly is non-trivial. A pure translator would only expose `fetch()`, `ack()`, and `nack()` primitives, requiring users to build their own worker loops.

**Justification**: This managed approach serves the library's mission of getting out of your way. By handling the complex plumbing (fetch coordination, concurrency limits, shutdown sequencing), the Worker lets you focus on your job handler logic. The dual-model support (push vs pull) further demonstrates translation—we adapt to each provider's native consumption pattern (BullMQ's push-based worker, SQS's pull-based consumer) so you get optimal performance without learning provider-specific APIs.

### Worker Architecture

**Implementation**: See src/api/worker.mts:Worker for complete implementation.

**Key Design Decisions:**

**1. Managed Fetch Loop**
- Worker runs a continuous fetch loop that respects concurrency limits
- Handles backpressure automatically (doesn't fetch more than it can process)
- Implements error backoff to avoid hammering failing providers

**2. Event Emission at Lifecycle Points**
- Emits `active`, `completed`, `failed`, `job.retrying` for observability hooks
- Emits `queue.error` for operational issues (fetch failures, ack/nack failures)
- Emits `processor.shutting_down`, `processor.shutdown_timeout` for graceful shutdown tracking

**3. Handler Signature**
- Handler receives `(data: T, job: ActiveJob<T>)` not just data
- Provides access to job metadata (attempts, id, timestamps) for conditional logic
- ActiveJob includes providerMetadata for advanced use cases (though rarely needed by handlers)

**4. Dual Result Handling**
- Worker automatically calls `ack()` on success, `nack()` on handler errors
- Result type from handler is ignored (provider handles retry logic)
- Handler errors are passed to `nack()` which delegates to provider's retry mechanism

### Graceful Shutdown Design

**Key Decision**: `finishActiveJobs` waits for **in-flight jobs only**, NOT the entire queue.

**Why?** Different semantics suit different deployment scenarios:
- **Graceful shutdown** (finishActiveJobs: true): Wait for jobs currently being processed. Use for rolling deployments.
- **Immediate shutdown** (finishActiveJobs: false): Abandon in-flight jobs. Use when jobs are idempotent or for emergency shutdowns.

**Trade-off**: Clearer semantics but requires understanding of "active" vs "waiting" jobs. Does NOT drain the entire queue—that would be unpredictable in high-throughput systems.

**Provider Lifecycle Management**:
- `disconnectProvider: false` (default): Worker doesn't own the provider, keeps connection alive (shared provider pattern)
- `disconnectProvider: true`: Worker owns the provider, disconnects on close (dedicated provider pattern)

**Why separate flag?** Allows multiple workers to share a provider (common in production). Last worker to shut down doesn't orphan the provider connection.

**Shutdown Timeout**: If active jobs exceed timeout, emits `processor.shutdown_timeout` event rather than forcing termination. Userland decides whether to kill the process or wait longer.

### Backpressure Mechanism

**Design**: Automatic backpressure to prevent memory exhaustion from fetching faster than processing.

**How**: Track active job count. Before fetching, check `if (activeJobs >= concurrency) { wait() }`. Only fetch `min(batchSize, concurrency - activeJobs)` jobs.

**Why?** Without backpressure, fetch loop can outpace processing and cause OOM. With backpressure, memory usage is bounded by concurrency setting.

**Trade-off**: Slightly more complex fetch loop logic, but prevents catastrophic failure in high-throughput scenarios. Alternative (no backpressure) would require users to manually tune fetch intervals, which is error-prone.

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

**Design Decision**: No built-in observability instrumentation. Emit comprehensive events instead.

**Why?** Observability requirements vary wildly:
- Different telemetry backends (OpenTelemetry, Datadog, New Relic, Prometheus, custom)
- Different metric naming conventions and cardinality concerns
- Different sampling strategies and cost considerations
- Different compliance requirements (PII, retention, audit trails)

Building observability into the library would:
- Add mandatory dependencies most users don't need
- Force opinions on metric naming and structure
- Create version lock-in with observability SDKs
- Increase bundle size significantly
- Violate "thin translation layer" principle

**Trade-off**: Users must attach event listeners and integrate with their own observability stack. More setup work, but complete flexibility.

**Available Events**: See src/core/events.mts:QueueEventMap for complete event types and payloads. Key events:
- **Worker lifecycle**: `active`, `completed`, `failed`, `job.retrying`, `processor.shutting_down`, `processor.shutdown_timeout`
- **Queue operations**: `queue.error`, `queue.drained`, `queue.paused`, `queue.resumed`

Each event includes rich context (jobId, queueName, timestamps, error details, retry info) to enable detailed monitoring and alerting.

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

**Design Philosophy**: Performance optimization is primarily a deployment and configuration concern, not a library concern.

### Batch Fetching

**Design**: Worker supports configurable batch size via `batchSize` option.

**Why?** Providers like SQS support fetching multiple messages in one API call (up to 10). Batching reduces network overhead and improves throughput.

**Trade-off**: Larger batches improve throughput but increase latency (waiting for batch to fill). Users tune based on workload characteristics.

### Concurrency Control

**Design**: In-process concurrency via `concurrency` option, multi-process via deployment (Kubernetes replicas, ECS tasks, pm2).

**Why separate concerns?** In-process concurrency is bounded by memory. Multi-process concurrency is bounded by infrastructure. Library handles the former, users handle the latter via deployment configuration.

**Trade-off**: No auto-scaling or dynamic concurrency adjustment. Users must monitor and adjust based on their metrics.

### Connection Pooling

**Design**: Factory pattern (`IProviderFactory.forQueue()`) enables sharing provider connections across multiple queues.

**Why?** Database/Redis connections are expensive. Creating a connection per queue wastes resources. Factory pattern allows one connection pool to serve multiple queues.

**Trade-off**: Slightly more complex provider setup (factory vs direct instance), but significant resource savings in multi-queue scenarios.

---

## Conclusion

This architecture delivers:

✅ **Thin abstraction** - Translation layer, not a framework
✅ **Honest behavior** - No feature virtualization, clear capability communication
✅ **Provider strengths** - Delegates to native implementations (retries, state management, DLQ)
✅ **Event-driven extensibility** - Comprehensive events for userland integration
✅ **Maintainability** - Simple codebase, clear responsibilities
✅ **Extensibility** - Easy to add new providers via IQueueProvider interface

By staying focused on translation rather than reimplementation, we deliver genuine value without the complexity and brittleness of a framework approach.

**Design Trade-offs Summary**:
- ❌ No built-in observability → ✅ Complete flexibility for userland integration
- ❌ No built-in security features → ✅ Uses battle-tested provider SDKs
- ❌ No feature virtualization → ✅ Honest abstractions with warn-and-degrade
- ❌ Managed Worker (framework-like) → ✅ Handles complex orchestration correctly

---

**Documentation Philosophy**: This document focuses on architecture decisions and trade-offs. For API usage and examples, see README.md. For documentation maintenance principles, see DOCUMENTATION_PRINCIPLES.md.