/* eslint-disable @typescript-eslint/require-await */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { batchAsync, debounce, throttle, timingUtils } from "./performance.mjs";

describe("performance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("debounce", () => {
    it("should delay function execution", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced("first");
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("first");
    });

    it("should cancel previous calls when called again", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced("first");
      vi.advanceTimersByTime(50);

      debounced("second");
      vi.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("second");
    });

    it("should handle multiple arguments", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced("arg1", "arg2", "arg3");
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("arg1", "arg2", "arg3");
    });

    it("should maintain separate timers for different instances", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const debounced1 = debounce(fn1, 100);
      const debounced2 = debounce(fn2, 100);

      debounced1("fn1");
      vi.advanceTimersByTime(50);
      debounced2("fn2");

      vi.advanceTimersByTime(50);
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("should clear timeout on rapid calls", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      // Make 10 rapid calls
      for (let i = 0; i < 10; i++) {
        debounced(i);
        vi.advanceTimersByTime(10);
      }

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(9); // Last call
    });

    it("should handle errors in debounced function", () => {
      const error = new Error("Test error");
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });
      const debounced = debounce(fn, 100);

      debounced();
      expect(() => vi.advanceTimersByTime(100)).toThrow(error);
    });
  });

  describe("throttle", () => {
    it("should execute immediately on first call", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled("first");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("first");
    });

    it("should ignore calls during throttle period", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled("first");
      throttled("second");
      throttled("third");

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("first");
    });

    it("should allow execution after throttle period", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled("first");
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);

      throttled("second");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith("second");
    });

    it("should handle multiple arguments", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled("arg1", "arg2", "arg3");
      expect(fn).toHaveBeenCalledWith("arg1", "arg2", "arg3");
    });

    it("should preserve this context", () => {
      const obj = {
        count: 0,
        increment(this: { count: number }) {
          this.count++;
          return this.count;
        },
      };

      const throttledIncrement = throttle(obj.increment.bind(obj), 100);
      const result = throttledIncrement();

      expect(result).toBe(1);
      expect(obj.count).toBe(1);
    });

    it("should handle rapid calls correctly", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      // First call executes
      throttled(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(1);

      // Rapid calls during throttle period are ignored
      for (let i = 2; i <= 10; i++) {
        throttled(i);
      }
      expect(fn).toHaveBeenCalledTimes(1);

      // After throttle period, next call executes
      vi.advanceTimersByTime(100);
      throttled(11);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith(11);
    });

    it("should maintain separate timers for different instances", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const throttled1 = throttle(fn1, 100);
      const throttled2 = throttle(fn2, 200);

      throttled1("fn1-1");
      throttled2("fn2-1");
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      throttled1("fn1-2");
      throttled2("fn2-2"); // Still throttled
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn2).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      throttled2("fn2-3");
      expect(fn2).toHaveBeenCalledTimes(2);
    });
  });

  describe("batchAsync", () => {
    it("should process items in batches", async () => {
      vi.useRealTimers(); // batchAsync uses real promises

      const processItem = vi
        .fn()
        .mockImplementation((item: number) => Promise.resolve(item * 2));

      const items = [1, 2, 3, 4, 5];
      const results = await batchAsync(items, processItem, 2, 0);

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(processItem).toHaveBeenCalledTimes(5);

      // Check batching - first batch processes items 0-1
      expect(processItem).toHaveBeenNthCalledWith(1, 1);
      expect(processItem).toHaveBeenNthCalledWith(2, 2);

      vi.useFakeTimers();
    });

    it("should add delay between batches", async () => {
      vi.useRealTimers();

      const processItem = vi
        .fn()
        .mockImplementation((item: number) => Promise.resolve(item * 2));

      const startTime = Date.now();
      const items = [1, 2, 3, 4, 5];

      // 2 items per batch with 100ms delay should take ~200ms
      await batchAsync(items, processItem, 2, 100);

      const endTime = Date.now();
      const elapsed = endTime - startTime;

      // Should have 3 batches: [1,2], [3,4], [5]
      // So 2 delays of 100ms each = 200ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(200);

      vi.useFakeTimers();
    });

    it("should handle async errors", async () => {
      vi.useRealTimers();

      const processItem = vi.fn().mockImplementation((item: number) => {
        if (item === 3) {
          return Promise.reject(new Error("Failed on 3"));
        }
        return Promise.resolve(item * 2);
      });

      const items = [1, 2, 3, 4, 5];

      await expect(batchAsync(items, processItem, 2, 0)).rejects.toThrow(
        "Failed on 3",
      );

      // Should have processed first batch before error
      expect(processItem).toHaveBeenCalledWith(1);
      expect(processItem).toHaveBeenCalledWith(2);
      expect(processItem).toHaveBeenCalledWith(3);

      vi.useFakeTimers();
    });

    it("should handle empty array", async () => {
      vi.useRealTimers();

      const processItem = vi.fn();
      const results = await batchAsync([], processItem, 2, 0);

      expect(results).toEqual([]);
      expect(processItem).not.toHaveBeenCalled();

      vi.useFakeTimers();
    });

    it("should use default batch size and delay", async () => {
      vi.useRealTimers();

      const processItem = vi
        .fn()
        .mockImplementation((item: number) => Promise.resolve(item));

      const items = Array.from({ length: 25 }, (_, i) => i);
      const results = await batchAsync(items, processItem);

      expect(results).toHaveLength(25);
      expect(processItem).toHaveBeenCalledTimes(25);

      vi.useFakeTimers();
    });

    it("should process large batches correctly", async () => {
      vi.useRealTimers();

      const processItem = vi
        .fn()
        .mockImplementation((item: number) => Promise.resolve(item * 2));

      const items = Array.from({ length: 100 }, (_, i) => i);
      const results = await batchAsync(items, processItem, 25, 0);

      expect(results).toHaveLength(100);
      expect(results[0]).toBe(0);
      expect(results[99]).toBe(198);

      vi.useFakeTimers();
    });

    it("should maintain order of results", async () => {
      vi.useRealTimers();

      const processItem = vi.fn().mockImplementation((item: number) => {
        // Simulate varying processing times
        const delay = Math.random() * 10;
        return new Promise((resolve) => setTimeout(() => resolve(item), delay));
      });

      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results = await batchAsync(items, processItem, 3, 0);

      expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      vi.useFakeTimers();
    });
  });

  describe("timingUtils.measureTime", () => {
    it("invokes onComplete with duration for synchronous success", () => {
      vi.useRealTimers();
      const nowSpy = vi
        .spyOn(performance, "now")
        .mockImplementationOnce(() => 100)
        .mockImplementationOnce(() => 150);
      const onComplete = vi.fn();

      const timed = timingUtils.measureTime(
        (value: number) => value * 2,
        onComplete,
      );
      const result = timed(21);

      expect(result).toBe(42);
      expect(onComplete).toHaveBeenCalledWith(50, 42);

      nowSpy.mockRestore();
      vi.useFakeTimers();
    });

    it("invokes onError when synchronous function throws", () => {
      vi.useRealTimers();
      const error = new Error("boom");
      const nowSpy = vi
        .spyOn(performance, "now")
        .mockImplementationOnce(() => 10)
        .mockImplementationOnce(() => 40);
      const onError = vi.fn();

      const timed = timingUtils.measureTime(
        () => {
          throw error;
        },
        undefined,
        onError,
      );

      expect(() => timed()).toThrow(error);
      expect(onError).toHaveBeenCalledWith(30, error);

      nowSpy.mockRestore();
      vi.useFakeTimers();
    });

    it("supports async successes and failures", async () => {
      vi.useRealTimers();
      let tick = 0;
      const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => {
        tick += 5;
        return tick;
      });
      const onComplete = vi.fn();
      const onError = vi.fn();

      const asyncSuccess = timingUtils.measureTime(
        async (value: number) => value + 1,
        onComplete,
        onError,
      );
      await expect(asyncSuccess(5)).resolves.toBe(6);
      expect(onComplete).toHaveBeenCalledWith(expect.any(Number), 6);

      const asyncError = timingUtils.measureTime(
        async () => {
          throw new Error("async boom");
        },
        onComplete,
        onError,
      );
      await expect(asyncError()).rejects.toThrow("async boom");
      expect(onError).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Error),
      );

      nowSpy.mockRestore();
      vi.useFakeTimers();
    });
  });
});
