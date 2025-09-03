/**
 * Queue Processing Worker
 *
 * This example demonstrates observability in long-running background workers:
 * - Queue processing with retry logic
 * - Distributed tracing across async job processing
 * - Error handling and dead letter queue patterns
 * - Real-time metrics for queue depth and processing rates
 * - Graceful shutdown with telemetry flushing
 * - Scoped instrumentation for module attribution
 */

import { SmartClient } from '@satoshibits/observability';

// configuration for background worker observability
const observabilityConfig = {
  serviceName: 'queue-worker',
  environment: 'node' as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? 'http://localhost:4318',
  autoInstrument: false, // no HTTP instrumentation needed for workers
};

// job types
interface Job {
  id: string;
  type: 'email' | 'notification' | 'report';
  payload: Record<string, unknown>;
  attempts: number;
  maxRetries: number;
  createdAt: string;
}

// simulate queue operations
class SimulatedQueue {
  private jobs: Job[] = [];
  private deadLetterQueue: Job[] = [];

  constructor() {
    // pre-populate with some jobs
    for (let i = 0; i < 50; i++) {
      const types: Job['type'][] = ['email', 'notification', 'report'];
      const type = types[Math.floor(Math.random() * types.length)]!;

      this.jobs.push({
        id: `job-${Date.now()}-${i}`,
        type,
        payload: {
          userId: `user-${Math.floor(Math.random() * 100)}`,
          data: `Sample data for ${type} job`
        },
        attempts: 0,
        maxRetries: 3,
        createdAt: new Date(Date.now() - Math.random() * 60000).toISOString()
      });
    }
  }

  async poll(): Promise<Job | null> {
    await new Promise(resolve => setTimeout(resolve, 50));

    // simulate queue with occasional new jobs
    if (Math.random() < 0.3) {
      const types: Job['type'][] = ['email', 'notification', 'report'];
      const type = types[Math.floor(Math.random() * types.length)]!;

      this.jobs.push({
        id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        payload: {
          userId: `user-${Math.floor(Math.random() * 100)}`,
          data: `Sample data for ${type} job`
        },
        attempts: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString()
      });
    }

    return this.jobs.shift() || null;
  }

  async retry(job: Job): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    job.attempts++;
    this.jobs.push(job);
  }

  async moveToDeadLetter(job: Job): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    this.deadLetterQueue.push(job);
  }

  getQueueDepth(): number {
    return this.jobs.length;
  }

  getDeadLetterDepth(): number {
    return this.deadLetterQueue.length;
  }
}

// simulate job processing
async function processJob(job: Job): Promise<void> {
  // simulate processing time
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

  // simulate occasional failures (10% failure rate on first attempt)
  if (job.attempts === 0 && Math.random() < 0.1) {
    throw new Error(`Processing failed for ${job.type} job`);
  }

  // simulate rarer failures on retries (5% failure rate)
  if (job.attempts > 0 && Math.random() < 0.05) {
    throw new Error(`Retry failed for ${job.type} job`);
  }
}

async function startWorker() {
  console.log('🚀 Starting queue worker...\n');

  let client: Awaited<ReturnType<typeof SmartClient.initialize>> | null = null;
  let running = true;

  // handle graceful shutdown
  const shutdown = async () => {
    console.log('\n⚠️  Shutdown signal received...');
    running = false;

    if (client) {
      console.log('📊 Flushing telemetry...');
      await client.shutdown();
      console.log('✅ Telemetry flushed');
    }

    console.log('👋 Worker stopped\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // initialize observability
    client = await SmartClient.initialize(observabilityConfig);
    console.log('✅ Observability initialized\n');

    // get scoped instrumentation for this worker
    const workerService = client.getInstrumentation('queue-worker', '1.0.0');

    // set context for this worker instance
    client.context.business.setUser({
      id: `worker-${process.pid}`,
      name: 'Queue Processing Worker'
    });

    client.context.business.addBreadcrumb('Worker started', {
      worker_id: `worker-${process.pid}`,
      timestamp: new Date().toISOString()
    });

    // initialize queue
    const queue = new SimulatedQueue();

    let totalProcessed = 0;
    let totalErrors = 0;
    let totalRetries = 0;
    let totalDeadLettered = 0;
    const startTime = Date.now();

    console.log('📥 Polling for jobs...\n');

    // main processing loop
    while (running) {
      try {
        // report queue depth metrics
        const queueDepth = queue.getQueueDepth();
        const deadLetterDepth = queue.getDeadLetterDepth();

        workerService.metrics.histogram('queue_depth', queueDepth, {
          queue_type: 'main'
        });

        workerService.metrics.histogram('queue_depth', deadLetterDepth, {
          queue_type: 'dead_letter'
        });

        // poll for next job
        const job = await workerService.trace('poll_queue', async (pollSpan) => {
          pollSpan.setAttributes({
            'queue.depth': queueDepth,
            'queue.dead_letter_depth': deadLetterDepth
          });

          return await queue.poll();
        });

        if (!job) {
          // no jobs available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // process job with tracing
        await workerService.trace('process_job', async (jobSpan) => {
          jobSpan.setAttributes({
            'job.id': job.id,
            'job.type': job.type,
            'job.attempts': job.attempts,
            'job.max_retries': job.maxRetries,
            'job.age_ms': Date.now() - new Date(job.createdAt).getTime()
          });

          client!.context.business.addBreadcrumb('Job processing started', {
            job_id: job.id,
            job_type: job.type,
            attempt: job.attempts + 1
          });

          try {
            // process the job
            await processJob(job);

            totalProcessed++;

            // record success metrics
            workerService.metrics.increment('jobs_processed', {
              job_type: job.type,
              status: 'success',
              had_retries: job.attempts > 0 ? 'true' : 'false'
            });

            workerService.metrics.histogram('job_processing_duration_ms',
              Date.now() - new Date(job.createdAt).getTime(), {
                job_type: job.type
              }
            );

            if (job.attempts > 0) {
              totalRetries++;
              workerService.metrics.increment('jobs_retried_success', {
                job_type: job.type,
                attempts: job.attempts.toString()
              });
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(
              `✅ [${elapsed}s] ${job.type} job ${job.id} ` +
              `(attempt ${job.attempts + 1}) - Queue: ${queueDepth}`
            );

            client!.context.business.addBreadcrumb('Job completed', {
              job_id: job.id,
              job_type: job.type,
              attempts: job.attempts + 1
            });

          } catch (error) {
            totalErrors++;

            // record error
            client!.errors.record(error as Error, {
              tags: {
                component: 'job_processing',
                job_type: job.type,
                job_id: job.id
              },
              extra: {
                job,
                attempt: job.attempts + 1
              }
            });

            client!.context.business.addBreadcrumb('Job failed', {
              job_id: job.id,
              job_type: job.type,
              error: (error as Error).message,
              attempt: job.attempts + 1
            });

            // retry logic
            if (job.attempts < job.maxRetries) {
              // retry the job
              await queue.retry(job);

              workerService.metrics.increment('jobs_retried', {
                job_type: job.type,
                attempt: (job.attempts + 1).toString()
              });

              console.log(
                `⚠️  [${((Date.now() - startTime) / 1000).toFixed(1)}s] ${job.type} job ${job.id} failed, ` +
                `retrying (attempt ${job.attempts + 1}/${job.maxRetries})`
              );

            } else {
              // max retries exceeded, move to dead letter queue
              totalDeadLettered++;

              await queue.moveToDeadLetter(job);

              workerService.metrics.increment('jobs_dead_lettered', {
                job_type: job.type,
                final_attempt: job.attempts.toString()
              });

              console.log(
                `❌ [${((Date.now() - startTime) / 1000).toFixed(1)}s] ${job.type} job ${job.id} ` +
                `exhausted retries, moved to dead letter queue`
              );

              client!.context.business.addBreadcrumb('Job dead lettered', {
                job_id: job.id,
                job_type: job.type,
                total_attempts: job.attempts + 1
              });
            }
          }
        });

        // report throughput metrics every 10 jobs
        if (totalProcessed % 10 === 0 && totalProcessed > 0) {
          const durationSeconds = (Date.now() - startTime) / 1000;
          const throughput = totalProcessed / durationSeconds;

          workerService.metrics.histogram('worker_throughput_jobs_per_sec', throughput, {
            worker_id: `worker-${process.pid}`
          });

          console.log(
            `\n📊 Progress: ${totalProcessed} processed, ${totalErrors} errors, ` +
            `${totalRetries} retries, ${totalDeadLettered} dead-lettered ` +
            `(${throughput.toFixed(1)} jobs/sec)\n`
          );
        }

      } catch (error) {
        console.error('❌ Worker error:', error);

        if (client) {
          client.errors.record(error as Error, {
            tags: {
              component: 'worker_loop',
              fatal: 'false'
            }
          });
        }

        // wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

  } catch (error) {
    console.error('❌ Worker failed to start:', error);

    if (client) {
      client.errors.record(error as Error, {
        tags: {
          component: 'worker_startup',
          fatal: 'true'
        }
      });
    }

    process.exit(1);
  }
}

// start worker
startWorker().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
