import { describe, expect, it, vi } from "vitest";

import { batchRunTasks } from "./batch.mjs";

describe("batchRunTasks", () => {
  it("should process batches concurrently", async () => {
    const iterable = [1, 2, 3, 4, 5];
    const maxBatchSize = 2;
    const processConcurrently = true;
    const onProcessBatchItem = vi.fn();

    await batchRunTasks({
      iterable,
      maxBatchSize,
      processConcurrently,
      onProcessBatchItem,
    });

    expect(onProcessBatchItem).toHaveBeenCalledTimes(5);
  });

  it("should process batches sequentially", async () => {
    const iterable = [1, 2, 3, 4, 5];
    const maxBatchSize = 2;
    const processConcurrently = false;
    const onProcessBatchItem = vi.fn();

    await batchRunTasks({
      iterable,
      maxBatchSize,
      processConcurrently,
      onProcessBatchItem,
    });

    expect(onProcessBatchItem).toHaveBeenCalledTimes(5);
  });

  it("should process current batch using onProcessCurrentBatch", async () => {
    const iterable = [1, 2, 3, 4, 5];
    const maxBatchSize = 2;
    const onProcessCurrentBatch = vi.fn();

    await batchRunTasks({
      iterable,
      maxBatchSize,
      onProcessCurrentBatch,
    });

    expect(onProcessCurrentBatch).toHaveBeenCalledTimes(3);
    expect(onProcessCurrentBatch).toHaveBeenCalledWith([1, 2]);
    expect(onProcessCurrentBatch).toHaveBeenCalledWith([3, 4]);
    expect(onProcessCurrentBatch).toHaveBeenCalledWith([5]);
  });

  it("should handle leftovers in the batch", async () => {
    const iterable = [1, 2, 3];
    const maxBatchSize = 2;
    const processConcurrently = true;
    const onProcessBatchItem = vi.fn();

    await batchRunTasks({
      iterable,
      maxBatchSize,
      processConcurrently,
      onProcessBatchItem,
    });

    expect(onProcessBatchItem).toHaveBeenCalledTimes(3);
  });
});
