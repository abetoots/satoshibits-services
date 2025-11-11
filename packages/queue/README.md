# @satoshibits/queue

> **Backend-agnostic queue abstraction that gets out of your way.**

[![npm version](https://badge.fury.io/js/%40satoshibits%2Fqueue.svg)](https://www.npmjs.com/package/@satoshibits/queue)
[![Build Status](https://img.shields.io/github/actions/workflow/status/satoshibits/queue/ci.yml?branch=main)](https://github.com/satoshibits/queue/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A thin, honest abstraction over queue providers. Switch between BullMQ, AWS SQS, and RabbitMQ without rewriting your application code.

## Why @satoshibits/queue?

**The Problem**: Queue libraries have incompatible APIs. Switching from BullMQ to SQS means rewriting your entire job system.

**Our Solution**: A unified interface that translates to native provider features. No vendor lock-in. No hidden magic.

### What We Do

✅ **Unified API** - One interface for all providers
✅ **Honest Abstractions** - We don't fake features. If a provider doesn't support something, we tell you.
✅ **Event-Driven** - Comprehensive lifecycle events for observability, monitoring, and custom logic
✅ **Provider Strengths** - Leverage each provider's native capabilities
✅ **Escape Hatch** - Access provider-specific features when you need them

### What We Don't Do

❌ **No Framework Magic** - We're a translator, not a framework
❌ **No Reimplementation** - We use provider retries, not custom engines
❌ **No Business Logic** - Circuit breaking, idempotency, logging are your job
❌ **No Feature Virtualization** - We don't fake features that don't exist

## 📖 Understanding Queues: A Beginner's Guide

**New to queues?** Read this section first. **Experienced?** Jump to [Quick Start](#quick-start) or [Production Features](#production-features).

### What Is a Queue System?

**Simple Analogy:** Think of a busy restaurant. A waiter (the **Producer**) takes an order and puts it on a ticket spike (the **Queue Provider**). The chef (the **Worker**) picks up the ticket when they're ready and prepares the meal. The waiter can immediately go take another order without waiting for the chef to finish cooking. This system decouples the waiter from the chef, allowing the restaurant to serve more customers efficiently.

**In Software:** A queue system decouples work from your web requests. Instead of doing heavy work inline, you add jobs to a queue and process them in the background:

```
Web Request → Queue.add() → [Provider Storage] → Worker.fetch() → Process
  (instant)                    (Redis/SQS/etc)       (background)
```

**Benefits:**
- **Fast response times** - API returns immediately, work happens later
- **Resilience** - Jobs survive server restarts (stored in Redis/SQS)
- **Scalability** - Add more workers to handle more load
- **Rate limiting** - Control processing speed to avoid overwhelming external APIs

### The Producer-Consumer Pattern

Queue systems use **two separate classes** that communicate through a provider:

> **Note for BullMQ users:** You may notice BullMQ has its own `Queue` and `Worker` classes. This library wraps them! You always use `@satoshibits/queue`'s Queue and Worker - the provider handles the BullMQ classes internally. This abstraction lets you switch providers without changing your code.

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                      │
├──────────────────────┬──────────────────────────────────┤
│   PRODUCER SIDE      │      CONSUMER SIDE               │
│   (Web Server)       │      (Worker Process)            │
│                      │                                  │
│   Queue              │      Worker                      │
│   • add()            │      • fetches jobs              │
│   • getStats()       │      • processes handler         │
│   • pause/resume()   │      • emits events              │
└──────────┬───────────┴────────────┬─────────────────────┘
           │                        │
           └────────────┬───────────┘
                        │
              ┌─────────▼──────────┐
              │  Provider Storage  │
              │  (Redis, SQS, etc) │
              └────────────────────┘
```

**Critical Understanding:**
- **Queue** and **Worker** don't talk directly to each other
- They communicate through the **provider** (Redis, SQS, etc.)
- Can run in separate processes or even separate servers
- Queue pushes jobs in, Worker pulls jobs out

**How They're Deployed:**
```
┌─────────────────────┐          ┌──────────────────┐          ┌─────────────────────┐
│   Your API Server   │          │ Queue Provider   │          │ Your Worker Process │
│ (contains Queue)    │──adds──>│ (Redis/SQS/etc)  │<──fetches──│ (contains Worker)   │
└─────────────────────┘   job    └──────────────────┘    job    └─────────────────────┘
     Process 1                      Shared Storage                    Process 2
```

### Job Lifecycle

Every job goes through these states (from `src/core/types.mts:46-51`):

```typescript
type JobStatus = "waiting" | "delayed" | "active" | "completed" | "failed"
```

**The Flow:**

```
queue.add()
    │
    ▼
┌─────────┐  (if delay option)  ┌─────────┐
│ waiting │ ─────────────────→ │ delayed │
└────┬────┘                     └────┬────┘
     │                               │
     │  ◄────────────────────────────┘
     │  (when delay expires)
     │
     │  worker.fetch()
     ▼
┌────────┐
│ active │  ← job is being processed
└───┬────┘
    │
    ├─→ Success? ──→ ┌───────────┐
    │                │ completed │
    │                └───────────┘
    │
    └─→ Failed? ──┬─→ attempts < maxAttempts? ──→ back to waiting (retry)
                  │
                  └─→ attempts >= maxAttempts? ──→ ┌────────┐
                                                    │ failed │ → DLQ
                                                    └────────┘
```

**State Details:**
- **waiting**: Job is in queue, ready to be picked up
- **delayed**: Job is scheduled for future (will move to waiting when time comes)
- **active**: Worker is currently processing this job
- **completed**: Job succeeded
- **failed**: Job exhausted all retry attempts

### How Queue and Worker Collaborate

**Step-by-step example:**

```typescript
// ========================================
// FILE: api-server.ts (Producer)
// ========================================
import { Queue } from '@satoshibits/queue';

const emailQueue = new Queue('emails');

// When user signs up
app.post('/signup', async (req, res) => {
  const user = await createUser(req.body);

  // Add job to queue (returns immediately)
  await emailQueue.add('send-welcome', {
    userId: user.id,
    email: user.email
  });

  res.json({ success: true }); // ← instant response
});

// ========================================
// FILE: worker.ts (Consumer - separate process!)
// ========================================
import { Worker } from '@satoshibits/queue';

// Worker continuously polls the queue
const emailWorker = new Worker('emails', async (data, job) => {
  console.log(`Processing ${job.name} for user ${data.userId}`);

  // Do the actual work
  await sendEmail(data.email, 'Welcome!');

  // Return Result type
  return Result.ok(undefined);
});

// Listen to lifecycle events
emailWorker.on('completed', (payload) => {
  console.log(`✅ Job ${payload.jobId} completed`);
});

emailWorker.on('failed', (payload) => {
  console.error(`❌ Job ${payload.jobId} failed: ${payload.error}`);
  console.log(`Will retry: ${payload.willRetry}`);
});

emailWorker.on('job.retrying', (payload) => {
  console.log(`🔄 Job ${payload.jobId} retrying (attempt ${payload.attempts}/${payload.maxAttempts})`);
});

// Start processing
await emailWorker.start();
```

**Key Points:**
- Queue and Worker use the **same queue name** (`'emails'`) to find each other
- They can run in different files/processes/servers
- Multiple workers can process the same queue (for parallelism)
- One worker can process multiple queues (create multiple Worker instances)

## 🎯 Division of Responsibilities

Understanding who does what prevents confusion and helps you build robust systems. This library follows a clear responsibility model.

### Tier 1: Your Application's Core Responsibilities

These are **your responsibility**. The library provides hooks (events), but you implement the policy.

| Responsibility | Why It's Yours | How to Implement |
|----------------|----------------|------------------|
| **Business Logic** | Every application is different | Implement in your job handler |
| **Error Classification** | You know which errors are transient | Check error type, throw to retry or return Ok to skip |
| **Idempotency** | You know what "already processed" means | Use job IDs, check DB before processing |
| **Circuit Breaking** | You decide when to stop trying | Track failures in `failed` event, check before processing |
| **Observability (Monitoring & Alerting)** | You define what metrics matter and when to alert | Monitor queue depth, DLQ size, job latency; set up alerts for anomalies |
| **Security** | You know what data is sensitive and who can access what | Don't put secrets in payloads (pass references); perform authorization checks in handlers |
| **Logging** | You decide what's important to log | Use event listeners to log job lifecycle |

**Example: Error Classification**
```typescript
const worker = new Worker('payments', async (data, job) => {
  try {
    await processPayment(data);
    return Result.ok(undefined);
  } catch (error) {
    // YOU classify the error
    if (error.code === 'RATE_LIMIT') {
      throw error; // transient → retry
    } else if (error.code === 'INVALID_CARD') {
      logger.error('Permanent failure', { jobId: job.id, error });
      return Result.ok(undefined); // permanent → don't retry, mark complete
    }
    throw error; // unknown → retry
  }
});

await worker.start();
```

**Example: Circuit Breaking**
```typescript
const breaker = new CircuitBreaker({ threshold: 5, timeout: 60000 });

worker.on('failed', () => breaker.recordFailure());
worker.on('completed', () => breaker.recordSuccess());

const worker = new Worker('payments', async (data) => {
  if (breaker.isOpen()) {
    throw new Error('Circuit open - payment service degraded');
  }
  return processPayment(data);
});
```

### Tier 2: Configuring Library & Provider Features

These features are **available** but you must **configure** them. The library coordinates, the provider executes.

| Feature | Configured Via | What It Does | Provider Support |
|---------|---------------|--------------|------------------|
| **Retries** | `attempts: 3` | Provider re-queues failed jobs. See [Error Classification](#mistake-1-treating-all-errors-the-same) | All providers |
| **Backoff** | `backoff: { type: 'exponential', delay: 1000 }` | Provider delays retries | BullMQ, RabbitMQ (SQS uses fixed) |
| **Delays** | `delay: 5000` | Provider schedules job for future | All providers |
| **Priorities** | `priority: 1` | Provider orders job processing | BullMQ, RabbitMQ (SQS: use separate queues) |
| **DLQ** | Provider config | Provider moves exhausted jobs to DLQ. See [Ignoring the DLQ](#mistake-3-ignoring-the-dead-letter-queue) | All providers (provider-specific setup) |
| **Timeouts** | `timeout: 5000` | Worker marks job as failed after timeout* | Library (all providers) |
| **Job Cancellation** | See [Cancellation Guide](./docs/patterns/job-cancellation.md) | Remove queued jobs, abort active jobs (userland patterns), graceful shutdown | Provider-dependent |
| **Graceful Shutdown** | `worker.close({ finishActiveJobs: true })` | Worker waits for active jobs. See [Forgetting Graceful Shutdown](#mistake-2-forgetting-graceful-shutdown) | Library (all providers) |
| **Events** | `worker.on('failed', ...)` | Get notified at lifecycle points. See [Not Using Events](#mistake-7-not-using-worker-events) | Library (all providers) |
| **Health Checks** | `queue.getHealth()` | Get queue depth, error rate | Provider-dependent |
| **Stats** | `queue.getStats()` | Get job counts by state | Provider-dependent |

**Important Notes:**
- **Timeout caveat**: JavaScript can't cancel async functions. Timeouts mark jobs as failed but don't stop execution. Implement `AbortController` in your handler for true cancellation.
- **Warn-and-degrade**: If you request a feature the provider doesn't support (e.g., `priority` on SQS), you'll get a warning and the option is ignored.

**Example: Full Configuration**
```typescript
await queue.add('process-order', data, {
  // normalized options (library translates to provider)
  attempts: 5,
  priority: 10,
  delay: 60000, // 1 minute
  timeout: 30000, // 30 seconds

  // provider-specific escape hatch
  providerOptions: {
    bullmq: {
      removeOnComplete: 1000,
      stackTraceLimit: 0
    },
    sqs: {
      MessageGroupId: 'orders',
      MessageDeduplicationId: uuid()
    }
  }
});
```

### Tier 3: Handled Automatically by the Library

These are **fully managed** by the library and provider. You don't think about them.

| Responsibility | Handled By | Details |
|----------------|------------|---------|
| **Job Persistence** | Provider | Jobs survive restarts (Redis/SQS stores them) |
| **Concurrency Control** | Library | Worker respects `concurrency` limit, manages parallel execution |
| **Fetch Loop** | Library | Worker continuously polls provider (pull model) |
| **Ack/Nack** | Library + Provider | Worker acknowledges success/failure to provider |
| **Event Emission** | Library | Consistent events emitted at all lifecycle points |
| **Backpressure** | Library | Worker stops fetching when at concurrency limit |
| **Provider Connection** | Provider | Connection pooling, reconnection logic |
| **Job Serialization** | Library + Provider | Jobs are serialized to JSON automatically |
| **Visibility Timeout** | Provider | Provider hides active jobs from other workers |

**What This Means:**
- ✅ You don't write fetch loops
- ✅ You don't manage connection pools
- ✅ You don't track which jobs are "in flight"
- ✅ You don't serialize/deserialize jobs
- ✅ You focus on: *"what should this job do?"*

## ⚠️ Common Mistakes & Best Practices

Learn from others' mistakes. These patterns will save you hours of debugging.

### Mistake 1: Treating All Errors the Same

**Problem:**
```typescript
// ❌ BAD: All errors trigger retry
const worker = new Worker('payments', async (data) => {
  await chargeCustomer(data.cardId); // what if card is invalid?
  return Result.ok(undefined);
});
```

If the customer's card is permanently invalid, retrying 3 times accomplishes nothing. You burn resources and delay the inevitable failure.

**Solution: Classify Errors**
```typescript
// ✅ GOOD: Classify errors
const worker = new Worker('payments', async (data, job) => {
  try {
    await chargeCustomer(data.cardId);
    return Result.ok(undefined);
  } catch (error) {
    // permanent errors - don't retry
    if (error.code === 'CARD_INVALID' || error.code === 'INSUFFICIENT_FUNDS') {
      logger.error('Permanent payment failure', { jobId: job.id, error });
      return Result.ok(undefined); // mark complete, don't retry
    }

    // transient errors - retry
    if (error.code === 'NETWORK_ERROR' || error.code === 'SERVICE_UNAVAILABLE') {
      throw error; // let provider retry
    }

    // unknown error - retry to be safe
    throw error;
  }
});

await worker.start();
```

### Mistake 2: Forgetting Graceful Shutdown

**Problem:**
```typescript
// ❌ BAD: No shutdown logic
const worker = new Worker('emails', sendEmail);
await worker.start();

process.on('SIGTERM', () => {
  process.exit(0); // kills active jobs immediately!
});
```

When your server restarts (deployments, scaling), active jobs get killed mid-processing. This can leave your system in inconsistent states.

**Solution: Graceful Shutdown**
```typescript
// ✅ GOOD: Wait for active jobs
const worker = new Worker('emails', sendEmail);
await worker.start();

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await worker.close({
    timeout: 30000,         // wait up to 30s
    finishActiveJobs: true  // let active jobs complete
  });
  process.exit(0);
});
```

### Mistake 3: Ignoring the Dead Letter Queue

**Problem:**
```typescript
// ❌ BAD: Set up DLQ but never check it
const queue = new Queue('orders', {
  deadLetter: { queue: 'failed-orders', maxAttempts: 3 }
});

// ... jobs fail and pile up in DLQ forever
```

Failed jobs accumulate in your DLQ. You never know about problems until a customer complains.

**Solution: Monitor the DLQ**
```typescript
// ✅ GOOD: Actively monitor DLQ
const queue = new Queue('orders', {
  deadLetter: { queue: 'failed-orders', maxAttempts: 3 }
});

// check DLQ periodically
setInterval(async () => {
  const dlqJobs = await queue.getDLQJobs(100);

  if (dlqJobs.success && dlqJobs.data.length > 0) {
    logger.warn(`${dlqJobs.data.length} jobs in DLQ`, {
      jobs: dlqJobs.data.map(j => ({ id: j.id, error: j.error }))
    });

    // alert ops team if threshold exceeded
    if (dlqJobs.data.length > 50) {
      await alertOps('High DLQ count', { count: dlqJobs.data.length });
    }
  }
}, 60000); // check every minute
```

### Mistake 4: Assuming Immediate Processing

**Problem:**
```typescript
// ❌ BAD: Expect immediate processing
await queue.add('send-email', { userId: 123 });
await sendSlackNotification('Email sent to user 123'); // too early!
```

Queues are **asynchronous**. Adding a job returns immediately, but processing happens later. The email might not send for seconds or minutes.

**Solution: Use Events for Confirmation**
```typescript
// ✅ GOOD: React to completion events
queue.add('send-email', { userId: 123, jobId: 'email-123' });

// in your worker process
worker.on('completed', async (payload) => {
  if (payload.jobId === 'email-123') {
    await sendSlackNotification('Email sent to user 123');
  }
});

// OR: Check job status
const job = await queue.getJob('email-123');
if (job.success && job.data?.status === 'completed') {
  // email was sent
}
```

### Mistake 5: Not Implementing Idempotency

**Problem:**
```typescript
// ❌ BAD: Job runs twice, charges customer twice
const worker = new Worker('payments', async (data) => {
  await chargeCustomer(data.amount);
  return Result.ok(undefined);
});
```

Networks are unreliable. A job might get processed twice (worker crashes after processing but before ack). Without idempotency, you double-charge customers.

**Solution: Make Jobs Idempotent**
```typescript
// ✅ GOOD: Check if already processed
const worker = new Worker('payments', async (data, job) => {
  // check if we already processed this job
  const existingCharge = await db.charges.findOne({ jobId: job.id });

  if (existingCharge) {
    logger.info('Job already processed', { jobId: job.id });
    return Result.ok(undefined); // skip, already done
  }

  // process and record
  const charge = await chargeCustomer(data.amount);
  await db.charges.insert({ jobId: job.id, chargeId: charge.id });

  return Result.ok(undefined);
});

await worker.start();
```

### Mistake 6: Putting Large Payloads in Queue

**Problem:**
```typescript
// ❌ BAD: Embed 5MB file in job data
await queue.add('process-video', {
  videoData: largeVideoBuffer // 5MB!
});
```

Most queue providers have payload limits (SQS: 256KB, Redis: 512MB). Even if allowed, large payloads slow down serialization and network transfer.

**Solution: Store Large Data Separately**
```typescript
// ✅ GOOD: Store file externally, pass reference
const videoUrl = await s3.upload(videoBuffer);

await queue.add('process-video', {
  videoUrl, // just the URL
  userId: 123
});

// worker fetches the file
const worker = new Worker('videos', async (data) => {
  const videoBuffer = await s3.download(data.videoUrl);
  await processVideo(videoBuffer);
  return Result.ok(undefined);
});

await worker.start();
```

### Mistake 7: Not Using Worker Events

**Problem:**
```typescript
// ❌ BAD: No visibility into what's happening
const worker = new Worker('emails', sendEmail);
await worker.start();

// ... jobs fail silently, you have no idea
```

Without event listeners, you're blind to failures, retries, and performance issues.

**Solution: Listen to Events**
```typescript
// ✅ GOOD: Comprehensive event handling
const worker = new Worker('emails', sendEmail);

worker.on('active', (payload) => {
  logger.info('Job started', { jobId: payload.jobId });
});

worker.on('completed', (payload) => {
  logger.info('Job completed', {
    jobId: payload.jobId,
    duration: payload.duration
  });
  metrics.recordJobSuccess(payload.duration);
});

worker.on('failed', (payload) => {
  logger.error('Job failed', {
    jobId: payload.jobId,
    error: payload.error,
    willRetry: payload.willRetry
  });
  metrics.recordJobFailure();
});

worker.on('job.retrying', (payload) => {
  logger.warn('Job retrying', {
    jobId: payload.jobId,
    attempt: payload.attempts,
    maxAttempts: payload.maxAttempts
  });
});

worker.on('queue.error', (payload) => {
  logger.fatal('Queue error', payload.error);
  alertOps('Critical queue error', payload);
});

await worker.start();
```

### Mistake 8: Not Considering Worker Resource Limits

**Problem:**
```typescript
// ❌ BAD: Setting concurrency without considering resources
const worker = new Worker('heavy-jobs', processVideo, {
  concurrency: 100  // can this machine handle 100 concurrent video encodings?
});
```

Setting high concurrency (e.g., 100 concurrent jobs) on a machine that can only handle 10 leads to CPU/memory exhaustion and worker crashes. The library manages concurrency, but you must provision infrastructure appropriately.

**Solution: Load Test and Right-Size**
```typescript
// ✅ GOOD: Set concurrency based on actual capacity
const worker = new Worker('heavy-jobs', processVideo, {
  concurrency: 5  // tested limit for this machine
});

// Monitor resource usage
worker.on('active', () => {
  const usage = process.memoryUsage();
  if (usage.heapUsed > MEMORY_THRESHOLD) {
    logger.warn('High memory usage', { heapUsed: usage.heapUsed });
  }
});

await worker.start();
```

**Best Practices:**
- Load test your workers to find safe concurrency limits for your hardware
- Monitor CPU, memory, and I/O during job processing
- Start conservative (low concurrency) and increase gradually
- Consider job type: CPU-bound jobs need fewer workers than I/O-bound jobs

### Best Practice Checklist

Before going to production, verify:

- [ ] **Error Classification**: Distinguish transient from permanent errors
- [ ] **Graceful Shutdown**: Implement `SIGTERM` handler with `worker.close()`
- [ ] **DLQ Monitoring**: Check dead letter queue regularly
- [ ] **Idempotency**: Jobs can run multiple times safely
- [ ] **Event Listeners**: Log job lifecycle events
- [ ] **Small Payloads**: Store large data externally, pass references
- [ ] **Timeouts**: Set realistic job timeouts
- [ ] **Health Checks**: Expose `/health` endpoint with queue metrics
- [ ] **Alerting**: Alert on high failure rates or DLQ buildup
- [ ] **Resource Limits**: Configure concurrency based on available resources

## Quick Start

**Prerequisites:** Read [Understanding Queues](#-understanding-queues-a-beginners-guide) first if you're new to queues.

### Installation

```bash
npm install @satoshibits/queue
```

### Basic Usage (Development)

Perfect for local development and testing. Uses in-memory provider (zero config).

```typescript
import { Queue, Worker } from '@satoshibits/queue';
import { Result } from '@satoshibits/functional';

// ========================================
// STEP 1: Create Queue (Producer)
// ========================================
const emailQueue = new Queue('emails'); // defaults to in-memory provider

// ========================================
// STEP 2: Add Jobs
// ========================================
await emailQueue.add('send-welcome', {
  userId: 123,
  email: 'user@example.com'
});

console.log('Job added! Processing will happen in worker...');

// ========================================
// STEP 3: Create Worker (Consumer)
// ========================================
const emailWorker = new Worker('emails', async (data, job) => {
  console.log(`Processing ${job.name} for user ${data.userId}`);

  // do the actual work
  await sendEmail(data.email, 'Welcome!');

  // must return Result type
  return Result.ok(undefined);
});

// ========================================
// STEP 4: Listen to Events (optional but recommended)
// ========================================
emailWorker.on('completed', (payload) => {
  console.log(`✅ Job ${payload.jobId} completed in ${payload.duration}ms`);
});

emailWorker.on('failed', (payload) => {
  console.error(`❌ Job ${payload.jobId} failed: ${payload.error}`);
  console.log(`Will retry: ${payload.willRetry}`);
});

// ========================================
// STEP 5: Start Worker
// ========================================
await emailWorker.start();
console.log('Worker started, waiting for jobs...');
```

## Providers

The queue package supports multiple providers. Each provider has optional peer dependencies that you only install if you use that provider.

### Available Providers

| Provider | Import Path | Peer Dependencies | Best For |
|----------|------------|-------------------|----------|
| **Memory** | `@satoshibits/queue` (default) | None | Development, testing |
| **BullMQ** | `@satoshibits/queue/providers/bullmq` | `bullmq`, `ioredis` | Production workhorse |
| **SQS** | `@satoshibits/queue/providers/sqs` | `@aws-sdk/client-sqs` | Serverless, AWS ecosystem |

### Installing Provider Dependencies

**For BullMQ (Redis-backed):**
```bash
npm install bullmq ioredis
# or
pnpm add bullmq ioredis
```

**For SQS (AWS):**
```bash
npm install @aws-sdk/client-sqs
# or
pnpm add @aws-sdk/client-sqs
```

**For Memory (default):**
```bash
# No additional dependencies needed
```

### Production Usage (BullMQ)

```typescript
import { Queue, Worker } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';
import { Result } from '@satoshibits/functional';

// ========================================
// Configure Provider (once per app)
// ========================================
const providerFactory = new BullMQProvider({
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
  // For full config options, see BullMQProviderConfig in src/providers/bullmq/bullmq.provider.mts
});

// ========================================
// Producer Side (API Server)
// ========================================
const queue = new Queue('emails', {
  provider: providerFactory.forQueue('emails')
});

await queue.add('send-welcome', {
  userId: 123,
  email: 'user@example.com'
}, {
  attempts: 3,
  priority: 1,
  delay: 5000,
  timeout: 30000
});

// ========================================
// Consumer Side (Worker Process)
// ========================================
const worker = new Worker('emails',
  async (data, job) => {
    await sendEmail(data.email, 'Welcome!');
    return Result.ok(undefined);
  },
  {
    provider: providerFactory.forQueue('emails'),
    concurrency: 10,
    pollInterval: 100
  }
);

// graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close({ finishActiveJobs: true });
  process.exit(0);
});

await worker.start();
```

### Bull Board Integration (BullMQ Only)

Bull Board is a popular UI dashboard for monitoring BullMQ queues. The `BullMQProvider` exposes underlying BullMQ Queue instances for this purpose:

```typescript
import { Queue } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

// ========================================
// Create provider factory (keep reference!)
// ========================================
const providerFactory = new BullMQProvider({
  connection: { host: 'localhost', port: 6379 }
});

// ========================================
// Create your queues
// ========================================
const emailQueue = new Queue('emails', {
  provider: providerFactory.forQueue('emails')
});
const smsQueue = new Queue('sms', {
  provider: providerFactory.forQueue('sms')
});

// ========================================
// Setup bull-board using the provider factory
// ========================================
const bullQueues = Array.from(providerFactory.getBullMQQueues().values());
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: bullQueues.map(q => new BullMQAdapter(q)),
  serverAdapter
});

// ========================================
// Mount in Express
// ========================================
app.use('/admin/queues', serverAdapter.getRouter());
```

**Important:** Keep a reference to your `BullMQProvider` instance. You'll need it to access the underlying BullMQ queues for monitoring tools.

### Production Usage (SQS)

```typescript
import { Queue, Worker } from '@satoshibits/queue';
import { SQSProvider } from '@satoshibits/queue/providers/sqs';
import { Result } from '@satoshibits/functional';

// ========================================
// Configure Provider
// ========================================
const providerFactory = new SQSProvider({
  region: 'us-east-1',
  // Map queue names to their full SQS URLs upfront
  queueUrls: {
    'emails': 'https://sqs.us-east-1.amazonaws.com/123/emails',
    'notifications': 'https://sqs.us-east-1.amazonaws.com/123/notifications'
  }
  // Credentials loaded from environment/IAM role by default
  // For full config options, see SQSProviderConfig in src/providers/sqs/sqs.provider.mts
});

// ========================================
// Producer Side
// ========================================
const queue = new Queue('emails', {
  provider: providerFactory.forQueue('emails')
});

await queue.add('send-welcome', {
  userId: 123,
  email: 'user@example.com'
}, {
  attempts: 3,
  delay: 5000
});

// ========================================
// Consumer Side
// ========================================
const worker = new Worker('emails',
  async (data, job) => {
    await sendEmail(data.email, 'Welcome!');
    return Result.ok(undefined);
  },
  {
    provider: providerFactory.forQueue('emails'),
    concurrency: 10
  }
);

await worker.start();
```

**Key Differences from Development:**
1. **Provider**: Import from subpath, instantiate with config, use `forQueue()` method
2. **Processes**: Queue and Worker run in separate processes (API vs worker)
3. **Configuration**: Set retries, timeouts, concurrency
4. **Shutdown**: Implement graceful shutdown for deployments

---

**📚 Want a Complete Example?** See [Production Setup Example](./examples/production-setup/README.md) for a runnable demonstration of all best practices covered in this guide (error classification, graceful shutdown, DLQ monitoring, idempotency, events, and more).

## Core Concepts

### 1. Normalized Configuration

Configure common features with a consistent API. We map to native provider capabilities.

```typescript
await queue.add('process-payment', data, {
  // normalized options
  attempts: 3,                    // provider's native retries
  priority: 1,                    // provider's priority queue
  delay: 5000,                    // provider's delay mechanism
  backoff: {
    type: 'exponential',
    delay: 1000
  }
});
```

**Warn-and-Degrade Policy**: If a provider doesn't support a feature, we log a warning and continue:

```
WARNING: SQS provider does not support job priorities.
The 'priority' option will be ignored.
```

No crashes. No fake implementations. Just honesty.

### 2. Event-Driven Architecture

We emit events at key lifecycle points. You implement the policy.

```typescript
// circuit breaking in userland
const breaker = new CircuitBreaker();

const worker = new Worker('jobs', async (data, job) => {
  if (breaker.isOpen()) {
    throw new Error('Circuit open');
  }
  return processJob(data);
});

worker.on('failed', (payload) => {
  breaker.recordFailure();
  logger.error('Job failed', { jobId: payload.jobId, error: payload.error });
});

worker.on('completed', (payload) => {
  breaker.recordSuccess();
});

await worker.start();
```

**Available Events**:
- **Queue events**:
  - `queue.on('queue.paused', ...)` - Queue processing paused
  - `queue.on('queue.resumed', ...)` - Queue processing resumed
  - `queue.on('queue.drained', ...)` - Queue became empty
  - `queue.on('queue.error', ...)` - Error occurred in queue operations
- **Worker events**:
  - `worker.on('active', ...)` - Job processing started
  - `worker.on('completed', ...)` - Job processing succeeded
  - `worker.on('failed', ...)` - Job processing failed
  - `worker.on('job.retrying', ...)` - Job will be retried after failure
  - `worker.on('queue.error', ...)` - Error occurred during job processing
  - `worker.on('processor.shutting_down', ...)` - Worker is shutting down
  - `worker.on('processor.shutdown_timeout', ...)` - Graceful shutdown timeout exceeded

### 3. TypeScript Support

Full type safety with generics:

```typescript
interface EmailJob {
  to: string;
  subject: string;
  body: string;
}

const queue = new Queue<EmailJob>('emails');

// type error if fields missing
await queue.add('send', {
  to: 'user@example.com',
  subject: 'Welcome',
  body: 'Thanks for signing up'
});

const worker = new Worker<EmailJob>('emails', async (data, job) => {
  // data is fully typed as EmailJob
  // job is typed as ActiveJob<EmailJob>
  await sendEmail(data.to, data.subject, data.body);
  return Result.ok(undefined);
});

await worker.start();
```

**Job Handler Signature:**

Job handlers receive two parameters: the job's data payload and an `ActiveJob` object, which contains the data plus persistent state and runtime metadata.

```typescript
type JobHandler<T> = (
  data: T,              // the job's data payload
  job: ActiveJob<T>     // job with persistent state + runtime metadata
) => Promise<Result<void, QueueError | Error>>;
```

**`ActiveJob<T>` vs `Job<T>`:**

The library separates a job's **persistent state** (`Job`) from its **runtime metadata** (`ActiveJob`). `Job` represents what is stored in the queue provider, while `ActiveJob` is what your worker receives when processing. This separation allows for provider-specific runtime details (like SQS receipt handles) without polluting the core job model.

For full details on these interfaces, see `src/core/types.mts`.

**When You Need the `job` Object:**

Most handlers only use `data`. However, you might need the full `job` object for:

```typescript
// accessing job metadata
const worker = new Worker('emails', async (data, job) => {
  console.log(`Processing job ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);

  // access custom metadata
  const userId = job.metadata?.userId;

  await sendEmail(data);
  return Result.ok(undefined);
});

// idempotency checks
const worker = new Worker('payments', async (data, job) => {
  // check if already processed using job.id
  if (await alreadyProcessed(job.id)) {
    return Result.ok(undefined);
  }

  await processPayment(data);
  await markProcessed(job.id);
  return Result.ok(undefined);
});
```

### 4. Escape Hatch

Access provider-specific features when needed:

```typescript
await queue.add('send-email', data, {
  attempts: 3,  // normalized

  // provider-specific options
  providerOptions: {
    bullmq: {
      removeOnComplete: 100,
      stackTraceLimit: 0
    },
    sqs: {
      MessageGroupId: 'emails',
      MessageDeduplicationId: uuid()
    }
  }
});
```

### 5. Provider-Specific Namespaces

For advanced provider-specific features that don't exist across all providers, use the typed namespace pattern:

#### BullMQ-Specific Features

Access BullMQ-specific features through the `queue.bullmq` namespace:

```typescript
import { Queue } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';

const providerFactory = new BullMQProvider({
  connection: { host: 'localhost', port: 6379 }
});

const queue = new Queue('emails', {
  provider: providerFactory.forQueue('emails')
});

// recurring job scheduler (BullMQ only)
const extensions = queue.bullmq;
if (extensions) {
  // create a daily recurring job
  await extensions.upsertJobScheduler('daily-report', {
    pattern: '0 9 * * *',  // cron pattern: 9 AM daily
    jobName: 'generate-report',
    data: { reportType: 'daily' },
    timezone: 'America/New_York',
    jobOptions: {
      priority: 10,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    }
  });

  // list all recurring jobs
  const result = await extensions.getJobSchedulers();
  if (result.success) {
    const schedulers = result.data;
    schedulers.forEach(s => {
      console.log(`Scheduler: ${s.id}`);
      console.log(`Pattern: ${s.pattern}`);
      console.log(`Next run: ${s.next}`);
    });
  }

  // remove a scheduler
  await extensions.removeJobScheduler('daily-report');
}
```

**Key Points:**
- Provider-specific namespaces are **optional** - they return `undefined` for unsupported providers
- Always check if the namespace exists before using it (TypeScript will enforce this)
- Code using provider namespaces is **not portable** across providers
- Use the escape hatch pattern when you need features that don't have multi-provider equivalents

**When to use provider namespaces:**
- ✅ BullMQ's recurring job schedulers (no SQS equivalent)
- ✅ Provider-specific advanced features that don't map across backends
- ❌ Per-job options (use `providerOptions` instead)
- ❌ Features that could be abstracted across providers

#### BullMQ Worker Extensions

Access BullMQ Worker-specific features through the `worker.bullmq` namespace:

```typescript
import { Worker } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';

const provider = new BullMQProvider({
  connection: { host: 'localhost', port: 6379 }
});

const worker = new Worker('my-queue', async (data, job) => {
  // process job
  return { success: true, data: undefined };
}, {
  provider: provider.forQueue('my-queue'),
  concurrency: 5
});

await worker.start();

// access BullMQ-specific worker features
const extensions = worker.bullmq;
if (extensions) {
  // get the underlying BullMQ Worker instance for advanced use cases
  const result = extensions.getBullMQWorker();
  if (result.success && result.data) {
    const bullWorker = result.data;

    // use native BullMQ Worker features not exposed by core API
    const isPaused = await bullWorker.isPaused();
    const isRunning = await bullWorker.isRunning();

    // access worker events not exposed by core API
    bullWorker.on('progress', (job, progress) => {
      console.log(`Job ${job.id} progress: ${progress}%`);
    });

    // use advanced BullMQ Worker features
    const metrics = await bullWorker.getMetrics();
    console.log('Worker metrics:', metrics);
  }
}
```

**Lifecycle Behavior:**

```typescript
// before start() - extensions exist but worker instance is undefined
const ext1 = worker.bullmq?.getBullMQWorker();
// Result.ok(undefined) - no worker yet

await worker.start();

// after start() - worker instance is available
const ext2 = worker.bullmq?.getBullMQWorker();
// Result.ok(BullWorker) - native instance available

await worker.close();

// after close() - worker instance is destroyed
const ext3 = worker.bullmq?.getBullMQWorker();
// Result.ok(undefined) - worker cleaned up
```

**When to use worker extensions:**
- ✅ You need access to BullMQ Worker features not in the core API
- ✅ You're integrating with BullMQ-specific monitoring tools
- ✅ You need fine-grained control over worker behavior
- ✅ You're implementing custom event handlers for BullMQ events
- ❌ Features available through the core Worker API (use core API instead)

## Production Features

### Worker Lifecycle Management

```typescript
const worker = new Worker('jobs', handler, {
  concurrency: 10,     // process 10 jobs in parallel
  batchSize: 5,        // fetch 5 jobs per poll (if provider supports)
  pollInterval: 100,   // poll every 100ms when queue is empty
  errorBackoff: 1000   // wait 1s after errors before retrying
});

// graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close({
    timeout: 30000,         // wait up to 30s for active jobs
    finishActiveJobs: true, // let currently active jobs complete
    disconnectProvider: false // keep provider connected (for shared providers)
  });
  process.exit(0);
});
```

**`Worker.close()` Options:**

- **`timeout`**: `number` (ms) - Max time to wait for active jobs to finish (default: 30s).
- **`finishActiveJobs`**: `boolean` - Whether to wait for active jobs to complete (default: true).
- **`disconnectProvider`**: `boolean` - Whether to disconnect the provider after closing (default: false). Use `true` only when the provider instance is not shared.

**Example with Shared Provider:**

```typescript
// shared provider factory across multiple queues/workers
const providerFactory = new BullMQProvider({ connection: redis });

const emailQueue = new Queue('emails', { provider: providerFactory.forQueue('emails') });
const emailWorker = new Worker('emails', emailHandler, { provider: providerFactory.forQueue('emails') });

const smsQueue = new Queue('sms', { provider: providerFactory.forQueue('sms') });
const smsWorker = new Worker('sms', smsHandler, { provider: providerFactory.forQueue('sms') });

// shutdown workers - keep provider connected
await emailWorker.close({ disconnectProvider: false });
await smsWorker.close({ disconnectProvider: false });

// user explicitly manages shared provider lifecycle
await providerFactory.disconnect();
```

### Queue Lifecycle Management

```typescript
const queue = new Queue('emails', { provider });

// close queue and disconnect owned provider
await queue.close({
  disconnectProvider: true   // disconnect provider (for non-shared providers)
});
```

**`Queue.close()` Options:**

- **`disconnectProvider`**: `boolean` - Disconnect the provider after closing (default: false).

### Observability (Userland Responsibility)

The library provides comprehensive lifecycle events for you to implement observability. How you collect, aggregate, and export metrics is your policy decision.

**OpenTelemetry Integration Example**:
```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

const worker = new Worker('orders', async (data, job) => {
  const span = tracer.startSpan('process-order', {
    attributes: { jobId: job.id, jobName: job.name }
  });

  try {
    await processOrder(data);
    span.setStatus({ code: 0 }); // OK
    return Result.ok(undefined);
  } catch (error) {
    span.setStatus({ code: 2, message: error.message }); // ERROR
    throw error;
  } finally {
    span.end();
  }
});

worker.on('completed', (payload) => {
  tracer.startSpan('job.completed').setAttribute('duration', payload.duration).end();
});

await worker.start();
```

**Prometheus Metrics Example**:
```typescript
import { Counter, Histogram, Gauge, register } from 'prom-client';

const jobsProcessed = new Counter({
  name: 'queue_jobs_processed_total',
  help: 'Total jobs processed',
  labelNames: ['queue', 'status']
});

const jobDuration = new Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Job processing duration',
  labelNames: ['queue', 'job_name']
});

const queueDepth = new Gauge({
  name: 'queue_size',
  help: 'Number of waiting jobs',
  labelNames: ['queue']
});

const worker = new Worker('payments', processPayment);

worker.on('completed', (payload) => {
  jobsProcessed.inc({ queue: 'payments', status: 'completed' });
  jobDuration.observe({ queue: 'payments', job_name: payload.jobName }, payload.duration / 1000);
});

worker.on('failed', (payload) => {
  jobsProcessed.inc({ queue: 'payments', status: 'failed' });
});

// periodically update queue depth
setInterval(async () => {
  const stats = await queue.getStats();
  if (stats.success) {
    queueDepth.set({ queue: 'payments' }, stats.data.waiting);
  }
}, 5000);

// expose at /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

await worker.start();
```

**Why Userland?** Observability strategies vary by organization. By providing events and primitives, you can integrate with your existing monitoring stack (Datadog, New Relic, custom dashboards) without library lock-in.

### Health Checks

```typescript
app.get('/health', async (req, res) => {
  const health = await queue.getHealth();
  res.json({
    status: health.isHealthy ? 'ok' : 'degraded',
    workers: health.activeWorkers,
    waiting: health.queueDepth,
    errorRate: health.errorRate
  });
});
```

### Dead Letter Queues

```typescript
const queue = new Queue('payments', {
  deadLetter: {
    queue: 'failed-payments',  // maps to provider DLQ
    maxAttempts: 5
  }
});

// inspect failed jobs
const failed = await queue.getDeadLetterJobs();
for (const job of failed) {
  console.log(`Failed: ${job.id}`, job.failedReason);

  // optionally retry
  await queue.retryJob(job.id);
}
```

## Supported Providers

| Provider | Import Path | Retries | Priority | Delay | DLQ | Best For |
|----------|-------------|---------|----------|-------|-----|----------|
| **In-Memory** | `@satoshibits/queue` (default) | ✅ | ✅ | ✅ | ✅ | Development, testing |
| **BullMQ** | `@satoshibits/queue/providers/bullmq` | ✅ | ✅ | ✅ | ✅ | Production workhorse |
| **SQS** | `@satoshibits/queue/providers/sqs` | ✅ | ❌ | ✅ | ✅ | Serverless, AWS ecosystem |

**Peer Dependencies:**
- **BullMQ**: Requires `bullmq` and `ioredis`
- **SQS**: Requires `@aws-sdk/client-sqs`
- **Memory**: No dependencies

**Note**: We focus on providers with strong native queue capabilities. We don't ship degraded providers (e.g., PostgreSQL) that lack critical features.

## Common Patterns

### Idempotency

Implement in userland using job IDs:

```typescript
await queue.add('charge-customer', data, {
  jobId: `charge-${customerId}-${month}`  // duplicate IDs are rejected
});

const worker = new Worker('charge-customer', async (data, job) => {
  // check in handler
  if (await alreadyProcessed(job.id)) {
    return Result.ok(undefined);
  }
  await processCharge(data);
  await markProcessed(job.id);
  return Result.ok(undefined);
});

await worker.start();
```

### Circuit Breaking

Respond to failure events:

```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  timeout: 30000
});

const worker = new Worker('api-calls', async (data, job) => {
  if (breaker.isOpen()) {
    throw new Error('Circuit open - service degraded');
  }
  const result = await callExternalAPI(data);
  return Result.ok(result);
});

worker.on('failed', () => breaker.recordFailure());
worker.on('completed', () => breaker.recordSuccess());

await worker.start();
```

### Large Payloads

Handle externally before queueing:

```typescript
async function addJobWithLargePayload(data) {
  const size = JSON.stringify(data).length;

  if (size > 256_000) {  // 256KB (SQS limit)
    const ref = await s3.upload(`jobs/${uuid()}`, data);
    await queue.add('process', { __ref: ref });
  } else {
    await queue.add('process', data);
  }
}

const worker = new Worker('process', async (data, job) => {
  const actualData = data.__ref
    ? await s3.download(data.__ref)
    : data;

  await processData(actualData);
  return Result.ok(undefined);
});

await worker.start();
```

### Poison Pill Handling

**Problem**: A job that consistently crashes the worker can block queue processing.

**Solution**: Use Dead Letter Queues to isolate toxic messages:

```typescript
const queue = new Queue('orders', {
  deadLetter: {
    queue: 'failed-orders',
    maxAttempts: 3  // after 3 failures, move to DLQ
  }
});

// process main queue
const worker = new Worker('orders', async (data, job) => {
  await processOrder(data);
  return Result.ok(undefined);
});

// monitor DLQ for poison pills
const dlqWorker = new Worker('failed-orders', async (data, job) => {
  // log for investigation
  logger.error('Poison pill detected', {
    jobId: job.id,
    data,
    attempts: job.attempts
  });

  // optionally alert ops team
  await alertOps('Toxic message in queue', { jobId: job.id });

  // decide: fix and retry, or permanently discard
  if (shouldRetry(job)) {
    await queue.retryJob(job.id);
  }

  return Result.ok(undefined);
});

await worker.start();
await dlqWorker.start();
```

**Prevention**:
```typescript
const worker = new Worker('orders', async (data, job) => {
  try {
    await processJob(data);
    return Result.ok(undefined);
  } catch (error) {
    // classify errors
    if (isTransientError(error)) {
      throw error;  // let provider retry
    } else {
      // permanent failure - log and complete to avoid retries
      logger.error('Permanent failure', { jobId: job.id, error });
      return Result.ok(undefined); // mark complete, don't retry
    }
  }
});

await worker.start();
```

## Testing Your Application

### Testing Strategy

**Unit Testing:** Your job handler is just a function. Test its business logic in isolation:
```typescript
// test the handler logic directly
it('processes payment correctly', async () => {
  const mockJob = { id: '123', data: { amount: 100, userId: 'user1' }, ... };
  const result = await paymentHandler(mockJob.data, mockJob);

  expect(result.success).toBe(true);
  expect(mockCharge).toHaveBeenCalledWith({ amount: 100, userId: 'user1' });
});
```

**Integration Testing:** For testing the full flow, run the queue provider (e.g., Redis) in a Docker container as part of your test suite. This verifies jobs are enqueued and processed correctly without mocking the library itself.

### Using the In-Memory Provider

The library includes an in-memory provider perfect for testing. It's the default, so no imports needed:

```typescript
import { Queue, Worker } from '@satoshibits/queue';

describe('Order Processing', () => {
  let queue: Queue;
  let worker: Worker;

  beforeEach(() => {
    // no setup required - in-memory provider is default
    queue = new Queue('test-orders');
    worker = new Worker('test-orders', processOrder);
  });

  afterEach(async () => {
    await worker.close();
    await queue.close();
  });

  it('processes orders successfully', async () => {
    const processed: any[] = [];

    const worker = new Worker('test-orders', async (data, job) => {
      processed.push(data);
      return Result.ok(undefined);
    });

    worker.on('completed', () => {});

    await worker.start();
    await queue.add('new-order', { orderId: 123, amount: 99.99 });

    // wait for processing
    await new Promise(resolve => {
      setTimeout(resolve, 100); // give it time to process
    });

    expect(processed).toHaveLength(1);
    expect(processed[0].orderId).toBe(123);
  });

  it('handles failures with retries', async () => {
    let attempts = 0;

    const worker = new Worker('test-orders', async (data, job) => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Transient failure');
      }
      return Result.ok(undefined);
    });

    await worker.start();

    await queue.add('flaky-order', { orderId: 456 }, {
      attempts: 3
    });

    await new Promise(resolve => {
      worker.on('completed', resolve);
    });

    expect(attempts).toBe(3);
  });
});
```

### Integration Tests

Test with real providers in CI:

```typescript
// test/integration/queue.test.ts
import { Queue } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';
import { Redis } from 'ioredis';

describe('Queue with BullMQ', () => {
  let redis: Redis;
  let queue: Queue;
  let providerFactory: BullMQProvider;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL);
    providerFactory = new BullMQProvider({ connection: redis });
    queue = new Queue('test', {
      provider: providerFactory.forQueue('test')
    });
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
  });

  it('persists jobs across restarts', async () => {
    await queue.add('persistent-job', { data: 'test' });

    // simulate restart
    await queue.close();

    // reconnect
    const newQueue = new Queue('test', {
      provider: providerFactory.forQueue('test')
    });

    const metrics = await newQueue.getMetrics();
    expect(metrics.waiting).toBeGreaterThan(0);
  });
});
```

### Mocking the Queue

For unit testing application code that uses the queue:

```typescript
import { vi } from 'vitest';

// mock the queue module
vi.mock('@satoshibits/queue', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: vi.fn().mockResolvedValue(undefined)
  })),
  Worker: vi.fn()
}));

// test application code
it('enqueues order processing', async () => {
  const { Queue } = await import('@satoshibits/queue');
  const mockAdd = vi.mocked(Queue).mock.results[0].value.add;

  await createOrder({ userId: 123, items: [...] });

  expect(mockAdd).toHaveBeenCalledWith('process-order', {
    userId: 123,
    items: expect.any(Array)
  });
});
```

### Library Test Quality

The `@satoshibits/queue` library maintains high test quality standards:

- **Total Tests**: 362 tests (all passing)
- **Test Quality Grade**: A (93/100)
- **Coverage**: Comprehensive unit and integration tests
- **Test Reliability**: All timing dependencies eliminated (behavior-based waiting)
- **Provider Testing**: Memory, BullMQ, and SQS providers fully tested

**Test Categories:**
- Core API tests (Queue, Worker)
- Provider interface tests (Memory, BullMQ, SQS)
- Event lifecycle tests
- Error handling and edge cases
- Integration tests with real providers

See [7-TEST_QUALITY_AUDIT.md](./7-TEST_QUALITY_AUDIT.md) for detailed test quality analysis.

## Provider Capability Matrix

Understanding what each provider supports helps you choose the right one:

| Feature | In-Memory | BullMQ | SQS |
|---------|-----------|--------|-----|
| **Retries** | ✅ In-process | ✅ Native | ✅ Redrive Policy |
| **Backoff** | ✅ Configurable | ✅ Exponential | ❌ Fixed visibility |
| **Priority** | ✅ Heap-based | ✅ Native | ❌ Use separate queues |
| **Delay** | ✅ setTimeout | ✅ Delayed ZSET | ✅ DelaySeconds |
| **DLQ** | ✅ In-memory | ✅ Failed queue | ✅ Redrive to DLQ |
| **Batch Fetch** | ✅ | ✅ LRANGE | ✅ ReceiveMessage |
| **Concurrency** | ✅ In-process | ✅ Multiple workers | ✅ Multiple consumers |
| **Max Payload** | ✅ Unlimited | ✅ 512MB (Redis) | ❌ 256KB |

## Configuration Reference

### Queue Options

Options passed to the `new Queue('name', options)` constructor.

```typescript
const queue = new Queue('emails', {
  provider: myProvider, // required for production
  defaults: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 }
  },
  deadLetter: {
    queue: 'failed-emails',
    maxAttempts: 5
  }
});
```
For a full list of options, see the `QueueOptions` interface in `src/api/queue.mts`.

### Worker Options

Options passed to the `new Worker('name', handler, options)` constructor.
```typescript
const worker = new Worker('emails', handler, {
  provider: myProvider,
  concurrency: 10,
  batchSize: 5
});
```
For a full list of options, see the `WorkerOptions` interface in `src/api/worker.mts`.

## Architecture Philosophy

We follow strict principles to stay lean and honest:

### 1. Translation, Not Reimplementation
We translate your API calls to native provider SDK calls. We don't reimplement retries, state machines, or health monitoring.

### 2. Client-Side Responsibility
We manage the worker process (fetch loop, concurrency, instrumentation). We don't manage backend state (retry scheduling, stale job detection).

### 3. Events Over Implementation
We emit events at key points. You implement policy (circuit breaking, idempotency, logging).

### 4. Honest Abstractions
We don't virtualize features. If a provider lacks a capability, we warn you—we don't fake it.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architectural principles.

## Migration Guide

### From BullMQ

```typescript
// Before (BullMQ)
import { Queue, Worker } from 'bullmq';

const queue = new Queue('jobs', { connection: redis });
await queue.add('process', data, { attempts: 3 });

const worker = new Worker('jobs', async (job) => {
  await processJob(job.data);
  return { success: true };
}, { connection: redis });

// After (@satoshibits/queue)
import { Queue, Worker } from '@satoshibits/queue';
import { BullMQProvider } from '@satoshibits/queue/providers/bullmq';
import { Result } from '@satoshibits/functional';

const providerFactory = new BullMQProvider({ connection: redis });

const queue = new Queue('jobs', { provider: providerFactory.forQueue('jobs') });
await queue.add('process', data, { attempts: 3 });

const worker = new Worker('jobs', async (data, job) => {
  await processJob(data);
  return Result.ok(undefined);
}, { provider: providerFactory.forQueue('jobs') });

await worker.start();
```

### From AWS SQS SDK

```typescript
// Before (SQS SDK)
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'us-east-1' });
await sqs.send(new SendMessageCommand({
  QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/jobs',
  MessageBody: JSON.stringify(data)
}));

// After (@satoshibits/queue)
import { Queue } from '@satoshibits/queue';
import { SQSProvider } from '@satoshibits/queue/providers/sqs';

const providerFactory = new SQSProvider({
  region: 'us-east-1',
  queueUrls: {
    'jobs': 'https://sqs.us-east-1.amazonaws.com/123/jobs'
  }
});

const queue = new Queue('jobs', {
  provider: providerFactory.forQueue('jobs')
});
await queue.add('process', data);
```

## Performance

Expected characteristics with Redis/BullMQ provider:

- **Throughput**: 100,000+ jobs/second
- **Latency**: < 1ms job pickup time
- **Memory**: Bounded by concurrency settings
- **Scalability**: Tested with 10M+ jobs

Performance varies by provider and configuration.

## Contributing

We welcome contributions! Areas of interest:

- Additional provider implementations (Kafka, Google Pub/Sub, etc.)
- Performance optimizations
- Documentation improvements
- Bug reports and fixes

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Resources

- 📖 [Architecture Guide](./ARCHITECTURE.md)
- 📝 [Architecture Audit](./ARCHITECTURE_AUDIT.md) - Deep analysis and rationale
- 🚫 [Job Cancellation Patterns](./docs/patterns/job-cancellation.md) - Comprehensive guide to job cancellation (removal, abortion, timeouts)
- 🐛 [Issue Tracker](https://github.com/satoshibits/queue/issues)
- 💬 [Discussions](https://github.com/satoshibits/queue/discussions)

## License

MIT - Use it however you want.

---

**Philosophy**: We're a thin, honest translation layer. We get out of your way and let you leverage the strengths of battle-tested queue providers.
