import { debuglog } from "util";

const debug = debuglog("satoshibits:task-orchestrator");

interface PoolRunTasksInterface<TYield, TReturn, TNext> {
  maxPoolSize: number;
  /**
   * Each generator that this function* creates serves as a 'worker'.
   * It process tasks from a shared 'external iterator'.
   * The 'external iterator' could either just be an array of items, or a cursor.
   * It's up to you to ensure that each 'worker' processes unique tasks. If it's a cursor from a db,
   * you wouldn't worry about this since the cursor most likely has a next() method that
   * returns the next unique item.
   *
   * The pool will keep calling next() on your workers until the external iterator is exhausted i.e.
   * your workers stop yielding values e.g. returning (instead of yielding) from the worker will
   * stop the worker.
   *
   * Example:
   * ```ts
   * const createGenerator = (workerId: number) => async function* () {
   *    if (externalCursor.hasNext()) {
   *        //poll the next item from the shared iterator
   *       const item = externalCursor.next();
   *      //process the item ...
   *        yield item;
   *    } //when the shared iterator is exhausted, signal to stop all workers
   * }
   *
   * ```
   *
   * Yielding a `doneAll:true` value from the a worker signals the pool to stop fetching new results.
   * This will not cancel any "in-flight" tasks that were initiated by the other workers
   * during the current iteration. They will still be resolved. They just won't be yielded as
   * a result from the pool.
   *
   * If you want to abort/cleanup "in-flight" tasks/requests
   * from each worker, you'll have to implement that yourself.
   *
   */
  //TODO: Add a way to abort/cleanup from each worker when doneAll is received
  createGenerator: (workerId: number) => AsyncGenerator<TYield, TReturn, TNext>;
}

/**
 * Useful for running tasks in a pool where as one task finishes, another task is queued up ensuring
 * that the maxPoolSize is always filled.
 */
export async function* poolRunTasks<TYield, TReturn, TNext>({
  maxPoolSize,
  createGenerator,
}: PoolRunTasksInterface<TYield, TReturn, TNext>) {
  const asyncIterators = new Array<AsyncGenerator<TYield, TReturn, TNext>>(
    maxPoolSize,
  );
  for (let i = 0; i < maxPoolSize; i++) {
    asyncIterators[i] = createGenerator(i);
  }
  //Delegate the iteration to the raceAsyncIterators function
  //i.e. calling next() for this generator will call next() for raceAsyncIterators
  //https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/yield*
  yield* raceAsyncIterators(asyncIterators);
}

/**
 * Asynchronously races multiple async iterators, yielding values from the first iterator
 * that resolves until all iterators are exhausted.
 */
async function* raceAsyncIterators<TYield, TReturn, TNext>(
  asyncIterators: AsyncGenerator<TYield, TReturn, TNext>[],
) {
  const promises = new Map<
    number,
    Promise<{
      result: IteratorResult<TYield, TReturn>;
      index: number;
    }>
  >();

  async function nextResultOfIterator(
    index: number,
    iterator: AsyncIterator<TYield, TReturn, TNext>,
  ) {
    return { result: await iterator.next(), index };
  }

  //start all the iterators
  debug("Starting all iterators");
  for (let i = 0; i < asyncIterators.length; i++) {
    promises.set(i, nextResultOfIterator(i, asyncIterators[i]!));
  }

  while (promises.size) {
    //wait for whichever iterator resolves first
    const { result, index } = await Promise.race(promises.values());

    //eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore - We just care if it's an object containing doneAll so
    //we shouldn't restrict the type of the yielded value
    if (result.value?.doneAll) {
      debug("doneAll received, stopping all iterators");
      //stop all iterators
      promises.clear();
      //NOTE that even if this is the last value yielded,
      //the while loop will still run one more time before stopping
      //since only till the succeeding next() call will the loop stop
      //due to yield pausing at this point
      yield result.value;
      return;
    }

    //iterator is done once it stops yielding values
    //i.e. they no longer called yield
    if (result.done) {
      //remove the iterator from the pool once it's done
      promises.delete(index);

      debug(`Finished iterator at index: ${index}`, result);
      //NOTE: The iterator can return a value. Returned values
      //are not preserved when using a for-await loop so we choose to yield it
      if (result.value) {
        yield result.value;
      } else {
        //handle when iterators yield their final value instead of returning
        //which means the next() call resumes execution after their final yield
        //but the iterator actually just finishes so as with all functions, it returns undefined.
        continue;
      }
    } else {
      debug(`Unfinished iterator at index: ${index}`, result);
      debug("Adding the next() result for next race");

      //update this iterator by requesting its next result again
      promises.set(index, nextResultOfIterator(index, asyncIterators[index]!));

      yield result.value;
    }

    debug("Resumed execution here at", index);
  }
}
