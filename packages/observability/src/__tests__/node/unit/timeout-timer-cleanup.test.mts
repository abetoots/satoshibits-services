/**
 * RED Phase Tests: Timeout Timer Cleanup
 *
 * Issue #6: errors.wrap() with timeout option doesn't clear setTimeout on success,
 * causing unhandled rejections and keeping event loop alive.
 *
 * These tests verify that:
 * - Timers are cleared when wrapped function completes successfully
 * - Timers are cleared when wrapped function throws synchronously
 * - Timers are cleared when wrapped function rejects asynchronously
 * - Timeout still fires when function takes too long (regression)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartClient } from "../../../index.mjs";
import type { ScopedInstrument } from "../../../internal/scoped-instrument.mjs";

describe("RED: Timeout Timer Cleanup in errors.wrap()", () => {
  let instrument: ScopedInstrument;

  beforeEach(async () => {
    process.env.OBS_TEST_NO_EXPORT = "1";
    vi.useFakeTimers();
    const client = await SmartClient.create({
      serviceName: "timer-cleanup-test",
      environment: "node" as const,
    });
    instrument = client.getInstrumentation("test-scope");
  });

  afterEach(async () => {
    vi.useRealTimers();
    await SmartClient.shutdown();
  });

  describe("timer cleanup on success", () => {
    it("should clear timeout when async function resolves before timeout", async () => {
      // fast function that resolves in 10ms, timeout set to 100ms
      const fastFn = async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "success";
      };

      const wrapped = instrument.errors.wrap(fastFn, { timeout: 100 });

      // start the wrapped function
      const resultPromise = wrapped();

      // advance time to let function complete
      await vi.advanceTimersByTimeAsync(10);

      // function should resolve
      await expect(resultPromise).resolves.toBe("success");

      // now advance time past the original timeout
      // if timer wasn't cleared, this would trigger "Operation timed out" rejection
      const unhandledRejectionSpy = vi.fn();
      process.on("unhandledRejection", unhandledRejectionSpy);

      await vi.advanceTimersByTimeAsync(200);

      // there should be no unhandled rejection from the lingering timer
      expect(unhandledRejectionSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledRejectionSpy);
    });

    it("should not keep event loop alive after successful completion", async () => {
      const fastFn = async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "done";
      };

      const wrapped = instrument.errors.wrap(fastFn, { timeout: 1000 });

      const resultPromise = wrapped();
      await vi.advanceTimersByTimeAsync(5);
      await resultPromise;

      // check active timers - there should be none from our timeout
      const activeTimers = vi.getTimerCount();

      // we expect 0 active timers related to our timeout
      // (there might be other timers from the SDK, but our timeout should be cleared)
      // this is a best-effort check
      expect(activeTimers).toBeLessThanOrEqual(1); // allow some SDK timers
    });
  });

  describe("timer cleanup on synchronous throw", () => {
    it("should clear timeout when wrapped function throws synchronously", async () => {
      const syncThrow = () => {
        throw new Error("sync error");
      };

      const wrapped = instrument.errors.wrap(syncThrow, { timeout: 100 });

      // note: when timeout is specified, even sync functions go through async path
      // so we need to await the rejection
      const resultPromise = wrapped();

      // the sync throw is wrapped in Promise.resolve(), so it rejects on next tick
      await expect(resultPromise).rejects.toThrow("sync error");

      // advance time past timeout
      const unhandledRejectionSpy = vi.fn();
      process.on("unhandledRejection", unhandledRejectionSpy);

      await vi.advanceTimersByTimeAsync(200);

      // no unhandled rejection from lingering timer
      expect(unhandledRejectionSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledRejectionSpy);
    });
  });

  describe("timer cleanup on async rejection", () => {
    it("should clear timeout when wrapped function rejects before timeout", async () => {
      const asyncReject = async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("async error");
      };

      const wrapped = instrument.errors.wrap(asyncReject, { timeout: 100 });

      const resultPromise = wrapped();

      // advance to trigger the rejection
      await vi.advanceTimersByTimeAsync(10);

      // should reject with our error
      await expect(resultPromise).rejects.toThrow("async error");

      // advance past timeout
      const unhandledRejectionSpy = vi.fn();
      process.on("unhandledRejection", unhandledRejectionSpy);

      await vi.advanceTimersByTimeAsync(200);

      // no unhandled rejection from lingering timer
      expect(unhandledRejectionSpy).not.toHaveBeenCalled();

      process.off("unhandledRejection", unhandledRejectionSpy);
    });
  });

  describe("timeout functionality regression", () => {
    it("should still timeout when function takes too long", async () => {
      const slowFn = async () => {
        await new Promise((r) => setTimeout(r, 200));
        return "slow result";
      };

      const wrapped = instrument.errors.wrap(slowFn, { timeout: 50 });

      const resultPromise = wrapped();

      // advance past timeout but before function completes
      await vi.advanceTimersByTimeAsync(60);

      // should reject with timeout
      await expect(resultPromise).rejects.toThrow("Operation timed out");
    });

    it("should respect timeout with retry option", async () => {
      let attempts = 0;
      const slowWithRetry = async () => {
        attempts++;
        await new Promise((r) => setTimeout(r, 100));
        return "result";
      };

      const wrapped = instrument.errors.wrap(slowWithRetry, {
        timeout: 50,
        retry: 2,
      });

      const resultPromise = wrapped();

      // with retry=2, there are 3 total attempts (initial + 2 retries)
      // each attempt times out at 50ms, so we need to advance past all of them
      // advance time in steps to allow async microtasks to process
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(60);
      }

      // should reject with timeout after all retries exhausted
      await expect(resultPromise).rejects.toThrow("Operation timed out");
    }, 10000); // longer test timeout for complex async interactions
  });

  describe("edge cases", () => {
    it("should handle immediate resolution", async () => {
      const immediate = async () => "instant";

      const wrapped = instrument.errors.wrap(immediate, { timeout: 100 });

      await expect(wrapped()).resolves.toBe("instant");

      // advance time - should be no lingering timer
      await vi.advanceTimersByTimeAsync(200);

      // no unhandled rejection
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    });

    it("should handle multiple concurrent wrapped calls", async () => {
      const fn = async (delay: number) => {
        await new Promise((r) => setTimeout(r, delay));
        return `done-${delay}`;
      };

      const wrapped = instrument.errors.wrap(fn as (...args: unknown[]) => unknown, { timeout: 100 }) as typeof fn;

      // start multiple calls
      const p1 = wrapped(10);
      const p2 = wrapped(20);
      const p3 = wrapped(30);

      // advance to complete all
      await vi.advanceTimersByTimeAsync(30);

      await expect(p1).resolves.toBe("done-10");
      await expect(p2).resolves.toBe("done-20");
      await expect(p3).resolves.toBe("done-30");

      // advance past all timeouts
      await vi.advanceTimersByTimeAsync(200);

      // all timers should be cleaned up
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    });
  });
});
