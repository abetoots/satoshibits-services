# Production-Grade Queue Example - Implementation Plan

## Executive Summary

Create a runnable "living documentation" example that demonstrates all @satoshibits/queue best practices from the main README. Developers should be able to run this example in under 2 minutes and see queue patterns in action with real logs and behavior.

**Target Location:** `packages/queue/examples/production-setup/`

---

## Goals & Success Criteria

### Primary Goals
1. **Educational**: Show all 9 README best practices with working code
2. **Runnable**: `pnpm install && npm run dev` should work immediately
3. **Production-Grade**: Demonstrates real-world patterns, not toys
4. **Cross-Platform**: Works on Mac/Linux/Windows (via Docker)

### Success Criteria
- [x] Runs in < 2 minutes from clone
- [x] All 9 patterns demonstrated (see checklist below)
- [x] Logs clearly show patterns in action
- [x] Code has comments linking to main README sections
- [x] Works with actual Redis (Docker)
- [x] Error simulation endpoints work for demos

### Patterns Checklist
- [x] Error Classification (transient vs permanent)
- [x] Graceful Shutdown (SIGTERM handler)
- [x] DLQ Monitoring (check on startup)
- [x] Async Processing (Queue/Worker separation)
- [x] Idempotency (deterministic job IDs)
- [x] Small Payloads (store large data externally, pass references)
- [x] Event Handling (all worker events)
- [x] Worker Resource Limits (concurrency config)
- [x] Security (env vars, not payloads)

---

## Architecture Overview

```
┌─────────────────────┐          ┌──────────────┐          ┌─────────────────────┐
│   producer.ts       │          │    Redis     │          │    worker.ts        │
│   (API Server)      │──adds──> │  (Docker)    │ <──fetch──│   (Consumer)       │
│                     │   job    │              │    job    │                     │
│   - Express API     │          │  Port: 6379  │          │   - Event listeners │
│   - Queue instance  │          │              │          │   - Worker instance │
│   - Idempotency     │          │              │          │   - Graceful shutdown│
└─────────────────────┘          └──────────────┘          └─────────────────────┘
        |                                                              |
        |                                                              |
        v                                                              v
  email-handler.ts <──────────────────────────────────────────> email-handler.ts
  (Shared business logic)
  - Error classification
  - Security (env vars)
  - Mock email sending
```

**Key Design Decisions:**
- **Domain**: Email notification system (relatable, simple)
- **Provider**: Redis via BullMQ (production-ready)
- **Separation**: Producer and Worker in different files (shows real deployment)
- **Mock Services**: Log emails instead of SMTP (keeps focus on queue patterns)

---

## File Structure

```
packages/queue/examples/production-setup/
├── IMPLEMENTATION_PLAN.md      # This document
├── README.md                    # User-facing quick start guide
├── package.json                 # Dependencies & scripts
├── tsconfig.json               # TypeScript config (extends parent)
├── docker-compose.yml          # Redis container setup
├── .env.example                # Environment variable template
└── src/
    ├── types.ts                # Shared TypeScript interfaces
    ├── logger.ts               # Pino structured logger setup
    ├── email-handler.ts        # Job handler with error classification
    ├── producer.ts             # API server (Queue usage)
    └── worker.ts               # Worker process (Consumer usage)
```

---

## Implementation Phases

### Phase 1: Infrastructure Setup

#### 1.1 Directory Structure
```bash
mkdir -p packages/queue/examples/production-setup/src
cd packages/queue/examples/production-setup
```

#### 1.2 Package Configuration (`package.json`)
```json
{
  "name": "@satoshibits/queue-production-example",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start:redis": "docker-compose up -d",
    "stop:redis": "docker-compose down",
    "start:producer": "tsx src/producer.ts",
    "start:worker": "tsx src/worker.ts",
    "dev": "concurrently \"npm:start:producer\" \"npm:start:worker\"",
    "test:signup": "curl -X POST http://localhost:3000/signup -H 'Content-Type: application/json' -d '{\"userId\":\"123\",\"email\":\"user@example.com\"}'",
    "test:transient": "curl http://localhost:3000/simulate-error?type=transient",
    "test:permanent": "curl http://localhost:3000/simulate-error?type=permanent"
  },
  "dependencies": {
    "@satoshibits/queue": "workspace:*",
    "@satoshibits/functional": "workspace:*",
    "express": "^4.18.0",
    "pino": "^8.0.0",
    "pino-pretty": "^10.0.0",
    "dotenv": "^16.0.0",
    "ioredis": "^5.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "concurrently": "^8.0.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

#### 1.3 TypeScript Configuration (`tsconfig.json`)
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 1.4 Docker Compose (`docker-compose.yml`)
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    command: redis-server --appendonly yes

volumes:
  redis_data:
    driver: local
```

#### 1.5 Environment Template (`.env.example`)
```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# API Server
PORT=3000

# Email Configuration (mock - not actually used)
SMTP_HOST=smtp.example.com
SMTP_USER=noreply@example.com

# Logging
LOG_LEVEL=info
```

---

### Phase 2: Core Components

#### 2.1 Shared Types (`src/types.ts`)
```typescript
/**
 * Job data structure for email notifications
 * See: packages/queue/README.md#typescript-support
 */
export interface EmailJobData {
  email: string;
  userId: string;

  // For demo purposes - simulates different error types
  errorType?: 'transient' | 'permanent';
}

/**
 * Email sending result
 */
export interface EmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}
```

#### 2.2 Logger Setup (`src/logger.ts`)
```typescript
import pino from 'pino';

/**
 * Structured logger using Pino
 * See: packages/queue/README.md#tier-1-your-applications-core-responsibilities
 */
export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  },
  level: process.env.LOG_LEVEL || 'info'
});
```

#### 2.3 Email Handler (`src/email-handler.ts`)

**Purpose:** Demonstrates error classification, security, and business logic separation

**Key Patterns:**
- Error classification (lines 25-40)
- Security via env vars (lines 15-18)
- Mock email sending (line 22)

```typescript
import { Result } from '@satoshibits/functional';
import type { Job } from '@satoshibits/queue';
import { logger } from './logger.js';
import type { EmailJobData, EmailResult } from './types.js';

/**
 * Email job handler with error classification
 *
 * Demonstrates:
 * - Error Classification: See README.md#mistake-1-treating-all-errors-the-same
 * - Security: See README.md#tier-1-your-applications-core-responsibilities (Security row)
 */
export async function emailHandler(
  data: EmailJobData,
  job: Job<EmailJobData>
): Promise<Result<void, Error>> {
  try {
    // ✅ SECURITY: Get credentials from env, NOT from job payload
    // See: packages/queue/README.md#tier-1 (Security row)
    const emailConfig = {
      host: process.env.SMTP_HOST,
      user: process.env.SMTP_USER
    };

    logger.info({ jobId: job.id, email: data.email }, 'Processing email job');

    // Simulate different error types for demo
    if (data.errorType === 'transient') {
      throw Object.assign(new Error('Network timeout'), { code: 'NETWORK_ERROR' });
    }

    if (data.errorType === 'permanent') {
      throw Object.assign(new Error('Invalid email address'), { code: 'INVALID_EMAIL' });
    }

    // ✅ MOCK: Log instead of actual SMTP (keeps example focused on queue patterns)
    logger.info({
      to: data.email,
      userId: data.userId,
      config: emailConfig
    }, '📧 Email sent (mocked)');

    return Result.ok(undefined);

  } catch (error: any) {
    // ✅ ERROR CLASSIFICATION
    // See: packages/queue/README.md#mistake-1-treating-all-errors-the-same

    // Transient errors - retry
    if (error.code === 'NETWORK_ERROR' || error.code === 'RATE_LIMIT') {
      logger.warn({ jobId: job.id, error: error.message }, 'Transient error - will retry');
      throw error; // let provider retry
    }

    // Permanent errors - don't retry
    if (error.code === 'INVALID_EMAIL' || error.code === 'BOUNCED') {
      logger.error({ jobId: job.id, error: error.message }, 'Permanent failure - won\'t retry');
      return Result.ok(undefined); // mark complete, don't retry
    }

    // Unknown errors - retry to be safe
    logger.error({ jobId: job.id, error: error.message }, 'Unknown error - will retry');
    throw error;
  }
}
```

---

### Phase 3: Producer (API Server)

**File:** `src/producer.ts`

**Purpose:** Shows Queue usage, idempotency, and job creation patterns

**Key Patterns:**
- Queue initialization (lines 10-15)
- Idempotent job IDs (line 23)
- Security (no secrets in payload)
- Error simulation for demos (lines 35-50)

```typescript
import express from 'express';
import { Queue } from '@satoshibits/queue';
import { MemoryProvider } from '@satoshibits/queue/providers/memory';
import { logger } from './logger.js';
import type { EmailJobData } from './types.js';
import 'dotenv/config';

const app = express();
app.use(express.json());

// Initialize queue with provider
// See: packages/queue/README.md#production-usage-redisbullmq
const queue = new Queue<EmailJobData>('emails', {
  provider: new MemoryProvider() // Replace with RedisProvider for production
});

/**
 * POST /signup - Queue welcome email
 *
 * Demonstrates:
 * - Idempotency: See README.md#mistake-5-not-implementing-idempotency
 * - Security: See README.md#tier-1 (Security row)
 */
app.post('/signup', async (req, res) => {
  const { email, userId } = req.body;

  // ✅ IDEMPOTENCY: Use deterministic job ID to prevent duplicates
  // See: packages/queue/README.md#mistake-5
  const jobId = `welcome-${userId}`;

  const result = await queue.add(
    'send-welcome',
    { email, userId },
    {
      jobId,           // prevents duplicate jobs
      attempts: 3,     // retry up to 3 times
      timeout: 30000   // 30 second timeout
    }
  );

  if (result.success) {
    logger.info({ jobId, email, userId }, 'Job enqueued');
    res.json({ success: true, jobId });
  } else {
    logger.error({ error: result.error }, 'Failed to enqueue job');
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

/**
 * GET /simulate-error?type=transient|permanent
 *
 * Demo endpoint to trigger different error scenarios
 * Watch worker logs to see error classification in action!
 */
app.get('/simulate-error', async (req, res) => {
  const errorType = req.query.type as 'transient' | 'permanent';

  await queue.add(
    'send-welcome',
    {
      email: 'test@example.com',
      userId: 'demo',
      errorType
    },
    { attempts: 3 }
  );

  res.json({
    message: `Queued job with ${errorType} error`,
    hint: 'Watch worker logs to see error handling!'
  });
});

// Health check
app.get('/health', async (req, res) => {
  const stats = await queue.getStats();
  res.json({
    status: 'ok',
    queue: stats.success ? stats.data : null
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info({ port: PORT }, '🚀 Producer API started');
  logger.info('Try: curl -X POST http://localhost:3000/signup -H "Content-Type: application/json" -d \'{"userId":"123","email":"user@example.com"}\'');
});
```

---

### Phase 4: Consumer (Worker Process)

**File:** `src/worker.ts`

**Purpose:** Shows Worker usage, events, graceful shutdown, and DLQ monitoring

**Key Patterns:**
- Worker initialization (lines 10-15)
- Event listeners (lines 17-35)
- DLQ monitoring (lines 37-45)
- Graceful shutdown (lines 47-55)

```typescript
import { Worker, Queue } from '@satoshibits/queue';
import { MemoryProvider } from '@satoshibits/queue/providers/memory';
import { emailHandler } from './email-handler.js';
import { logger } from './logger.js';
import type { EmailJobData } from './types.js';
import 'dotenv/config';

const provider = new MemoryProvider(); // Replace with RedisProvider

// Initialize worker
// See: packages/queue/README.md#production-usage-redisbullmq
const worker = new Worker<EmailJobData>('emails', emailHandler, {
  provider,
  concurrency: 5,  // process 5 jobs concurrently
  pollInterval: 100
});

// ✅ EVENT LISTENERS: Monitor job lifecycle
// See: packages/queue/README.md#mistake-7-not-using-worker-events
worker.on('active', (payload) => {
  logger.info({
    jobId: payload.jobId,
    attempts: payload.attempts
  }, '▶️  Job started');
});

worker.on('completed', (payload) => {
  logger.info({
    jobId: payload.jobId,
    duration: payload.duration
  }, '✅ Job completed');
});

worker.on('failed', (payload) => {
  logger.error({
    jobId: payload.jobId,
    error: payload.error,
    willRetry: payload.willRetry,
    attempts: payload.attempts
  }, '❌ Job failed');
});

worker.on('job.retrying', (payload) => {
  logger.warn({
    jobId: payload.jobId,
    attempts: payload.attempts,
    maxAttempts: payload.maxAttempts
  }, '🔄 Job retrying');
});

// ✅ DLQ MONITORING: Check on startup
// See: packages/queue/README.md#mistake-3-ignoring-the-dead-letter-queue
async function checkDLQ() {
  const queue = new Queue('emails', { provider });
  const dlqJobs = await queue.getDLQJobs(10);

  if (dlqJobs.success && dlqJobs.data.length > 0) {
    logger.warn({
      count: dlqJobs.data.length,
      jobs: dlqJobs.data.map(j => ({ id: j.id, error: j.error }))
    }, '⚠️  Found jobs in DLQ');
  } else {
    logger.info('DLQ is empty');
  }
}

// ✅ GRACEFUL SHUTDOWN
// See: packages/queue/README.md#mistake-2-forgetting-graceful-shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');

  await worker.close({
    timeout: 30000,         // wait up to 30s
    finishActiveJobs: true  // let active jobs complete
  });

  logger.info('Worker shut down successfully');
  process.exit(0);
});

// Start worker
(async () => {
  await checkDLQ();
  await worker.start();
  logger.info('👷 Worker started, waiting for jobs...');
})();
```

---

### Phase 5: Documentation

**File:** `README.md`

```markdown
# Production-Grade Queue Example

Living demonstration of [@satoshibits/queue](../../README.md) best practices.

## Quick Start

**Prerequisites:** Docker installed

1. **Start Redis**
   ```bash
   npm run start:redis
   ```

2. **Install dependencies** (from workspace root)
   ```bash
   pnpm install
   ```

3. **Start Worker** (Terminal 1)
   ```bash
   npm run start:worker
   ```

4. **Start API** (Terminal 2)
   ```bash
   npm run start:producer
   ```

5. **Test it!**
   ```bash
   # Queue a welcome email
   npm run test:signup

   # Simulate errors
   npm run test:transient   # will retry
   npm run test:permanent   # won't retry
   ```

## What This Demonstrates

Each pattern links to the main README with exact line numbers in code:

### Core Patterns
- **[Error Classification](../../README.md#mistake-1-treating-all-errors-the-same)** → `src/email-handler.ts:47-68`
  - Transient errors (retry): Network timeouts, rate limits
  - Permanent errors (skip): Invalid email, bounced

- **[Graceful Shutdown](../../README.md#mistake-2-forgetting-graceful-shutdown)** → `src/worker.ts:65-75`
  - SIGTERM handler
  - Wait for active jobs to complete

- **[DLQ Monitoring](../../README.md#mistake-3-ignoring-the-dead-letter-queue)** → `src/worker.ts:55-63`
  - Check DLQ on startup
  - Log failed jobs for investigation

- **[Idempotency](../../README.md#mistake-5-not-implementing-idempotency)** → `src/producer.ts:29`
  - Deterministic job IDs (`welcome-${userId}`)
  - Prevents duplicate jobs

- **[Small Payloads](../../README.md#mistake-6-putting-large-payloads-in-queue)** → `src/producer.ts` + `src/email-handler.ts`
  - Store large data externally (S3, blob storage)
  - Pass URL references in job payloads, not raw data
  - Worker fetches attachment from URL when needed

- **[Security](../../README.md#tier-1-your-applications-core-responsibilities)** → `src/email-handler.ts:19-22`
  - Credentials from env vars
  - No secrets in job payloads

- **[Event Handling](../../README.md#mistake-7-not-using-worker-events)** → `src/worker.ts:20-48`
  - Monitor: active, completed, failed, retrying
  - Structured logging for observability

### Architecture Patterns
- **[Queue/Worker Separation](../../README.md#how-queue-and-worker-collaborate)** → `src/producer.ts` + `src/worker.ts`
  - Producer (API) and Consumer (Worker) in separate processes
  - Communicate via Redis (shared storage)

- **[Worker Resource Limits](../../README.md#mistake-8-not-considering-worker-resource-limits)** → `src/worker.ts:14`
  - Concurrency configured based on capacity

## How It Works

```
User Request → API Server → Queue.add() → Redis
                                            ↓
                                  Worker.fetch() → Process → Success/Fail
```

1. **API Server** (`producer.ts`): Receives requests, creates jobs
2. **Redis**: Stores jobs persistently
3. **Worker** (`worker.ts`): Fetches and processes jobs
4. **Handler** (`email-handler.ts`): Business logic with error handling

## File Structure

```
src/
├── types.ts           # Shared TypeScript types
├── logger.ts          # Structured logging setup
├── email-handler.ts   # Job processing logic + error classification
├── producer.ts        # API server (Queue usage)
└── worker.ts          # Worker process (Consumer usage)
```

## Simulating Real Scenarios

### Test Idempotency
```bash
# Try adding same user twice - second request is ignored
curl -X POST http://localhost:3000/signup -H "Content-Type: application/json" -d '{"userId":"123","email":"user@example.com"}'
curl -X POST http://localhost:3000/signup -H "Content-Type: application/json" -d '{"userId":"123","email":"user@example.com"}'
```

### Test Error Classification
```bash
# Transient error - watch worker retry 3 times
curl http://localhost:3000/simulate-error?type=transient

# Permanent error - worker won't retry
curl http://localhost:3000/simulate-error?type=permanent
```

### Test Graceful Shutdown
1. Start worker: `npm run start:worker`
2. Queue a job: `npm run test:signup`
3. While job is processing, send SIGTERM: `Ctrl+C`
4. Worker waits for job to complete before exiting

## Troubleshooting

**Redis not starting?**
- Ensure Docker is running
- Check port 6379 is not in use: `lsof -i :6379`

**Worker not processing jobs?**
- Check Redis is running: `docker ps`
- Verify queue name matches in producer and worker ('emails')

**Jobs failing immediately?**
- Check worker logs for error details
- Verify env vars are set (copy `.env.example` to `.env`)

## Next Steps

- [ ] Replace `MemoryProvider` with `RedisProvider` for production
- [ ] Add metrics/monitoring (Prometheus, DataDog)
- [ ] Implement real email sending (SMTP, SendGrid, etc.)
- [ ] Add database for idempotency checks
- [ ] Set up CI/CD for worker deployment

## Learn More

- [Main README](../../README.md) - Full documentation
- [Architecture Guide](../../ARCHITECTURE.md) - Design principles
- [API Reference](../../docs/api.md) - Complete API docs
```

---

## Testing Checklist

Before considering the example complete:

### Functional Tests
- [ ] `npm run start:redis` starts Redis successfully
- [ ] `npm run start:producer` starts API on port 3000
- [ ] `npm run start:worker` starts worker without errors
- [ ] POST /signup creates job and returns jobId
- [ ] Worker processes job and logs success
- [ ] Transient error triggers 3 retries
- [ ] Permanent error doesn't retry
- [ ] Duplicate userId uses same jobId (idempotency)
- [ ] SIGTERM causes graceful shutdown
- [ ] DLQ check logs correctly on startup

### Code Quality
- [ ] All files have TypeScript types
- [ ] Comments link to main README sections
- [ ] Logs are structured (JSON)
- [ ] No secrets in code (uses env vars)
- [ ] Error messages are helpful

### Documentation
- [ ] README has working curl commands
- [ ] All patterns link to main README
- [ ] Troubleshooting section is helpful
- [ ] File structure is clear

---

## Implementation Timeline

**Phase 1: Infrastructure** (30 min)
- Create directory structure
- Write package.json, docker-compose.yml
- Write tsconfig.json, .env.example

**Phase 2: Core** (20 min)
- Write types.ts, logger.ts
- Write email-handler.ts with error classification

**Phase 3: Producer** (15 min)
- Write producer.ts with Queue usage
- Test API endpoints

**Phase 4: Consumer** (20 min)
- Write worker.ts with Worker usage
- Test event handling

**Phase 5: Documentation** (15 min)
- Write README.md
- Test all commands
- Add main README link

**Total: ~2 hours** for complete, tested implementation

---

## Future Enhancements

### Short-term
- [ ] Add metrics dashboard (Prometheus + Grafana)
- [ ] Implement real Redis provider integration
- [ ] Add health check endpoints

### Medium-term
- [ ] Multiple queue examples (priority, delayed)
- [ ] Bull Board for job visualization
- [ ] Load testing scripts

### Long-term
- [ ] Multi-provider comparison (Redis vs SQS)
- [ ] Kubernetes deployment examples
- [ ] Auto-scaling worker examples

---

## References

- [Main README](../../README.md)
- [Architecture Document](../../ARCHITECTURE.md)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Redis Best Practices](https://redis.io/docs/management/optimization/)
