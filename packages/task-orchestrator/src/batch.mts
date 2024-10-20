import { debuglog } from "util";

const debug = debuglog("satoshibits:task-orchestrator");

export type Exclusive<T, U> = {
  [P in keyof T]?: P extends keyof U ? never : T[P];
} & {
  [P in keyof U]?: P extends keyof T ? never : U[P];
};

type BatchRunTasksInterface<T> = {
  iterable: AsyncIterable<T | T[]> | Iterable<T | T[]>;
  maxBatchSize: number;
} & Exclusive<
  {
    processConcurrently: boolean;
    onProcessBatchItem: (item: T | Awaited<T>) => void | Promise<void>;
  },
  {
    onProcessCurrentBatch: (batch: T[]) => void | Promise<void>;
  }
>;

/**
 * Useful for running tasks concurrently in batches. Option to disable the concurrency
 * to help when debugging.
 *
 * Pros: Running concurrent awaited tasks with each tasks taking
 * a SHORT amount of time to complete e.g. a thousand writes to a db.
 * Cons: Running concurrent tasks that takes a LONG amount of time EACH to complete since
 * it has to wait for ALL the tasks in the batch to complete before starting the
 * next batch.
 */
export const batchRunTasks = async <T,>({
  iterable,
  maxBatchSize,
  processConcurrently,
  onProcessBatchItem,
  onProcessCurrentBatch,
}: BatchRunTasksInterface<T>) => {
  let batch: T[] = [];

  const processAndResetBatch = async () => {
    if (onProcessCurrentBatch) {
      await onProcessCurrentBatch(batch);
    } else if (processConcurrently) {
      debug("Processing batch in parallel");
      await Promise.allSettled(
        batch.map(async (item) => await onProcessBatchItem?.(item)),
      );
    } else {
      for (const item of batch) {
        await onProcessBatchItem?.(item);
      }
    }
    batch = [];
  };

  //eslint-disable-next-line @typescript-eslint/await-thenable
  for await (const i of iterable) {
    if (batch.length >= maxBatchSize) {
      debug("Batch is full, processing and resetting batch");
      await processAndResetBatch();
    }

    if (Array.isArray(i)) {
      for (const item of i) {
        if (batch.length >= maxBatchSize) {
          debug("Batch is full, processing and resetting batch");
          await processAndResetBatch();
        }
        batch.push(item);
      }
    } else {
      batch.push(i);
    }
  }

  //handle leftovers
  if (batch.length > 0) {
    debug("Leftovers found, processing and resetting batch");
    await processAndResetBatch();
  }
};
