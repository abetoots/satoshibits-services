/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";

import { poolRunTasks } from "./pool.mjs";

describe("poolRunTasks", () => {
  it("should process tasks concurrently with a pool size of 1", async () => {
    const tasks = [1, 2, 3];
    async function* createGenerator() {
      for (const task of tasks) {
        yield task;
      }
    }

    const results = [];
    for await (const result of poolRunTasks({
      maxPoolSize: 1,
      createGenerator,
    })) {
      results.push(result);
    }

    expect(results).toStrictEqual(tasks);
  });

  it("should process tasks concurrently with a pool size greater than 1", async () => {
    const tasks = [1, 2, 3, 4, 5, 6];
    async function* createGenerator() {
      for (const task of tasks) {
        yield task;
      }
    }

    const results = [];
    for await (const result of poolRunTasks({
      maxPoolSize: 3,
      createGenerator,
    })) {
      results.push(result);
    }

    expect(results).toHaveLength(tasks.length * 3);
  });

  it("should handle doneAll signal to stop all workers", async () => {
    const promise1 = new Promise<{ id: number }>((resolve) => {
      setTimeout(() => {
        resolve({ id: 1 });
      }, 1000);
    });

    const promise2 = new Promise<{ id: number }>((resolve) => {
      setTimeout(() => {
        resolve({ id: 2 });
      }, 2000);
    });

    const promises = [promise1, promise2];

    async function* createGenerator(workerId: number) {
      const taskResult = await promises[workerId];
      if (taskResult?.id === 1) {
        yield { id: 1, doneAll: true };
      } else {
        yield taskResult;
      }
    }

    const results = [];
    for await (const result of poolRunTasks({
      maxPoolSize: 2,
      createGenerator,
    })) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toStrictEqual({ id: 1, doneAll: true });
  });

  it("should exhaust iterators in the correct order", async () => {
    async function* createGenerator(workerId: number) {
      if (workerId === 0) {
        yield 1;
        //resuming after yielding 1
        return 3; //should be after 1
      } else {
        yield 2;
        //resuming after yielding 3
        return 4; //should be after 3
      }
    }

    const results = [];
    for await (const result of poolRunTasks({
      maxPoolSize: 2,
      createGenerator,
    })) {
      results.push(result);
    }

    expect(results).toStrictEqual([1, 3, 2, 4]);
  });

  it("should process tasks with varying completion times in the correct order", async () => {
    const promise1 = new Promise((resolve) =>
      setTimeout(() => {
        resolve({ id: 1, timeout: 300 });
      }, 300),
    );

    const promise2 = new Promise((resolve) =>
      setTimeout(() => {
        resolve({ id: 2, timeout: 400 });
      }, 400),
    );

    const promise3 = new Promise((resolve) =>
      setTimeout(() => {
        resolve({ id: 3, timeout: 100 });
      }, 100),
    );

    const promise4 = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ id: 4, timeout: 200 });
      }, 200);
    });

    const promises = [promise1, promise2, promise3, promise4];

    async function* createGenerator(workerId: number) {
      const taskResult = await promises[workerId];
      yield taskResult;
    }

    const results = [];
    for await (const result of poolRunTasks({
      maxPoolSize: 4,
      createGenerator,
    })) {
      results.push(result);
    }

    expect(results).toStrictEqual([
      { id: 3, timeout: 100 },
      { id: 4, timeout: 200 },
      { id: 1, timeout: 300 },
      { id: 2, timeout: 400 },
    ]);
  });

  it("should handle idle workers", async () => {
    const tasks = [1, 2, 3];
    async function* createGenerator(workerId: number) {
      if (workerId >= tasks.length) {
        yield { idle: true };
        return;
      }
      yield tasks[workerId];
    }

    const results = [];
    for await (const result of poolRunTasks({
      maxPoolSize: 5,
      createGenerator,
    })) {
      results.push(result);
    }

    expect(results).toStrictEqual([1, 2, 3, { idle: true }, { idle: true }]);
  });
});
