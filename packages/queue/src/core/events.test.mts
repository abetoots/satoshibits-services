/**
 * Tests for TypedEventEmitter
 *
 * TDD for REGRESSION-001 and REGRESSION-002
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TypedEventEmitter } from "./events.mjs";

describe("TypedEventEmitter", () => {
  let emitter: TypedEventEmitter;

  beforeEach(() => {
    emitter = new TypedEventEmitter();
  });

  describe("REGRESSION-001: off() should remove listeners", () => {
    it("should allow removing listeners that were added with on()", () => {
      const listener = vi.fn();

      // add listener
      emitter.on("active", listener);

      // verify listener is registered
      emitter.emit("active", {
        jobId: "test",
        queueName: "test",
        attempts: 1,
        status: "active",
      });
      expect(listener).toHaveBeenCalledTimes(1);

      // remove listener
      emitter.off("active", listener);

      // verify listener was removed
      emitter.emit("active", {
        jobId: "test2",
        queueName: "test",
        attempts: 1,
        status: "active",
      });
      expect(listener).toHaveBeenCalledTimes(1); // should still be 1, not 2
    });

    it("should handle removing non-existent listeners gracefully", () => {
      const listener = vi.fn();

      // try to remove a listener that was never added
      expect(() => {
        emitter.off("active", listener);
      }).not.toThrow();
    });

    it("should only remove the specific listener, not all listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on("active", listener1);
      emitter.on("active", listener2);

      // remove only listener1
      emitter.off("active", listener1);

      // emit event
      emitter.emit("active", {
        jobId: "test",
        queueName: "test",
        attempts: 1,
        status: "active",
      });

      // listener1 should not be called, listener2 should be called
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("REGRESSION-002: Error handling behavior", () => {
    describe("Fail-fast behavior (default on/once)", () => {
      it("should propagate synchronous errors from once() listeners", () => {
        const faultyListener = vi.fn(() => {
          throw new Error("Synchronous error in once listener");
        });

        emitter.once("active", faultyListener);

        // error should propagate (fail-fast)
        expect(() => {
          emitter.emit("active", {
            jobId: "test",
            queueName: "test",
            attempts: 1,
            status: "active",
          });
        }).toThrow("Synchronous error in once listener");
      });

      it("should only call once listener once even if error occurs", () => {
        const faultyListener = vi.fn(() => {
          throw new Error("Error");
        });

        emitter.once("active", faultyListener);

        // first emit throws
        expect(() => {
          emitter.emit("active", {
            jobId: "test",
            queueName: "test",
            attempts: 1,
            status: "active",
          });
        }).toThrow("Error");

        // second emit should not call listener (already removed)
        expect(() => {
          emitter.emit("active", {
            jobId: "test2",
            queueName: "test",
            attempts: 1,
            status: "active",
          });
        }).not.toThrow();

        // once listener should only be called once
        expect(faultyListener).toHaveBeenCalledTimes(1);
      });
    });

    describe("Safe error handling (onceSafe/onSafe)", () => {
      it("should catch synchronous errors in onceSafe listeners", async () => {
        const errorListener = vi.fn();
        emitter.on("queue.error", errorListener);

        const faultyListener = vi.fn(() => {
          throw new Error("Synchronous error in onceSafe listener");
        });

        emitter.onceSafe("active", faultyListener);

        // emit event - should not throw
        emitter.emit("active", {
          jobId: "test",
          queueName: "test",
          attempts: 1,
          status: "active",
        });

        // wait for async error handling
        await new Promise((resolve) => setTimeout(resolve, 50));

        // error should have been caught and emitted as queue.error
        expect(errorListener).toHaveBeenCalled();
        expect(errorListener.mock.calls[0]?.[0]).toMatchObject({
          queueName: "system",
          error: {
            type: "RuntimeError",
            code: "PROCESSING",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            message: expect.stringContaining(
              "Synchronous error in once listener",
            ),
          },
        });
      });

      it("should catch asynchronous errors in onceSafe listeners", async () => {
        const errorListener = vi.fn();
        emitter.on("queue.error", errorListener);

        // eslint-disable-next-line @typescript-eslint/require-await
        const faultyListener = vi.fn(async () => {
          throw new Error("Async error in onceSafe listener");
        });

        emitter.onceSafe("active", faultyListener);

        // emit event - should not throw
        emitter.emit("active", {
          jobId: "test",
          queueName: "test",
          attempts: 1,
          status: "active",
        });

        // wait for async error handling
        await new Promise((resolve) => setTimeout(resolve, 50));

        // error should have been caught and emitted as queue.error
        expect(errorListener).toHaveBeenCalled();
        expect(errorListener.mock.calls[0]?.[0]).toMatchObject({
          queueName: "system",
          error: {
            type: "RuntimeError",
            code: "PROCESSING",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            message: expect.stringContaining("Error in once listener"),
          },
        });
      });

      it("should catch asynchronous errors in onSafe listeners", async () => {
        const errorListener = vi.fn();
        emitter.on("queue.error", errorListener);

        // eslint-disable-next-line @typescript-eslint/require-await
        const faultyListener = vi.fn(async () => {
          throw new Error("Async error in onSafe listener");
        });

        emitter.onSafe("active", faultyListener);

        // emit event - should not throw
        emitter.emit("active", {
          jobId: "test",
          queueName: "test",
          attempts: 1,
          status: "active",
        });

        // wait for async error handling
        await new Promise((resolve) => setTimeout(resolve, 50));

        // error should have been caught and emitted as queue.error
        expect(errorListener).toHaveBeenCalled();
        expect(errorListener.mock.calls[0]?.[0]).toMatchObject({
          queueName: "system",
          error: {
            type: "RuntimeError",
            code: "PROCESSING",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            message: expect.stringContaining("Error in on listener"),
          },
        });
      });

      it("should not crash on promise rejection in onceSafe listener", async () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          .mockImplementation(() => {});

        const faultyListener = vi.fn(async () => {
          return Promise.reject(new Error("Promise rejection"));
        });

        emitter.onceSafe("active", faultyListener);

        // emit event - should not throw
        emitter.emit("active", {
          jobId: "test",
          queueName: "test",
          attempts: 1,
          status: "active",
        });

        // wait for async handling
        await new Promise((resolve) => setTimeout(resolve, 50));

        // should not crash
        expect(faultyListener).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });

      it("should allow removing onSafe listeners with off()", () => {
        const listener = vi.fn();

        // add safe listener
        emitter.onSafe("active", listener);

        // verify listener is registered
        emitter.emit("active", {
          jobId: "test",
          queueName: "test",
          attempts: 1,
          status: "active",
        });
        expect(listener).toHaveBeenCalledTimes(1);

        // remove listener
        emitter.off("active", listener);

        // verify listener was removed
        emitter.emit("active", {
          jobId: "test2",
          queueName: "test",
          attempts: 1,
          status: "active",
        });
        expect(listener).toHaveBeenCalledTimes(1); // should still be 1, not 2
      });
    });
  });

  describe("Existing functionality should still work", () => {
    it("should emit and listen to events with on()", () => {
      const listener = vi.fn();
      emitter.on("active", listener);

      emitter.emit("active", {
        jobId: "test",
        queueName: "test",
        attempts: 1,
        status: "active",
      });

      expect(listener).toHaveBeenCalledWith({
        jobId: "test",
        queueName: "test",
        attempts: 1,
        status: "active",
      });
    });

    it("should only call once listener once", () => {
      const listener = vi.fn();
      emitter.once("active", listener);

      emitter.emit("active", {
        jobId: "test",
        queueName: "test",
        attempts: 1,
        status: "active",
      });

      emitter.emit("active", {
        jobId: "test2",
        queueName: "test",
        attempts: 1,
        status: "active",
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should remove all listeners with removeAllListeners()", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on("active", listener1);
      emitter.on("active", listener2);

      emitter.removeAllListeners("active");

      emitter.emit("active", {
        jobId: "test",
        queueName: "test",
        attempts: 1,
        status: "active",
      });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });
});
