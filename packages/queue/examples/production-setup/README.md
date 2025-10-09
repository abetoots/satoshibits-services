# Production-Grade Queue Example

Living demonstration of [@satoshibits/queue](../../README.md) best practices.

## Quick Start

**Prerequisites:** Docker installed (for Redis)

### Step 1: Install Dependencies

From workspace root:

```bash
npm install
```

### Step 2: Navigate to Example Directory

```bash
cd packages/queue/examples/production-setup
```

### Step 3: Start Redis

```bash
npm run start:redis
```

Wait for Redis to be ready (you'll see "Ready to accept connections" in logs).

### Step 4: Start Worker (Terminal 1)

```bash
npm run start:worker
```

You should see: "✅ Connected to Redis" and "👷 Worker started, waiting for jobs..."

### Step 5: Start API Server (Terminal 2)

Open a new terminal in the same directory and run:

```bash
npm run start:producer
```

You should see: "✅ Connected to Redis" and "🚀 Producer API started"

### Step 6: Test It!

In a third terminal:

```bash
# Queue a welcome email
npm run test:signup

# Queue email with attachment (demonstrates small payloads pattern)
npm run test:signup-attachment

# Simulate errors
npm run test:transient   # will retry 3 times
npm run test:permanent   # won't retry
```

Watch the worker logs to see jobs being processed!

---

## What This Demonstrates

Each pattern links to the main README with exact line numbers in code:

### Core Patterns

**[Error Classification](../../README.md#mistake-1-treating-all-errors-the-same)** → `src/email-handler.ts:47-68`

- Transient errors (retry): Network timeouts, rate limits
- Permanent errors (skip): Invalid email, bounced messages

**[Graceful Shutdown](../../README.md#mistake-2-forgetting-graceful-shutdown)** → `src/worker.ts:68-77`

- SIGTERM handler
- Waits for active jobs to complete

**[DLQ Monitoring](../../README.md#mistake-3-ignoring-the-dead-letter-queue)** → `src/worker.ts:54-63`

- Checks DLQ on startup
- Logs failed jobs for investigation

**[Idempotency](../../README.md#mistake-5-not-implementing-idempotency)** → `src/producer.ts:43-52`

- Deterministic job IDs (`welcome-${userId}`)
- Prevents duplicate jobs

**[Small Payloads](../../README.md#mistake-6-putting-large-payloads-in-queue)** → `src/producer.ts:103-151`, `src/email-handler.ts:30-44`

- Store large data externally (S3, blob storage)
- Pass URL references in job payloads, not raw data
- Worker fetches attachment from URL when needed

**[Security](../../README.md#tier-1-your-applications-core-responsibilities)** → `src/email-handler.ts:21-26`

- Credentials from env vars
- No secrets in job payloads

**[Event Handling](../../README.md#mistake-7-not-using-worker-events)** → `src/worker.ts:20-48`

- Monitors: active, completed, failed, retrying
- Structured logging for observability

**[Queue/Worker Separation](../../README.md#how-queue-and-worker-collaborate)** → `src/producer.ts` + `src/worker.ts`

- Producer (API) and Consumer (Worker) in separate processes
- Communicate via shared storage (Redis/In-Memory)

**[Worker Resource Limits](../../README.md#mistake-8-not-considering-worker-resource-limits)** → `src/worker.ts:14`

- Concurrency configured based on capacity

---

## How It Works

```
User Request → API Server → Queue.add() → Provider Storage
                                            ↓
                                  Worker.fetch() → Process → Success/Fail
```

1. **API Server** (`producer.ts`): Receives requests, creates jobs
2. **Provider**: Stores jobs persistently (in-memory for demo, Redis for production)
3. **Worker** (`worker.ts`): Fetches and processes jobs
4. **Handler** (`email-handler.ts`): Business logic with error handling

---

## File Structure

```
src/
├── types.ts           # Shared TypeScript types
├── logger.ts          # Structured logging setup (Pino)
├── email-handler.ts   # Job processing logic + error classification
├── producer.ts        # API server (Queue usage)
└── worker.ts          # Worker process (Consumer usage)
```

---

## Simulating Real Scenarios

### Test Idempotency

```bash
# Try adding same user twice - second request uses same job ID
curl -X POST http://localhost:3000/signup -H "Content-Type: application/json" -d '{"userId":"123","email":"user@example.com"}'
curl -X POST http://localhost:3000/signup -H "Content-Type: application/json" -d '{"userId":"123","email":"user@example.com"}'
```

Watch worker logs - job only processes once!

### Test Small Payloads (External Storage Pattern)

```bash
# Queue email with attachment URL (not raw data)
npm run test:signup-attachment
```

Watch worker logs - you'll see:

1. "Simulating attachment upload to external storage" (producer side)
2. "Fetching attachment from external storage" (worker side)
3. Email sent with attachment size logged

This demonstrates the **correct pattern**: store large files externally, pass URL references in job payloads.

### Test Error Classification

```bash
# Transient error - worker retries 3 times
curl http://localhost:3000/simulate-error?type=transient

# Permanent error - worker won't retry
curl http://localhost:3000/simulate-error?type=permanent
```

### Test Graceful Shutdown

1. Start worker: `npm run start:worker`
2. Queue a job: `npm run test:signup`
3. While job is processing, send SIGTERM: `Ctrl+C`
4. Worker waits for job to complete before exiting!

---

## Troubleshooting

**Redis not starting?**

- Ensure Docker is running: `docker ps`
- Check port 6379 is available: `lsof -i :6379`
- Try: `docker-compose down && docker-compose up -d`

**Worker not processing jobs?**

- Verify both producer and worker are using same queue name (`emails`)
- Check worker logs for errors
- Ensure dependencies are installed: `pnpm install`

**Jobs failing immediately?**

- Check worker logs for error details
- Verify env vars are set (copy `.env.example` to `.env` if needed)

**ESM import errors?**

- Ensure `"type": "module"` in package.json
- Use `.js` extensions in imports (even for `.ts` files)

---

## Production Deployment

This example already uses **Redis with BullMQ** - it's production-ready! 🚀

### What's Already Configured

✅ **Persistent Storage**: Jobs survive server restarts (stored in Redis)
✅ **Shared Provider**: Both producer and worker use the same Redis instance (`src/provider.ts`)
✅ **Connection Pooling**: Optimized Redis connection settings
✅ **Error Handling**: Redis connection events are monitored

### For Testing Without Docker

If you need to test without Redis/Docker (e.g., in CI), you can temporarily use the in-memory provider:

```typescript
// src/provider.ts (for testing only)
import { MemoryProvider } from "@satoshibits/queue";

export const provider = new MemoryProvider();
```

**Note**: MemoryProvider is not persistent and doesn't support multi-node deployments.

### Add Real Email Sending

Replace mock in `email-handler.ts` with actual SMTP:

```typescript
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

await transporter.sendMail({
  from: process.env.SMTP_USER,
  to: data.email,
  subject: "Welcome!",
  text: `Welcome user ${data.userId}!`,
});
```

---

## Next Steps

- [ ] Add metrics/monitoring (Prometheus, DataDog)
- [ ] Implement database for idempotency checks
- [ ] Set up CI/CD for worker deployment
- [ ] Add more job types (password reset, notifications, etc.)
- [ ] Implement Bull Board for job visualization
- [ ] Add health check endpoints

---

## Learn More

- [Main README](../../README.md) - Full documentation
- [Architecture Guide](../../ARCHITECTURE.md) - Design principles
- [Implementation Plan](./IMPLEMENTATION_PLAN.md) - Detailed plan for this example
