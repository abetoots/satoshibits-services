/**
 * Data Migration CLI Script
 *
 * This example demonstrates observability in batch processing CLI scripts:
 * - Progress tracking with metrics
 * - Error handling and retry logic with distributed tracing
 * - Performance monitoring for long-running operations
 * - Scoped instrumentation for module attribution
 * - No HTTP context - pure CLI usage
 */

import { SmartClient } from '@satoshibits/observability';

// configuration for CLI observability
const observabilityConfig = {
  serviceName: 'data-migration-cli',
  environment: 'node' as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? 'http://localhost:4318',
  autoInstrument: false, // no HTTP instrumentation needed for CLI
};

// simulate database records
interface LegacyRecord {
  id: string;
  legacyFormat: string;
  created: string;
}

interface ModernRecord {
  id: string;
  modernFormat: string;
  migrated: string;
}

async function simulateFetchBatch(offset: number, limit: number): Promise<LegacyRecord[]> {
  // simulate database fetch
  await new Promise(resolve => setTimeout(resolve, 100));

  const records: LegacyRecord[] = [];
  for (let i = 0; i < limit; i++) {
    records.push({
      id: `record-${offset + i}`,
      legacyFormat: `legacy-data-${offset + i}`,
      created: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  return records;
}

async function simulateTransformRecord(record: LegacyRecord): Promise<ModernRecord> {
  // simulate data transformation
  await new Promise(resolve => setTimeout(resolve, 10));

  // simulate occasional transformation errors
  if (Math.random() < 0.05) {
    throw new Error(`Invalid data format in record ${record.id}`);
  }

  return {
    id: record.id,
    modernFormat: record.legacyFormat.replace('legacy-', 'modern-'),
    migrated: new Date().toISOString()
  };
}

async function simulateSaveBatch(records: ModernRecord[]): Promise<void> {
  // simulate database write
  await new Promise(resolve => setTimeout(resolve, 150));
}

async function migrate() {
  console.log('🔄 Starting data migration...\n');

  let client: Awaited<ReturnType<typeof SmartClient.initialize>> | null = null;

  try {
    // initialize observability
    client = await SmartClient.initialize(observabilityConfig);
    console.log('✅ Observability initialized\n');

    // get scoped instrumentation for this migration module
    const migrationService = client.getInstrumentation('data-migration', '1.0.0');

    // set context for this CLI run using the business context API
    client.context.business.setUser({
      id: 'migration-job',
      name: 'Data Migration Script'
    });

    client.context.business.addBreadcrumb('Migration started', {
      script: 'migrate-data.ts',
      timestamp: new Date().toISOString()
    });

    // main migration logic wrapped in trace
    await migrationService.trace('migrate_all_records', async (span) => {
      const BATCH_SIZE = 100;
      const TOTAL_RECORDS = 1000;
      const totalBatches = Math.ceil(TOTAL_RECORDS / BATCH_SIZE);

      span.setAttributes({
        'migration.total_records': TOTAL_RECORDS,
        'migration.batch_size': BATCH_SIZE,
        'migration.total_batches': totalBatches
      });

      let totalProcessed = 0;
      let totalErrors = 0;
      const startTime = Date.now();

      // process batches
      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        const offset = batchNum * BATCH_SIZE;

        try {
          await migrationService.trace('process_batch', async (batchSpan) => {
            batchSpan.setAttributes({
              'batch.number': batchNum + 1,
              'batch.offset': offset,
              'batch.size': BATCH_SIZE
            });

            // fetch batch
            const records = await migrationService.trace('fetch_batch', async () => {
              return await simulateFetchBatch(offset, BATCH_SIZE);
            });

            // transform records
            const transformedRecords: ModernRecord[] = [];
            let batchErrors = 0;

            for (const record of records) {
              try {
                const transformed = await simulateTransformRecord(record);
                transformedRecords.push(transformed);
              } catch (error) {
                batchErrors++;
                totalErrors++;

                // record individual transformation errors
                client!.errors.record(error as Error, {
                  tags: {
                    component: 'data_transformation',
                    record_id: record.id
                  },
                  extra: {
                    record,
                    batch_number: batchNum + 1
                  }
                });

                client!.context.business.addBreadcrumb('Transformation error', {
                  record_id: record.id,
                  error: (error as Error).message
                });
              }
            }

            // save batch
            if (transformedRecords.length > 0) {
              await migrationService.trace('save_batch', async (saveSpan) => {
                saveSpan.setAttributes({
                  'batch.records_saved': transformedRecords.length
                });

                await simulateSaveBatch(transformedRecords);
              });
            }

            totalProcessed += transformedRecords.length;

            // record batch metrics
            migrationService.metrics.increment('migration_batches_processed', {
              status: batchErrors > 0 ? 'partial_success' : 'success'
            });

            migrationService.metrics.histogram('migration_batch_size', transformedRecords.length, {
              has_errors: batchErrors > 0 ? 'true' : 'false'
            });

            if (batchErrors > 0) {
              migrationService.metrics.increment('migration_record_errors', {
                error_type: 'transformation_failed'
              });
            }

            // progress logging
            const progress = ((batchNum + 1) / totalBatches * 100).toFixed(1);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(
              `[${progress}%] Batch ${batchNum + 1}/${totalBatches}: ` +
              `${transformedRecords.length} migrated, ${batchErrors} errors (${elapsed}s elapsed)`
            );

            client!.context.business.addBreadcrumb('Batch completed', {
              batch_number: batchNum + 1,
              records_processed: transformedRecords.length,
              errors: batchErrors
            });
          });

        } catch (error) {
          // record batch-level errors
          client.errors.record(error as Error, {
            tags: {
              component: 'batch_processing',
              batch_number: (batchNum + 1).toString()
            },
            extra: {
              offset,
              batch_size: BATCH_SIZE
            }
          });

          console.error(`❌ Batch ${batchNum + 1} failed completely:`, (error as Error).message);

          // record failure metric
          migrationService.metrics.increment('migration_batches_failed', {
            error_type: 'batch_processing_failed'
          });
        }
      }

      // record overall metrics
      const durationSeconds = (Date.now() - startTime) / 1000;

      migrationService.metrics.histogram('migration_duration_seconds', durationSeconds, {
        has_errors: totalErrors > 0 ? 'true' : 'false'
      });

      migrationService.metrics.histogram('migration_total_records', totalProcessed, {
        status: totalErrors > 0 ? 'completed_with_errors' : 'completed'
      });

      migrationService.metrics.histogram('migration_throughput_records_per_sec',
        totalProcessed / durationSeconds, {
          batch_size: BATCH_SIZE.toString()
        }
      );

      span.setAttributes({
        'migration.records_processed': totalProcessed,
        'migration.total_errors': totalErrors,
        'migration.duration_seconds': durationSeconds,
        'migration.throughput': totalProcessed / durationSeconds
      });

      // final summary
      console.log(`\n✅ Migration completed!`);
      console.log(`   Records processed: ${totalProcessed}`);
      console.log(`   Errors: ${totalErrors}`);
      console.log(`   Duration: ${durationSeconds.toFixed(1)}s`);
      console.log(`   Throughput: ${(totalProcessed / durationSeconds).toFixed(1)} records/sec`);

      client.context.business.addBreadcrumb('Migration completed', {
        records_processed: totalProcessed,
        errors: totalErrors,
        duration_seconds: durationSeconds
      });
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);

    if (client) {
      client.errors.record(error as Error, {
        tags: {
          component: 'migration_script',
          fatal: 'true'
        }
      });
    }

    process.exit(1);

  } finally {
    // ensure telemetry is flushed before exit
    if (client) {
      console.log('\n📊 Flushing telemetry...');
      await client.shutdown();
      console.log('✅ Telemetry flushed\n');
    }
  }
}

// run migration
migrate().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
