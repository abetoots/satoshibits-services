# CLI & Background Worker Examples

This directory contains examples demonstrating observability patterns for **non-HTTP workloads**:
- CLI scripts (data migrations, batch jobs)
- Background workers (queue processing, scheduled tasks)
- Long-running processes without request/response cycles

## Why These Examples?

While the web backend and frontend examples show observability in HTTP contexts, many real-world applications also include:
- **Data migration scripts** that process thousands of records
- **Background workers** that process queues continuously
- **Scheduled jobs** that run periodically
- **CLI tools** for operational tasks

These workloads have different observability needs:
- ✅ **No HTTP metrics** - use `autoInstrument: false`
- ✅ **Explicit telemetry flushing** - call `client.shutdown()` before exit
- ✅ **Batch progress tracking** - metrics for throughput, errors, retries
- ✅ **Long-running traces** - spans that last minutes or hours
- ✅ **Graceful shutdown** - flush telemetry before process exit

## Examples

### 1. Data Migration Script (`migrate-data.ts`)

Demonstrates batch processing patterns:
- Processing 1000 records in batches of 100
- Progress tracking with metrics and console output
- Error handling for individual record failures
- Performance monitoring (throughput, duration)
- Scoped instrumentation for module attribution

**Run it:**
```bash
cd packages/observability/examples/demo-app/cli
npm install
npm run migrate
```

**Key patterns shown:**
```typescript
// scoped instrumentation for CLI module
const migrationService = client.getInstrumentation('data-migration', '1.0.0');

// batch processing with tracing
await migrationService.trace('process_batch', async (span) => {
  const records = await fetchBatch();

  for (const record of records) {
    try {
      await transformRecord(record);
    } catch (error) {
      // record individual errors without stopping batch
      client.errors.record(error, {
        tags: { record_id: record.id }
      });
    }
  }

  // track batch metrics
  migrationService.metrics.increment('batches_processed', {
    status: 'success'
  });
});

// flush telemetry before exit
await client.shutdown();
```

**Metrics tracked:**
- `migration_batches_processed` - batches completed
- `migration_record_errors` - individual record failures
- `migration_duration_seconds` - total migration time
- `migration_throughput_records_per_sec` - processing rate

### 2. Queue Processing Worker (`process-queue.ts`)

Demonstrates long-running background worker patterns:
- Continuous queue polling (runs until stopped with Ctrl+C)
- Retry logic with exponential backoff
- Dead letter queue for failed jobs
- Real-time metrics for queue depth and throughput
- Graceful shutdown with telemetry flushing

**Run it:**
```bash
cd packages/observability/examples/demo-app/cli
npm install
npm run queue
```

**Stop it gracefully** (flushes telemetry):
```bash
Ctrl+C  # or send SIGTERM
```

**Key patterns shown:**
```typescript
// graceful shutdown handler
const shutdown = async () => {
  console.log('Shutdown signal received...');
  running = false;

  // flush all telemetry before exit
  await client.shutdown();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// main worker loop
while (running) {
  const job = await queue.poll();

  await workerService.trace('process_job', async (span) => {
    span.setAttributes({
      'job.id': job.id,
      'job.type': job.type,
      'job.attempts': job.attempts
    });

    try {
      await processJob(job);

      workerService.metrics.increment('jobs_processed', {
        job_type: job.type,
        status: 'success'
      });

    } catch (error) {
      // retry logic
      if (job.attempts < job.maxRetries) {
        await queue.retry(job);

        workerService.metrics.increment('jobs_retried', {
          job_type: job.type
        });
      } else {
        // dead letter queue
        await queue.moveToDeadLetter(job);

        workerService.metrics.increment('jobs_dead_lettered', {
          job_type: job.type
        });
      }
    }
  });
}
```

**Metrics tracked:**
- `queue_depth` - current queue size (main and dead letter)
- `jobs_processed` - successful job completions
- `jobs_retried` - jobs requiring retry
- `jobs_dead_lettered` - jobs that exhausted retries
- `worker_throughput_jobs_per_sec` - processing rate

## Common Patterns

### 1. Configuration for CLI/Workers

```typescript
const config = {
  serviceName: 'your-cli-or-worker',
  environment: 'node' as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? 'http://localhost:4318',
  autoInstrument: false,  // ⚠️ Important: no HTTP instrumentation
};
```

### 2. Always Call `shutdown()`

CLI scripts and workers MUST call `shutdown()` to flush telemetry:

```typescript
try {
  // ... your work here ...
} finally {
  await client.shutdown();  // ⚠️ Critical: flush before exit
}
```

Without `shutdown()`, telemetry may be lost when the process exits.

### 3. Scoped Instrumentation

Use `getInstrumentation()` for module-level attribution:

```typescript
const myService = client.getInstrumentation('my-module', '1.0.0');

myService.trace('operation', async () => {
  myService.metrics.increment('operations', { status: 'success' });
});
```

All telemetry from `myService` will be attributed to `my-module@1.0.0`.

### 4. Batch Progress Tracking

For long-running operations, report progress periodically:

```typescript
for (let i = 0; i < batches; i++) {
  await processBatch(i);

  // report progress every 10 batches
  if (i % 10 === 0) {
    const progress = (i / batches * 100).toFixed(1);
    console.log(`Progress: ${progress}%`);

    service.metrics.histogram('progress_percent', parseFloat(progress), {
      operation: 'batch_processing'
    });
  }
}
```

### 5. Error Handling Without Stopping

Record errors but continue processing:

```typescript
for (const item of items) {
  try {
    await processItem(item);
  } catch (error) {
    // record error but continue
    client.errors.record(error, {
      tags: { item_id: item.id }
    });

    // track in metrics
    service.metrics.increment('processing_errors', {
      error_type: 'item_failed'
    });
  }
}
```

## Development

Watch mode for active development:

```bash
# migration script with auto-reload
npm run dev:migrate

# queue worker with auto-reload
npm run dev:queue
```

## Next Steps

- Add your own CLI scripts following these patterns
- Integrate with your actual data sources and queues
- Customize metrics and traces for your use case
- Set up alerts on critical metrics (error rates, queue depth, etc.)

## Related Documentation

- **Main README**: `packages/observability/README.md` - Core library documentation
- **Backend Example**: `packages/observability/examples/demo-app/backend/` - HTTP server patterns
- **Frontend Example**: `packages/observability/examples/demo-app/frontend/` - Browser patterns
