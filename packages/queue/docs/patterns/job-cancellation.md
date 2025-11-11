# Job Cancellation Patterns

> **Library Philosophy Note**: This guide documents userland patterns for job cancellation. The @satoshibits/queue library intentionally does NOT provide core API methods for job cancellation, as this would violate our "thin translation layer" principle. Instead, we empower you with knowledge and working examples to implement cancellation in your application code.

## Table of Contents

1. [Understanding Job Cancellation Types](#1-understanding-job-cancellation-types)
2. [Pre-Execution Removal (Provider-Specific)](#2-pre-execution-removal-provider-specific)
3. [Active Job Abortion - Pattern 1: Timeout-Based](#3-active-job-abortion---pattern-1-timeout-based)
4. [Active Job Abortion - Pattern 2: External Cancellation (BullMQ)](#4-active-job-abortion---pattern-2-external-cancellation-bullmq)
5. [Combining Patterns: The "Ultimate" Handler](#5-combining-patterns-the-ultimate-handler)
6. [Future: Native AbortSignal Support (BullMQ)](#6-future-native-abortsignal-support-bullmq)
7. [Graceful Worker Shutdown](#7-graceful-worker-shutdown)
8. [Provider Limitations Reference](#8-provider-limitations-reference)

---

## 1. Understanding Job Cancellation Types

Job "cancellation" is an ambiguous term that maps to **three distinct operations**. Understanding these differences is critical for implementing reliable cancellation logic.

### The Three Types of Cancellation

#### Type 1: Pre-Execution Removal

**Definition**: Deleting jobs that are waiting or scheduled (not currently processing)

**Use Cases**:
- User cancels request before processing starts
- Batch job becomes obsolete before running
- Cleanup of old scheduled jobs
- Removing jobs from delayed queue

**Implementation**: Use provider-specific native APIs (see [Section 2](#2-pre-execution-removal-provider-specific))

**Availability**: ✓ All providers support this natively

#### Type 2: In-Execution Abortion

**Definition**: Stopping jobs that are currently being processed

**Use Cases**:
- User clicks "Cancel" on long-running operation
- Job exceeds timeout threshold
- Admin intervention for stuck jobs
- Resource-based circuit breaking

**Implementation**: Requires userland patterns (see [Sections 3-4](#3-active-job-abortion---pattern-1-timeout-based))

**Availability**: ✗ No provider has native support - requires application-level patterns

#### Type 3: Worker Shutdown

**Definition**: Gracefully stopping the worker process

**Use Cases**:
- Deployment (rolling updates)
- Scaling down workers
- Maintenance windows
- Emergency worker restarts

**Implementation**: Use `worker.close({ finishActiveJobs: true })` (see [Section 7](#7-graceful-worker-shutdown))

**Availability**: ✓ Already implemented in @satoshibits/queue

### Key Architectural Insight

> **From BullMQ Documentation**:
>
> "The core architectural hurdle is the **Job Lock**. When a worker picks up a job, that job is 'locked' by that specific worker. An external `job.remove()` call cannot and will not stop an active job. This is not a bug - it is the central architectural constraint."

This constraint exists across ALL queue providers (BullMQ, SQS, RabbitMQ, etc.). Once a worker claims a job, only that worker can decide to stop processing it.

### Decision Tree: Which Cancellation Type Do I Need?

```
Is the job currently being processed?
│
├─ NO (job is waiting/delayed)
│  └─ Use PRE-EXECUTION REMOVAL (Section 2)
│     └─ Call provider-specific remove API
│
└─ YES (job is active)
   │
   ├─ Do you need EXTERNAL cancellation? (user clicks Cancel button)
   │  └─ YES: Use EXTERNAL CANCELLATION PATTERN (Section 4)
   │     └─ Requires Redis Pub/Sub + AbortController (BullMQ only)
   │
   └─ Do you need TIMEOUT enforcement? (job takes too long)
      └─ YES: Use TIMEOUT PATTERN (Section 3)
         └─ Use AbortController with setTimeout (all providers)
```

---

## 2. Pre-Execution Removal (Provider-Specific)

All queue providers support removing jobs that haven't started processing yet. Each provider has its own native API. **The @satoshibits/queue library does NOT wrap these APIs** - you should call them directly.

### Why No Core API for Removal?

From the library's philosophy:

> "We are a **thin translation layer** that maps a unified API to native provider capabilities. We are NOT a full framework with batteries included."

Job removal is already provided by all providers natively. Wrapping it would:
- ✗ Provide minimal translation value (just a wrapper)
- ✗ Set bad precedent for wrapping everything
- ✗ Bloat API surface for limited value
- ✗ Violate "thin translation layer" principle

Instead, access provider-specific APIs directly when needed.

### BullMQ

```typescript
import { Queue as BullMQQueue } from 'bullmq';

// direct BullMQ access
const bullmqQueue = new BullMQQueue('my-queue', { connection });

// remove a specific job
const job = await bullmqQueue.getJob(jobId);

if (job) {
  try {
    await job.remove();
    console.log(`Job ${jobId} removed successfully`);
  } catch (error) {
    if (error.message.includes('locked')) {
      console.error(`Job ${jobId} is currently active and cannot be removed`);
      // to abort an active job, see the patterns in Sections 3 and 4
    } else {
      console.error(`Failed to remove job: ${error.message}`);
    }
  }
} else {
  console.log(`Job ${jobId} not found (may have completed or been removed)`);
}
```

**Error Handling**:
- BullMQ throws error if job is locked (active state)
- Check error message for "locked" to distinguish from other errors
- Job not found means it may have completed or been removed already

**Bulk Removal**:

```typescript
// remove multiple jobs
for (const jobId of jobIds) {
  const job = await bullmqQueue.getJob(jobId);
  if (job) {
    try {
      await job.remove();
    } catch (error) {
      // handle locked jobs or other errors
      console.error(`Failed to remove ${jobId}:`, error.message);
    }
  }
}

// or use BullMQ's clean method for bulk cleanup
await bullmqQueue.clean(0, 100, 'wait');      // clean first 100 waiting jobs
await bullmqQueue.clean(24 * 3600, 0, 'completed'); // clean completed jobs older than 24h
```

### SQS

```typescript
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const client = new SQSClient({ region: 'us-east-1' });

// you need the receipt handle (obtained when receiving the message)
// note: once SQS consumer receives a message, it enters "invisible" state
// and cannot be deleted by other consumers until visibility timeout expires

try {
  await client.send(new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  }));
  console.log('Message deleted from queue');
} catch (error) {
  console.error('Failed to delete message:', error);
}
```

**Important SQS Semantics**:
- Messages are only "deleted" using receipt handles
- Once received by a consumer, message is invisible to others
- Cannot cancel a message that another consumer is processing
- For queued (not-yet-received) messages, use purge or DLQ
- Visibility timeout determines how long a message stays invisible

### RabbitMQ

```typescript
import amqp from 'amqplib';

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();

// reject a message without requeue (sends to DLQ if configured)
channel.basicReject(deliveryTag, false);

// or use basicNack for more control (can reject multiple messages)
channel.basicNack(deliveryTag, false, false);
// params: deliveryTag, multiple, requeue
```

**Note**: Similar to SQS, once consumer receives message, it "owns" it until ack/nack. Cannot cancel a message another consumer is processing.

### Memory Provider

If using @satoshibits/queue's memory provider, you can access provider methods directly:

```typescript
// if your provider instance is exposed
const result = await memoryProvider.removeJob(jobId);

if (result.success) {
  console.log('Job removed');
} else {
  console.error('Error:', result.error.message);
}
```

### When Pre-Execution Removal Works

| Job State | Can Remove? | Notes |
|-----------|-------------|-------|
| `waiting` | ✓ Yes | Job is queued but not started |
| `delayed` | ✓ Yes | Job is scheduled for future |
| `active` | ✗ **NO** | Job is currently processing - see Sections 3-4 |
| `completed` | ✓ Yes | Cleanup old completed jobs |
| `failed` | ✓ Yes | Cleanup failed jobs |

---

## 3. Active Job Abortion - Pattern 1: Timeout-Based

**Purpose**: Prevent jobs from running indefinitely by enforcing maximum execution time.

**When to Use**:
- Enforce SLA requirements (job must complete in X seconds)
- Prevent runaway jobs from consuming resources
- Fail fast for operations that are taking too long
- Budget-conscious: limit processing costs per job

**Key Principle**: Job "polices itself" - no external signal needed.

### Implementation

Uses Node.js `AbortController` to create a timeout that cancels the job internally.

```typescript
import { Worker, UnrecoverableError } from '@satoshibits/queue';
import { Result } from '@satoshibits/functional';

// example: long-running file processing task
async function processLargeFile(
  data: any,
  signal: AbortSignal
): Promise<void> {
  // for I/O-bound operations (fetch, DB queries, file operations)
  // pass signal directly - these APIs natively support AbortSignal
  const response = await fetch(data.url, { signal });
  const content = await response.text();

  // for CPU-bound operations
  // periodically check if signal has been aborted
  const chunks = content.split('\n');
  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) {
      throw new Error('AbortError'); // will be caught by handler
    }
    await processChunk(chunks[i]);
  }
}

const worker = new Worker('file-processing', async (data, job) => {
  const controller = new AbortController();
  const timeout = data.timeout || 30000; // 30s default, or from job data

  // start timer that will abort after timeout
  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    await processLargeFile(data, controller.signal);
    return Result.ok(undefined);
  } catch (error) {
    if (error.name === 'AbortError') {
      // job took too long - fail permanently (don't retry)
      throw new UnrecoverableError(
        `Timeout: Job exceeded ${timeout}ms execution time`
      );
    }
    // other errors - let default retry logic handle
    throw error;
  } finally {
    // CRITICAL: clear timeout to prevent it from firing after job completes
    clearTimeout(timer);
  }
});
```

### Key Implementation Details

#### 1. Signal-Aware Functions

Your business logic must accept and respect `AbortSignal`:

```typescript
// I/O operations - native support
await fetch(url, { signal });
await db.query(sql, params, { signal });
await fs.promises.readFile(path, { signal });

// CPU operations - manual checks
for (const item of items) {
  if (signal.aborted) break;
  processItem(item);
}

// long-running loops - check periodically
for (let i = 0; i < 1000000; i++) {
  if (i % 1000 === 0 && signal.aborted) {
    throw new Error('AbortError');
  }
  // ... work
}
```

#### 2. The finally Block

**CRITICAL**: Always clear the timeout in `finally`:

```typescript
finally {
  clearTimeout(timer);
}
```

Without this, the timer could fire AFTER the job completes successfully, causing an abort signal when there's nothing to abort.

#### 3. Error Handling

Distinguish timeout errors from business logic errors:

```typescript
if (error.name === 'AbortError') {
  // timeout occurred
  throw new UnrecoverableError('Timeout'); // don't retry
} else {
  // business logic error
  throw error; // let retry logic handle
}
```

### Production Example: Multi-Step Processing

```typescript
const worker = new Worker('data-pipeline', async (data, job) => {
  const controller = new AbortController();
  const timeout = 60000; // 1 minute

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // step 1: fetch data (I/O-bound)
    const raw = await fetch(data.sourceUrl, {
      signal: controller.signal
    });

    // step 2: process data (CPU-bound)
    const rows = await raw.json();
    const processed = [];

    for (let i = 0; i < rows.length; i++) {
      if (controller.signal.aborted) {
        throw new Error('AbortError');
      }
      processed.push(await transformRow(rows[i]));
    }

    // step 3: store results (I/O-bound)
    await db.insertMany(processed, {
      signal: controller.signal
    });

    return Result.ok({ rowsProcessed: processed.length });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new UnrecoverableError(
        `Pipeline timeout: ${timeout}ms exceeded`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
});
```

### Pros and Cons

**Pros**:
- ✓ Simple to implement
- ✓ Self-contained (no external coordination)
- ✓ Works with all providers
- ✓ Prevents runaway jobs
- ✓ Enforces SLAs reliably
- ✓ No infrastructure dependencies

**Cons**:
- ✗ Cannot be cancelled externally (no user "Cancel" button)
- ✗ Timeout is fixed per job (can't adjust dynamically)
- ✗ Requires business logic to be signal-aware

---

## 4. Active Job Abortion - Pattern 2: External Cancellation (BullMQ)

**Purpose**: Allow external systems (API, UI, admin) to cancel a specific active job on-demand.

**When to Use**:
- User clicks "Cancel" button in UI
- Admin intervention to stop problematic job
- Job becomes obsolete while processing (e.g., user deleted the resource)
- Dynamic cancellation based on external events

**Complexity**: **HIGH** - requires custom IPC mechanism and careful state management

**Availability**: **BullMQ only** (requires Redis Pub/Sub)

---

> **Important**: This pattern is NOT provided by the queue library. You must implement it in your application code. We provide a working example you can adapt.

### Architecture Overview

```
┌─────────────┐                    ┌──────────────────────────┐
│   API/UI    │ publish 'abort'    │   Worker Process         │
│             │ ──────────────────>│                          │
│ Publisher   │  Redis Pub/Sub     │ Subscriber               │
└─────────────┘  Channel           │ (listening for signals)  │
                                   │                          │
                                   │ ┌────────────────────┐   │
                                   │ │ AbortController    │   │
                                   │ │ Map<jobId, ctrl>   │   │
                                   │ └────────────────────┘   │
                                   │          │               │
                                   │          v               │
                                   │ ┌────────────────────┐   │
                                   │ │ Job Handler        │   │
                                   │ │ (signal-aware)     │   │
                                   │ └────────────────────┘   │
                                   └──────────────────────────┘
```

**Key Components**:
1. **Global State**: Map of active job IDs to AbortControllers
2. **Control Plane**: Redis subscriber listening for abort signals
3. **Signal-Aware Handler**: Checks signal and throws AbortError
4. **Publisher**: API that publishes abort messages

### Complete Implementation

#### Worker Setup

```typescript
import { Worker, UnrecoverableError } from '@satoshibits/queue';
import { Result } from '@satoshibits/functional';
import Redis from 'ioredis';

// ============================================
// COMPONENT 1: Global State
// ============================================
// track active jobs by ID -> AbortController
// WARNING: this Map MUST be cleaned up in finally blocks to prevent memory leaks
const activeJobControllers = new Map<string, AbortController>();

// ============================================
// COMPONENT 2: Control Plane (Redis Subscriber)
// ============================================
const subscriber = new Redis({
  host: 'localhost',
  port: 6379
});

const CONTROL_CHANNEL = 'job-cancellation-channel';

// subscribe to control channel
subscriber.subscribe(CONTROL_CHANNEL, (err) => {
  if (err) {
    console.error('[Control] Failed to subscribe:', err);
    process.exit(1);
  } else {
    console.log(`[Control] Subscribed to ${CONTROL_CHANNEL}`);
  }
});

// listen for abort messages
subscriber.on('message', (channel, message) => {
  if (channel === CONTROL_CHANNEL) {
    try {
      const { jobId, action } = JSON.parse(message);

      if (action === 'abort' && jobId) {
        const controller = activeJobControllers.get(jobId);

        if (controller) {
          console.log(`[Control] Aborting job ${jobId}`);
          controller.abort(); // this triggers AbortError in the handler
        } else {
          console.warn(`[Control] No active job ${jobId} (may have completed)`);
        }
      }
    } catch (e) {
      console.warn('[Control] Invalid message on control channel:', e);
    }
  }
});

// handle Redis connection errors
subscriber.on('error', (error) => {
  console.error('[Control] Redis subscriber error:', error);
});

// ============================================
// COMPONENT 3: Signal-Aware Handler
// ============================================
const worker = new Worker('long-running-jobs', async (data, job) => {
  // create AbortController for this job
  const controller = new AbortController();

  // register in global map
  activeJobControllers.set(job.id, controller);

  try {
    console.log(`[Worker] Started job ${job.id}`);

    // pass signal to business logic
    await performLongTask(data, controller.signal);

    console.log(`[Worker] Completed job ${job.id}`);
    return Result.ok(undefined);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`[Worker] Job ${job.id} was cancelled externally`);
      // don't retry - this was intentional cancellation
      throw new UnrecoverableError('Job cancelled by user request');
    }
    // other errors - let retry logic handle
    throw error;

  } finally {
    // CRITICAL: clean up to prevent memory leak
    activeJobControllers.delete(job.id);
  }
});

// ============================================
// COMPONENT 4: Business Logic (Signal-Aware)
// ============================================
async function performLongTask(
  data: any,
  signal: AbortSignal
): Promise<void> {
  // example: processing large dataset
  for (let i = 0; i < data.items.length; i++) {
    // check signal periodically
    if (signal.aborted) {
      throw new Error('AbortError');
    }

    // simulate work
    await processItem(data.items[i]);
  }
}

// graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down...');
  await worker.close({ finishActiveJobs: true });
  await subscriber.quit();
  process.exit(0);
});
```

#### API/Publisher Side

```typescript
import Redis from 'ioredis';

const publisher = new Redis({
  host: 'localhost',
  port: 6379
});

const CONTROL_CHANNEL = 'job-cancellation-channel';

/**
 * Cancel an active job by publishing abort signal
 *
 * IMPORTANT: this is asynchronous - the job may not stop immediately.
 * Subscribe to worker events to know when cancellation completes.
 */
export async function cancelActiveJob(jobId: string): Promise<void> {
  const message = JSON.stringify({
    jobId,
    action: 'abort',
  });

  console.log(`[API] Publishing abort signal for job ${jobId}`);
  await publisher.publish(CONTROL_CHANNEL, message);

  // note: cancellation is async. the worker will:
  // 1. receive the message
  // 2. call controller.abort()
  // 3. handler checks signal and throws AbortError
  // 4. job fails with UnrecoverableError
}

// example API endpoint
app.post('/jobs/:jobId/cancel', async (req, res) => {
  const { jobId } = req.params;

  await cancelActiveJob(jobId);

  res.json({
    message: 'Cancellation signal sent',
    note: 'Job will be cancelled asynchronously'
  });
});
```

### Critical Implementation Notes

#### 1. Memory Leak Prevention

The `activeJobControllers` Map MUST be cleaned up:

```typescript
finally {
  // ALWAYS delete from map, even if job fails
  activeJobControllers.delete(job.id);
}
```

Without this, the Map will grow indefinitely and cause memory exhaustion.

#### 2. Connection Management

You need TWO Redis connections:
- Worker's connection (for job processing via BullMQ)
- Subscriber's connection (for Pub/Sub control channel)

Pub/Sub connections cannot be used for other Redis operations - they're dedicated to subscription mode.

#### 3. Signal-Aware Code

Your business logic MUST check the signal:

```typescript
// CPU-bound: manual checks
for (const item of items) {
  if (signal.aborted) throw new Error('AbortError');
  processItem(item);
}

// I/O-bound: pass signal to APIs
await fetch(url, { signal });
```

#### 4. Race Conditions

The job might complete BEFORE the abort signal arrives:

```typescript
subscriber.on('message', (channel, message) => {
  const controller = activeJobControllers.get(jobId);

  if (controller) {
    controller.abort(); // job is still active
  } else {
    // job already completed or wasn't in this worker
    console.warn(`Job ${jobId} not found`);
  }
});
```

This is expected and safe - the abort is a no-op if the job finished.

### Pros and Cons

**Pros**:
- ✓ True external cancellation (user can cancel from UI)
- ✓ On-demand cancellation (not just timeouts)
- ✓ Precise control (cancel specific jobs)

**Cons**:
- ✗ High complexity (IPC, state management, cleanup)
- ✗ BullMQ only (requires Redis Pub/Sub)
- ✗ Memory leak risk if cleanup is missed
- ✗ Requires signal-aware business logic
- ✗ Async cancellation (no immediate feedback)
- ✗ Multiple Redis connections needed

---

## 5. Combining Patterns: The "Ultimate" Handler

You can combine both timeout and external cancellation patterns using `AbortSignal.any()`:

```typescript
const worker = new Worker('jobs', async (data, job) => {
  // external cancellation controller
  const externalController = new AbortController();
  activeJobControllers.set(job.id, externalController);

  // timeout controller
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), 60000);

  // combine both signals
  const combinedSignal = AbortSignal.any([
    externalController.signal,
    timeoutController.signal,
  ]);

  try {
    await performLongTask(data, combinedSignal);
    return Result.ok({ completed: true });
  } catch (error) {
    if (error.name === 'AbortError') {
      // check which signal was aborted
      if (externalController.signal.aborted) {
        throw new UnrecoverableError('Job cancelled by user');
      } else {
        throw new UnrecoverableError('Job timeout exceeded');
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
    activeJobControllers.delete(job.id);
  }
});
```

**Benefits**:
- Job is cancelled if EITHER timeout is exceeded OR external signal is sent
- Clear error messages distinguish cancellation source
- Single business logic implementation handles both cases

---

## 6. Future: Native AbortSignal Support (BullMQ)

BullMQ is considering native `job.signal` support in [Issue #3017](https://github.com/taskforcesh/bullmq/issues/3017).

### Proposed API

```typescript
// future (not yet implemented)
const worker = new Worker('my-queue', async (job) => {
  // BullMQ provides the signal automatically
  await performLongTask(job.data, job.signal);
});

// cancellation from external process
await job.moveToFailed(new Error('User cancelled'), 'cancelled', true);
// this would trigger job.signal.abort()
```

### How to Prepare

Write signal-aware code NOW, even if you're only using timeouts:

```typescript
// good: signal-aware (future-proof)
async function processData(data: any, signal: AbortSignal) {
  for (const item of data.items) {
    if (signal.aborted) break;
    await processItem(item, signal);
  }
}

// bad: not signal-aware
async function processData(data: any) {
  for (const item of data.items) {
    await processItem(item);
  }
}
```

When BullMQ adds native signal support, you'll be able to remove your Pub/Sub infrastructure and just use `job.signal`.

---

## 7. Graceful Worker Shutdown

The @satoshibits/queue library provides built-in support for graceful worker shutdown during deployments.

### Using worker.close()

```typescript
const worker = new Worker('my-queue', handler, options);

await worker.start();

// graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutdown signal received');

  await worker.close({
    finishActiveJobs: true,  // wait for active jobs to complete
    timeout: 30000,          // max 30s to wait
    disconnectProvider: true // disconnect if worker owns provider
  });

  process.exit(0);
});
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `finishActiveJobs` | `true` | Wait for active jobs to complete before closing |
| `timeout` | `30000` | Maximum time to wait (ms) before forcing shutdown |
| `disconnectProvider` | `false` | Whether to disconnect the provider |

### The "Stuck Deploy" Problem

**Problem**: If active jobs take longer than the shutdown timeout, they may be terminated mid-execution.

**Solution**: Design jobs to be:
1. **Short-running**: Break large tasks into smaller jobs
2. **Resumable**: Store progress so jobs can resume if interrupted
3. **Idempotent**: Safe to retry if partially executed

**Example: Resumable Job**:

```typescript
const worker = new Worker('large-export', async (data, job) => {
  const { recordId, progress = 0 } = data;

  // resume from last checkpoint
  const records = await db.query('SELECT * FROM records WHERE id > ?', [progress]);

  for (let i = 0; i < records.length; i++) {
    // check for shutdown signal (if using timeout pattern)
    if (signal?.aborted) {
      // save progress and reschedule
      await queue.add('large-export', {
        recordId,
        progress: progress + i
      });
      throw new Error('AbortError');
    }

    await processRecord(records[i]);
  }

  return Result.ok({ processed: records.length });
});
```

### Best Practices for Deployments

1. **Set appropriate timeout**:
   ```typescript
   await worker.close({ timeout: 60000 }); // 1 minute for long jobs
   ```

2. **Monitor shutdown events**:
   ```typescript
   worker.on('processor.shutdown_timeout', (event) => {
     console.error(`Shutdown timeout: ${event.activeJobs} jobs still running`);
     // alert monitoring system
   });
   ```

3. **Use health checks**:
   ```typescript
   app.get('/health', async (req, res) => {
     const health = await queue.getHealth();
     res.json(health);
   });
   ```

4. **Implement graceful degradation**:
   ```typescript
   let isShuttingDown = false;

   process.on('SIGTERM', async () => {
     isShuttingDown = true; // stop accepting new work
     await worker.close({ finishActiveJobs: true });
   });

   // in job handler
   if (isShuttingDown) {
     throw new Error('Worker is shutting down');
   }
   ```

---

## 8. Provider Limitations Reference

### Cancellation Support Matrix

```
┌──────────────────────────────────────────────────────────────────────┐
│ Job Cancellation Support by Provider                                 │
├──────────────┬─────────────────┬─────────────────┬──────────────────┤
│ Provider     │ Pre-Execution   │ Active Jobs     │ Graceful         │
│              │ (Removal)       │ (Abortion)      │ Shutdown         │
├──────────────┼─────────────────┼─────────────────┼──────────────────┤
│ BullMQ       │ ✓ job.remove()  │ ⚠ Pub/Sub       │ ✓ worker.close() │
│ SQS          │ ✓ deleteMessage │ ✗ Not possible  │ ✓ worker.close() │
│ RabbitMQ     │ ✓ basicReject   │ ✗ Not possible  │ ✓ worker.close() │
│ Memory       │ ✓ Direct delete │ ⚠ Not exposed   │ ✓ worker.close() │
└──────────────┴─────────────────┴─────────────────┴──────────────────┘

Legend:
✓ = Native support via provider API
⚠ = Possible with custom patterns (requires userland implementation)
✗ = Not possible with this provider
```

### Detailed Provider Notes

#### BullMQ

**Pre-execution**:
- `await job.remove()` - throws error if job is locked (active)
- `await queue.clean(age, limit, state)` - bulk cleanup

**Active jobs**:
- No native API - requires Pub/Sub pattern ([Section 4](#4-active-job-abortion---pattern-2-external-cancellation-bullmq))
- Future: Issue #3017 proposes native `job.signal` support

**Best for**: Applications that need external cancellation capability

#### SQS

**Pre-execution**:
- `deleteMessage()` using receipt handle
- `purgeQueue()` for removing all messages

**Active jobs**:
- Cannot cancel once received by consumer (visibility timeout model)
- Once a message is received, it's "invisible" until timeout or deletion
- Consumer must complete or let visibility timeout expire

**Best for**: Fire-and-forget jobs that don't need cancellation

#### RabbitMQ

**Pre-execution**:
- `basicReject(requeue=false)` or `basicNack()` - sends to DLQ if configured
- `queuePurge()` for removing all messages

**Active jobs**:
- Cannot signal consumer from outside
- Consumer "owns" message until ack/nack

**Best for**: Event-driven architectures with automatic retries

#### Memory Provider

**Pre-execution**:
- Direct deletion from internal queues
- Simple array/map operations

**Active jobs**:
- Technically possible but not exposed (would set false expectations for other providers)

**Best for**: Development, testing, simple use cases

### Recommended Patterns by Provider

#### BullMQ Applications

1. Use `job.remove()` for pre-execution cancellation
2. Implement Pub/Sub pattern for external cancellation (if needed)
3. Use timeout pattern for all long-running jobs (SLA enforcement)
4. Prepare for native `job.signal` support (write signal-aware handlers)

```typescript
// recommended BullMQ setup
const worker = new Worker('tasks', async (data, job) => {
  const controller = new AbortController();
  activeJobControllers.set(job.id, controller);
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    await performTask(data, controller.signal);
    return Result.ok({ success: true });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new UnrecoverableError('Cancelled or timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    activeJobControllers.delete(job.id);
  }
});
```

#### SQS Applications

1. Use `deleteMessage()` for queued messages (if you have receipt handle)
2. Use timeout pattern internally (SQS has no external cancellation)
3. Design jobs to be idempotent (SQS guarantees at-least-once delivery)
4. Accept that active jobs cannot be cancelled externally

```typescript
// recommended SQS setup
const worker = new Worker('tasks', async (data, job) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    await performTask(data, controller.signal);
    return Result.ok({ success: true });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new UnrecoverableError('Timeout exceeded');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
});
```

#### RabbitMQ Applications

1. Use `basicReject()` or `basicNack()` for unprocessed messages
2. Use timeout pattern internally (no external cancellation)
3. Leverage RabbitMQ's retry and DLQ features
4. Design for failure (jobs may be redelivered)

```typescript
// recommended RabbitMQ setup (similar to SQS)
const worker = new Worker('tasks', async (data, job) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    await performTask(data, controller.signal);
    return Result.ok({ success: true });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new UnrecoverableError('Timeout exceeded');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
});
```

---

## General Best Practices

1. **Always implement timeout pattern** for long-running jobs (regardless of provider)
2. **Make handlers signal-aware** (check `signal.aborted` periodically)
3. **Design for idempotency** (jobs may be retried or redelivered)
4. **Clean up resources** in `finally` blocks
5. **Don't rely on external cancellation** unless absolutely necessary (adds complexity)
6. **Test cancellation logic** (simulate timeouts, external signals)
7. **Monitor active jobs** during deployments
8. **Set appropriate shutdown timeouts** based on job duration
9. **Use UnrecoverableError** for intentional cancellations (don't retry)
10. **Document your cancellation strategy** for your team

---

## Summary

Job cancellation in queue systems is nuanced and provider-dependent. This guide has shown you:

✓ **Three types of cancellation** and when to use each
✓ **Provider-specific removal** for pre-execution cancellation
✓ **Timeout pattern** for self-policing jobs (all providers)
✓ **Pub/Sub pattern** for external cancellation (BullMQ only)
✓ **Combined patterns** for maximum flexibility
✓ **Graceful shutdown** for deployments
✓ **Provider limitations** and best practices

Remember: The @satoshibits/queue library intentionally keeps cancellation in userland. This guide empowers you to implement the right patterns for your use case while staying aligned with the library's minimalist philosophy.
