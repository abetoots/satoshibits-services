import { describe, expect, it, vi } from "vitest";

import { Result } from "./result.mjs";
import { Task } from "./task.mjs";

describe("Task", () => {
  describe("laziness", () => {
    it("should not execute until run", async () => {
      const effect = vi.fn(() => Promise.resolve(42));
      const task = Task.fromPromise(effect);

      expect(effect).not.toHaveBeenCalled();

      const result = await Task.run(task);
      expect(effect).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("should execute each time run is called", async () => {
      const effect = vi.fn(() => Promise.resolve("test"));
      const task = Task.fromPromise(effect);

      await Task.run(task);
      await Task.run(task);

      expect(effect).toHaveBeenCalledTimes(2);
    });
  });

  describe("of", () => {
    it("should create a task that resolves with the value", async () => {
      const task = Task.of(42);
      await expect(Task.run(task)).resolves.toBe(42);
    });

    it("should work with complex values", async () => {
      const value = { a: 1, b: "test" };
      const task = Task.of(value);
      await expect(Task.run(task)).resolves.toEqual(value);
    });
  });

  describe("fromPromise", () => {
    it("should create a Task from a Promise-returning function", async () => {
      const promiseFn = () => Promise.resolve(42);
      const task = Task.fromPromise(promiseFn);
      await expect(Task.run(task)).resolves.toBe(42);
    });

    it("should handle rejected Promises", async () => {
      const promiseFn = () => Promise.reject(new Error("test error"));
      const task = Task.fromPromise(promiseFn);
      await expect(Task.run(task)).rejects.toThrow("test error");
    });

    it("should be lazy - not execute until run", async () => {
      const effect = vi.fn(() => Promise.resolve("lazy"));
      const task = Task.fromPromise(effect);

      expect(effect).not.toHaveBeenCalled();
      await Task.run(task);
      expect(effect).toHaveBeenCalledTimes(1);
    });

    it("should handle async functions", async () => {
      const asyncFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return "async result";
      };
      const task = Task.fromPromise(asyncFn);
      await expect(Task.run(task)).resolves.toBe("async result");
    });
  });

  describe("run", () => {
    it("should execute a Task and return a Promise", async () => {
      const task = Task.of(100);
      const result = Task.run(task);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBe(100);
    });

    it("should handle Tasks that reject", async () => {
      const task: Task<never> = () => Promise.reject(new Error("run error"));
      const result = Task.run(task);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow("run error");
    });

    it("should execute complex Task chains", async () => {
      const task = Task.chain((n: number) =>
        Task.chain((doubled: number) =>
          Task.of(doubled + 1)
        )(Task.of(n * 2))
      )(Task.of(5));

      await expect(Task.run(task)).resolves.toBe(11);
    });

    it("should work with Task.delay", async () => {
      const start = Date.now();
      const task = Task.chain(() => Task.of("done"))(Task.delay(20));
      const result = await Task.run(task);
      const duration = Date.now() - start;

      expect(result).toBe("done");
      expect(duration).toBeGreaterThanOrEqual(20);
    });
  });

  describe("map", () => {
    it("should transform the resolved value", async () => {
      const task = Task.of(10);
      const mapped = Task.map((n: number) => n * 2)(task);
      await expect(Task.run(mapped)).resolves.toBe(20);
    });

    it("should not execute the original task until run", async () => {
      const effect = vi.fn(() => Promise.resolve(5));
      const task = Task.fromPromise(effect);
      const mapped = Task.map((n: number) => n + 1)(task);

      expect(effect).not.toHaveBeenCalled();
      await Task.run(mapped);
      expect(effect).toHaveBeenCalledTimes(1);
    });

    it("should propagate rejection", async () => {
      const task = Task.fromPromise(() => Promise.reject(new Error("fail")));
      const mapped = Task.map((n: number) => n * 2)(task);
      await expect(Task.run(mapped)).rejects.toThrow("fail");
    });
  });

  describe("chain / flatMap", () => {
    it("should sequence async operations", async () => {
      const task1 = Task.of(5);
      const task2 = (n: number) => Task.of(n * 2);
      const chained = Task.chain(task2)(task1);
      await expect(Task.run(chained)).resolves.toBe(10);
    });

    it("flatMap should be an alias for chain", async () => {
      const task1 = Task.of(5);
      const task2 = (n: number) => Task.of(n * 2);
      const chained = Task.flatMap(task2)(task1);
      await expect(Task.run(chained)).resolves.toBe(10);
    });

    it("should maintain laziness through the chain", async () => {
      const effect1 = vi.fn(() => Promise.resolve(1));
      const effect2 = vi.fn((n: number) => Promise.resolve(n + 1));

      const task1 = Task.fromPromise(effect1);
      const chained = Task.chain((n: number) =>
        Task.fromPromise(() => effect2(n)),
      )(task1);

      expect(effect1).not.toHaveBeenCalled();
      expect(effect2).not.toHaveBeenCalled();

      await Task.run(chained);

      expect(effect1).toHaveBeenCalledTimes(1);
      expect(effect2).toHaveBeenCalledTimes(1);
    });

    it("should propagate rejection from first task", async () => {
      const task1 = Task.fromPromise(() => Promise.reject(new Error("first")));
      const task2 = (n: number) => Task.of(n * 2);
      const chained = Task.chain(task2)(task1);
      await expect(Task.run(chained)).rejects.toThrow("first");
    });

    it("should propagate rejection from second task", async () => {
      const task1 = Task.of(5);
      const task2 = (_n: number) =>
        Task.fromPromise(() => Promise.reject(new Error("second")));
      const chained = Task.chain(task2)(task1);
      await expect(Task.run(chained)).rejects.toThrow("second");
    });
  });

  describe("ap", () => {
    it("should apply a task of a function to a task of a value", async () => {
      const add = (a: number) => (b: number) => a + b;
      const taskFn = Task.of(add(5));
      const taskValue = Task.of(3);
      const result = Task.ap(taskValue)(taskFn);
      await expect(Task.run(result)).resolves.toBe(8);
    });

    it("should run tasks in parallel", async () => {
      let fnResolved = false;
      let valueResolved = false;

      const taskFn = Task.fromPromise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        fnResolved = true;
        return (n: number) => n * 2;
      });

      const taskValue = Task.fromPromise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        valueResolved = true;
        return 5;
      });

      const result = Task.ap(taskValue)(taskFn);
      const value = await Task.run(result);

      expect(value).toBe(10);
      expect(fnResolved).toBe(true);
      expect(valueResolved).toBe(true);
    });

    it("should propagate rejection from the function task", async () => {
      const taskFn = Task.fromPromise<(n: number) => number>(() =>
        Promise.reject(new Error("function error"))
      );
      const taskValue = Task.of(3);
      const result = Task.ap(taskValue)(taskFn);

      await expect(Task.run(result)).rejects.toThrow("function error");
    });

    it("should propagate rejection from the value task", async () => {
      const taskFn = Task.of((n: number) => n * 2);
      const taskValue = Task.fromPromise<number>(() =>
        Promise.reject(new Error("value error"))
      );
      const result = Task.ap(taskValue)(taskFn);

      await expect(Task.run(result)).rejects.toThrow("value error");
    });

    it("should propagate first rejection when both reject", async () => {
      const taskFn = Task.fromPromise<(n: number) => number>(() =>
        Promise.reject(new Error("function error"))
      );
      const taskValue = Task.fromPromise<number>(() =>
        Promise.reject(new Error("value error"))
      );
      const result = Task.ap(taskValue)(taskFn);

      // Since they run in parallel, the first to reject wins
      await expect(Task.run(result)).rejects.toThrow();
    });
  });

  describe("sequence", () => {
    it("should convert array of tasks to task of array", async () => {
      const tasks = [Task.of(1), Task.of(2), Task.of(3)];
      const sequenced = Task.sequence(tasks);
      await expect(Task.run(sequenced)).resolves.toEqual([1, 2, 3]);
    });

    it("should run tasks in parallel", async () => {
      const delays = [30, 20, 10];
      const tasks = delays.map((ms) =>
        Task.fromPromise(
          () =>
            new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)),
        ),
      );

      const start = Date.now();
      const result = await Task.run(Task.sequence(tasks));
      const duration = Date.now() - start;

      expect(result).toEqual([30, 20, 10]);
      // should take ~30ms (max delay), not 60ms (sum)
      expect(duration).toBeLessThan(50);
      expect(duration).toBeGreaterThanOrEqual(30);
    });

    it("should handle empty array", async () => {
      const sequenced = Task.sequence([]);
      await expect(Task.run(sequenced)).resolves.toEqual([]);
    });

    it("should propagate first rejection", async () => {
      const tasks = [
        Task.of(1),
        Task.fromPromise(() => Promise.reject(new Error("fail"))),
        Task.of(3),
      ];
      const sequenced = Task.sequence(tasks);
      await expect(Task.run(sequenced)).rejects.toThrow("fail");
    });
  });

  describe("traverse", () => {
    it("should map and sequence", async () => {
      const fn = (n: number) => Task.of(n * 2);
      const traverse = Task.traverse(fn);
      const result = await Task.run(traverse([1, 2, 3]));
      expect(result).toEqual([2, 4, 6]);
    });

    it("should handle empty array", async () => {
      const fn = (n: number) => Task.of(n * 2);
      const traverse = Task.traverse(fn);
      const result = await Task.run(traverse([]));
      expect(result).toEqual([]);
    });

    it("should run in parallel", async () => {
      let completed = 0;
      const fn = (n: number) =>
        Task.fromPromise(async () => {
          await new Promise((resolve) => setTimeout(resolve, n * 10));
          completed++;
          return n;
        });

      const traverse = Task.traverse(fn);
      const start = Date.now();
      const result = await Task.run(traverse([3, 2, 1]));
      const duration = Date.now() - start;

      expect(result).toEqual([3, 2, 1]);
      expect(completed).toBe(3);
      // should take ~30ms (max), not 60ms (sum)
      expect(duration).toBeLessThan(50);
    });
  });

  describe("sequenceT", () => {
    it("should combine tuple of tasks", async () => {
      const t1 = Task.of(1);
      const t2 = Task.of("hello");
      const t3 = Task.of(true);
      const result = await Task.run(Task.sequenceT(t1, t2, t3));
      expect(result).toEqual([1, "hello", true]);
    });

    it("should handle empty tuple", async () => {
      const result = await Task.run(Task.sequenceT());
      expect(result).toEqual([]);
    });

    it("should propagate rejection", async () => {
      const t1 = Task.of(1);
      const t2 = Task.fromPromise(() => Promise.reject(new Error("fail")));
      const combined = Task.sequenceT(t1, t2);
      await expect(Task.run(combined)).rejects.toThrow("fail");
    });
  });

  describe("sequenceS", () => {
    it("should combine record of tasks", async () => {
      const tasks = {
        a: Task.of(1),
        b: Task.of("hello"),
        c: Task.of(true),
      };
      const result = await Task.run(Task.sequenceS(tasks));
      expect(result).toEqual({ a: 1, b: "hello", c: true });
    });

    it("should handle empty record", async () => {
      const result = await Task.run(Task.sequenceS({}));
      expect(result).toEqual({});
    });

    it("should propagate rejection", async () => {
      const tasks = {
        a: Task.of(1),
        b: Task.fromPromise(() => Promise.reject(new Error("fail"))),
      };
      const combined = Task.sequenceS(tasks);
      await expect(Task.run(combined)).rejects.toThrow("fail");
    });
  });

  describe("delay", () => {
    it("should delay execution", async () => {
      const start = Date.now();
      await Task.run(Task.delay(50));
      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(100);
    });

    it("should handle zero delay", async () => {
      const start = Date.now();
      await Task.run(Task.delay(0));
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10);
    });

    it("should handle negative delay as zero delay", async () => {
      const start = Date.now();
      await Task.run(Task.delay(-100));
      const duration = Date.now() - start;
      // negative values are treated as 0 by setTimeout
      expect(duration).toBeLessThan(10);
    });
  });

  describe("chainFirst", () => {
    it("should execute side effect but return original value", async () => {
      const sideEffect = vi.fn((n: number) => Task.of(`effect: ${n}`));
      const task = Task.of(42);
      const result = await Task.run(Task.chainFirst(sideEffect)(task));

      expect(result).toBe(42);
      expect(sideEffect).toHaveBeenCalledWith(42);
    });

    it("should propagate rejection from side effect", async () => {
      const sideEffect = (_n: number) =>
        Task.fromPromise(() => Promise.reject(new Error("side fail")));
      const task = Task.of(42);
      const chained = Task.chainFirst(sideEffect)(task);
      await expect(Task.run(chained)).rejects.toThrow("side fail");
    });

    it("should maintain laziness", async () => {
      const mainEffect = vi.fn(() => Promise.resolve(10));
      const sideEffect = vi.fn((n: number) => Promise.resolve(`side: ${n}`));

      const task = Task.fromPromise(mainEffect);
      const chained = Task.chainFirst((n: number) =>
        Task.fromPromise(() => sideEffect(n)),
      )(task);

      expect(mainEffect).not.toHaveBeenCalled();
      expect(sideEffect).not.toHaveBeenCalled();

      await Task.run(chained);

      expect(mainEffect).toHaveBeenCalledTimes(1);
      expect(sideEffect).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling with Result", () => {
    it("should work with Task<Result> for explicit error handling", async () => {
      const safeTask = (n: number): Task<Result<number, string>> =>
        n > 0
          ? Task.of(Result.ok(n * 2))
          : Task.of(Result.err("negative number"));

      const result1 = await Task.run(safeTask(5));
      expect(result1).toEqual({ success: true, data: 10 });

      const result2 = await Task.run(safeTask(-5));
      expect(result2).toEqual({ success: false, error: "negative number" });
    });
  });

  describe("Functor laws", () => {
    it("should satisfy identity law: map(id) ≅ id", async () => {
      const task = Task.of(42);
      const id = <T,>(x: T) => x;
      const mapped = Task.map(id)(task);

      const result1 = await Task.run(task);
      const result2 = await Task.run(mapped);
      expect(result1).toEqual(result2);
    });

    it("should satisfy composition law: map(g∘f) ≅ map(g)∘map(f)", async () => {
      const task = Task.of(10);
      const f = (n: number) => n * 2;
      const g = (n: number) => n + 1;

      const composed1 = Task.map((x: number) => g(f(x)))(task);
      const composed2 = Task.map(g)(Task.map(f)(task));

      const result1 = await Task.run(composed1);
      const result2 = await Task.run(composed2);
      expect(result1).toEqual(result2);
    });
  });

  describe("Monad laws", () => {
    it("should satisfy left identity: chain(f)(of(x)) ≅ f(x)", async () => {
      const x = 42;
      const f = (n: number) => Task.of(n * 2);

      const result1 = await Task.run(Task.chain(f)(Task.of(x)));
      const result2 = await Task.run(f(x));
      expect(result1).toEqual(result2);
    });

    it("should satisfy right identity: chain(of)(m) ≅ m", async () => {
      const task = Task.of(42);
      const chained = Task.chain(Task.of)(task);

      const result1 = await Task.run(task);
      const result2 = await Task.run(chained);
      expect(result1).toEqual(result2);
    });

    it("should satisfy associativity: chain(g)(chain(f)(m)) ≅ chain(x => chain(g)(f(x)))(m)", async () => {
      const task = Task.of(10);
      const f = (n: number) => Task.of(n * 2);
      const g = (n: number) => Task.of(n + 1);

      const left = Task.chain(g)(Task.chain(f)(task));
      const right = Task.chain((x: number) => Task.chain(g)(f(x)))(task);

      const result1 = await Task.run(left);
      const result2 = await Task.run(right);
      expect(result1).toEqual(result2);
    });
  });
});
