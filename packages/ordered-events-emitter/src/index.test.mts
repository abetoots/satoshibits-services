/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMainThread } from "worker_threads";

import type {
  EmitterOptions,
  ListenerSignature,
  MessageChannel,
  ThreadMessage,
} from "./index.mjs";

import {
  createConnectedWorker,
  createTypedEmitter,
  setupMainThreadHandlers,
  setupWorkerConnection,
  ThreadedOrderedEventEmitter,
} from "./index.mjs";

// Mock globalThis.BroadcastChannel for browser-like environment
const mockGlobalBroadcastChannel = {
  postMessage: vi.fn(),
  close: vi.fn(),
  onmessage: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Mock worker_threads and BroadcastChannel
vi.mock("worker_threads", () => {
  return {
    isMainThread: true,
    BroadcastChannel: vi.fn(() => mockGlobalBroadcastChannel),
    parentPort: null,
    Worker: vi.fn(),
  };
});

interface EventRecord {
  testEvent: (arg1: string, arg2: number) => void;
  anotherEvent: (data: { value: string }) => void;
  asyncEvent: (arg: string) => Promise<void> | void;
  errorEvent: () => void;
}

type TestEvents = ListenerSignature<EventRecord>;

describe("ThreadedOrderedEventEmitter", () => {
  let emitter: ThreadedOrderedEventEmitter<TestEvents>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(() => mockGlobalBroadcastChannel),
    );

    // Ensure a fresh instance for each test, not relying on the registry for basic tests initially
    // Also, clear the emitterRegistry manually to ensure true isolation between test files if run in same context
    ThreadedOrderedEventEmitter.clearRegistry();
    emitter = new ThreadedOrderedEventEmitter<TestEvents>({
      threadId: "main-test",
    });
  });

  afterEach(() => {
    emitter?.clear(); // Clean up the specific instance
    // Clear the registry again to be absolutely sure for subsequent test files
    ThreadedOrderedEventEmitter.clearRegistry();
    vi.clearAllMocks(); // Clear all mocks including global ones
    vi.unstubAllGlobals(); // Reset all global mocks
  });

  describe("Constructor and Singleton", () => {
    it("should create an instance with default options", () => {
      expect(emitter).toBeInstanceOf(ThreadedOrderedEventEmitter);
      expect(emitter.getChannelName()).toBe("threaded-ordered-events");
      expect(emitter.getThreadId()).toBe("main-test"); // As provided
    });

    it("should use BroadcastChannel if available", () => {
      const bcEmitter = new ThreadedOrderedEventEmitter({
        channelName: "bc-test",
      });
      expect(globalThis.BroadcastChannel);
      bcEmitter.clear();
    });

    it("should fallback to parentPort if BroadcastChannel is not available and in worker", async () => {
      vi.stubGlobal("BroadcastChannel", undefined); // Simulate BC not available
      const wt = await vi.mocked(import("worker_threads"));
      wt.isMainThread = false;
      //@ts-expect-error no need to mock other properties
      wt.parentPort = { postMessage: vi.fn(), on: vi.fn() };

      const workerEmitter = new ThreadedOrderedEventEmitter({
        threadId: "worker-test-pp",
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(wt.parentPort?.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );
      workerEmitter.clear();
    });

    it("getInstance should return the same instance for the same channelName", () => {
      const opts: EmitterOptions = { channelName: "singleton-test" };
      const instance1 =
        ThreadedOrderedEventEmitter.getInstance<TestEvents>(opts);
      const instance2 =
        ThreadedOrderedEventEmitter.getInstance<TestEvents>(opts);
      expect(instance1).toBe(instance2);
      instance1.clear(); // Clean up
    });

    it("getInstance should return a new instance for a different channelName", () => {
      const instance1 = ThreadedOrderedEventEmitter.getInstance<TestEvents>({
        channelName: "singleton-1",
      });
      const instance2 = ThreadedOrderedEventEmitter.getInstance<TestEvents>({
        channelName: "singleton-2",
      });
      expect(instance1).not.toBe(instance2);
      instance1.clear();
      instance2.clear();
    });
  });

  describe("Listener Management", () => {
    it("should add and remove listeners (on/off)", () => {
      const listener = vi.fn();
      emitter.on("testEvent", listener);
      expect(emitter.listenerCount("testEvent")).toBe(1);
      emitter.emitSimple("testEvent", "hello", 42);
      expect(listener).toHaveBeenCalledWith("hello", 42);

      emitter.off("testEvent", listener);
      expect(emitter.listenerCount("testEvent")).toBe(0);
    });

    it("addListener should be an alias for on", () => {
      const listener = vi.fn();
      emitter.addListener("testEvent", listener);
      expect(emitter.listenerCount("testEvent")).toBe(1);
      emitter.emitSimple("testEvent", "hello", 42);
      expect(listener).toHaveBeenCalledWith("hello", 42);
      emitter.off("testEvent", listener);
    });

    it("should add a one-time listener (once)", () => {
      const listener = vi.fn();
      emitter.once("testEvent", listener);
      expect(emitter.listenerCount("testEvent")).toBe(1);

      emitter.emitSimple("testEvent", "hello", 1);
      expect(listener).toHaveBeenCalledWith("hello", 1);
      expect(emitter.listenerCount("testEvent")).toBe(0); // Should be removed

      emitter.emitSimple("testEvent", "world", 2);
      expect(listener).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it("should remove listener by key (offByKey)", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on("testEvent", listener1, 0, "key1");
      emitter.on("testEvent", listener2, 0, "key2");
      expect(emitter.listenerCount("testEvent")).toBe(2);

      emitter.offByKey("testEvent", "key1");
      expect(emitter.listenerCount("testEvent")).toBe(1);
      expect(emitter.getListeners("testEvent")[0]?.key).toBe("key2");

      emitter.emitSimple("testEvent", "test", 1);
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it("should remove all listeners for an event (offAll)", () => {
      emitter.on("testEvent", vi.fn());
      emitter.on("testEvent", vi.fn());
      emitter.on("anotherEvent", vi.fn());
      expect(emitter.listenerCount("testEvent")).toBe(2);
      expect(emitter.listenerCount("anotherEvent")).toBe(1);

      emitter.offAll("testEvent");
      expect(emitter.listenerCount("testEvent")).toBe(0);
      expect(emitter.listenerCount("anotherEvent")).toBe(1);
    });

    it("hasListeners should return true if listeners exist, false otherwise", () => {
      expect(emitter.hasListeners("testEvent")).toBe(false);
      emitter.on("testEvent", vi.fn());
      expect(emitter.hasListeners("testEvent")).toBe(true);
      emitter.offAll("testEvent");
      expect(emitter.hasListeners("testEvent")).toBe(false);
    });

    it("getListeners should return an array of listener info objects", () => {
      const listener = vi.fn();
      emitter.on("testEvent", listener, 10, "myKey");
      const listeners = emitter.getListeners("testEvent");
      expect(listeners).toHaveLength(1);
      expect(listeners[0]!.listener).toBeDefined(); // The actual function for once is wrapped
      expect(listeners[0]!.priority).toBe(10);
      expect(listeners[0]!.key).toBe("myKey");
    });

    it("eventNames should return an array of registered event names", () => {
      emitter.on("testEvent", vi.fn());
      emitter.on("anotherEvent", vi.fn());
      const names = emitter.eventNames();
      expect(names).toHaveLength(2);
      expect(names).toContain("testEvent");
      expect(names).toContain("anotherEvent");
    });
  });

  describe("Event Emission (Synchronous)", () => {
    it("emit should call listeners with arguments", () => {
      const listener = vi.fn();
      emitter.on("testEvent", listener);
      emitter.emit({ event: "testEvent" }, "data", 123);
      expect(listener).toHaveBeenCalledWith("data", 123);
    });

    it("emitSimple should call listeners", () => {
      const listener = vi.fn();
      emitter.on("testEvent", listener);
      emitter.emitSimple("testEvent", "simple", 456);
      expect(listener).toHaveBeenCalledWith("simple", 456);
    });

    it("emitLocal should call listeners but not broadcast", async () => {
      const listener = vi.fn();
      emitter.on("testEvent", listener);
      emitter.emitLocal("testEvent", "local", 789);
      expect(listener).toHaveBeenCalledWith("local", 789);
      expect(mockGlobalBroadcastChannel.postMessage).not.toHaveBeenCalled();
      const wt = await vi.mocked(import("worker_threads"));
      if (wt.parentPort?.postMessage) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(wt.parentPort.postMessage).not.toHaveBeenCalled();
      }
    });

    it("should execute listeners based on priority (highestFirst by default)", () => {
      console.log("isMainThread", isMainThread);
      const callOrder: string[] = [];
      const listenerLow = vi.fn(() => callOrder.push("low"));
      const listenerMid = vi.fn(() => callOrder.push("mid"));
      const listenerHigh = vi.fn(() => callOrder.push("high"));
      const listenerZero1 = vi.fn(() => callOrder.push("zero1"));
      const listenerZero2 = vi.fn(() => callOrder.push("zero2"));

      emitter.on("testEvent", listenerLow, 1);
      emitter.on("testEvent", listenerMid, 5);
      emitter.on("testEvent", listenerHigh, 10);
      emitter.on("testEvent", listenerZero1, 0); // Zero priority
      emitter.on("testEvent", listenerZero2, 0); // Zero priority

      emitter.emitSimple("testEvent", "prio", 1);

      // wait for the next tick to ensure all listeners are called
      //   await new Promise((resolve) => setTimeout(resolve, 0));

      // Zero priority listeners run first (in order of addition), then prioritized
      expect(callOrder).toEqual(["zero1", "zero2", "high", "mid", "low"]);
      expect(listenerHigh).toHaveBeenCalled();
      expect(listenerMid).toHaveBeenCalled();
      expect(listenerLow).toHaveBeenCalled();
      expect(listenerZero1).toHaveBeenCalled();
      expect(listenerZero2).toHaveBeenCalled();
    });

    it("should execute listeners based on priority (lowestFirst)", () => {
      const callOrder: string[] = [];
      const listenerLow = vi.fn(() => callOrder.push("low"));
      const listenerMid = vi.fn(() => callOrder.push("mid"));
      const listenerHigh = vi.fn(() => callOrder.push("high"));
      const listenerZero = vi.fn(() => callOrder.push("zero"));

      emitter.on("testEvent", listenerLow, 1);
      emitter.on("testEvent", listenerMid, 5);
      emitter.on("testEvent", listenerHigh, 10);
      emitter.on("testEvent", listenerZero, 0);

      emitter.emit(
        { event: "testEvent", priorityBehavior: "lowestFirst" },
        "prio",
        1,
      );
      expect(callOrder).toEqual(["zero", "low", "mid", "high"]);
    });

    it("should allow custom listener arrangement", () => {
      const callOrder: string[] = [];
      const listenerA = vi.fn(() => callOrder.push("A"));
      const listenerB = vi.fn(() => callOrder.push("B"));

      emitter.on("testEvent", listenerA, 1, "A");
      emitter.on("testEvent", listenerB, 2, "B");

      emitter.emit(
        {
          event: "testEvent",
          //Should ignore priority and call listeners in reverse order
          //from the order they were added
          arrangeListeners: (listeners) => listeners.reverse(),
        },
        "custom",
        1,
      );

      expect(callOrder).toEqual(["B", "A"]);
    });
  });

  describe("Event Emission (Asynchronous)", () => {
    it("emitAsync should call async listeners and wait (highestFirst)", async () => {
      const callOrder: string[] = [];
      const listenerLow = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push("low");
      });
      const listenerHigh = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        callOrder.push("high");
      });
      const listenerZero = vi.fn(() => {
        callOrder.push("zero");
      });

      emitter.on("asyncEvent", listenerLow, 1);
      emitter.on("asyncEvent", listenerHigh, 10);
      emitter.on("asyncEvent", listenerZero, 0);

      await emitter.emitAsync({ event: "asyncEvent" }, "async test");

      // Zero runs sync, then high, then low
      expect(callOrder).toEqual(["zero", "high", "low"]);
      expect(listenerHigh).toHaveBeenCalled();
      expect(listenerLow).toHaveBeenCalled();
      expect(listenerZero).toHaveBeenCalled();
    });

    it("emitAsyncSimple should call async listeners", async () => {
      const listener = vi.fn(async () => {});
      emitter.on("asyncEvent", listener);
      await emitter.emitAsyncSimple("asyncEvent", "async simple");
      expect(listener).toHaveBeenCalledWith("async simple");
    });

    it("emitAsyncLocal should call listeners locally and wait", async () => {
      const listener = vi.fn(async () => {});
      emitter.on("asyncEvent", listener);
      await emitter.emitAsyncLocal("asyncEvent", "async local");
      expect(listener).toHaveBeenCalledWith("async local");
      expect(mockGlobalBroadcastChannel.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("Event History", () => {
    it("should record events in history", () => {
      emitter.setMaxHistoryLength(3);
      emitter.emitSimple("testEvent", "e1", 1);
      emitter.emitSimple("anotherEvent", { value: "e2" });
      emitter.emitSimple("testEvent", "e3", 3);
      let history = emitter.getEventHistory();
      expect(history).toHaveLength(3);
      expect(history[0]!.event).toBe("testEvent");
      expect(history[0]!.args).toEqual(["e1", 1]);
      expect(history[2]!.event).toBe("testEvent");

      emitter.emitSimple("anotherEvent", { value: "e4" }); // This should push out 'e1'
      history = emitter.getEventHistory();
      expect(history).toHaveLength(3);
      expect(history[0]!.event).toBe("anotherEvent");
      expect(history[0]!.args[0]).toEqual({ value: "e2" });
      expect(history[2]!.args[0]).toEqual({ value: "e4" });
    });

    it("getEventHistory should respect the limit", () => {
      emitter.setMaxHistoryLength(10);
      for (let i = 0; i < 5; i++) {
        emitter.emitSimple("testEvent", `event ${i}`, i);
      }
      expect(emitter.getEventHistory(2)).toHaveLength(2);
      expect(emitter.getEventHistory(10)).toHaveLength(5);
    });

    it("setMaxHistoryLength should trim history if new length is smaller", () => {
      emitter.setMaxHistoryLength(5);
      for (let i = 0; i < 5; i++) {
        emitter.emitSimple("testEvent", `msg ${i}`, i);
      }
      expect(emitter.getEventHistory()).toHaveLength(5);
      emitter.setMaxHistoryLength(2);
      const history = emitter.getEventHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.args[0]).toBe("msg 3");
      expect(history[1]!.args[0]).toBe("msg 4");
    });
  });

  describe("Debug Mode", () => {
    it("setDebugMode should enable/disable debug logging", () => {
      const consoleDebugSpy = vi
        .spyOn(console, "debug")
        .mockImplementation(() => {});
      emitter.setDebugMode(true);
      emitter.emitSimple("testEvent", "debug", 1);
      expect(consoleDebugSpy).toHaveBeenCalled();
      consoleDebugSpy.mockClear();

      emitter.setDebugMode(false);
      emitter.emitSimple("testEvent", "no-debug", 2);
      expect(consoleDebugSpy).not.toHaveBeenCalled();
      consoleDebugSpy.mockRestore();
    });
  });

  describe("Serialization and Deserialization", () => {
    it("should use onSerializeThreadMessage for broadcasting", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const serializeFn = vi.fn((args) => ({ serialized: args }));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
      const deserializeFn = vi.fn((args) => args.serialized); // For receiving side
      emitter.onSerializeThreadMessage = serializeFn;
      emitter.onDeserializeThreadMessage = deserializeFn; // Not directly tested here, but good to have a pair

      emitter.emit({ event: "testEvent" }, "data", 1); // This will trigger broadcast
      expect(serializeFn).toHaveBeenCalledWith(["data", 1]);
      expect(mockGlobalBroadcastChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { serialized: ["data", 1] },
        }),
      );
    });

    it("should use onDeserializeThreadMessage when handling thread message", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      const deserializeFn = vi.fn((args) => [
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        { deserialized: args[0] },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        args[1],
      ]);
      emitter.onDeserializeThreadMessage = deserializeFn;
      const localListener = vi.fn();
      emitter.on("testEvent", localListener);

      const message: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "testEvent",
        args: ["original_data", 123],
        sourceThreadId: "other-thread",
      };

      // Simulate receiving a message (bypass actual channel)
      //@ts-expect-error marked as private but still accessible in javascript
      emitter.handleThreadMessage(message);

      expect(deserializeFn).toHaveBeenCalledWith(["original_data", 123]);
      expect(localListener).toHaveBeenCalledWith(
        { deserialized: "original_data" },
        123,
      );
    });
  });

  describe("Error Handling in Listeners", () => {
    it("should call onListenerError for async errors", async () => {
      const errorCallback = vi.fn();
      emitter.onListenerError = errorCallback;

      const failingListener = vi.fn(() => {
        throw new Error("AsyncFail");
      });
      const succeedingListener = vi.fn(async () => {});

      emitter.on("asyncEvent", failingListener, 10);
      emitter.on("asyncEvent", succeedingListener, 5);

      await emitter.emitAsync({ event: "asyncEvent" }, "test");

      expect(failingListener).toHaveBeenCalled();
      expect(succeedingListener).toHaveBeenCalled(); // Should still run
      expect(errorCallback).toHaveBeenCalledWith(expect.any(Error), {
        source: "listener",
        event: "asyncEvent",
        key: undefined,
        priority: 10,
        sync: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(errorCallback.mock.calls[0]![0].message).toBe("AsyncFail");
    });

    it("should call onListenerError for sync errors", () => {
      const errorCallback = vi.fn();
      emitter.onListenerError = errorCallback;

      const failingListener = vi.fn(() => {
        throw new Error("SyncFail");
      });
      const succeedingListener = vi.fn(() => {});

      emitter.on("testEvent", failingListener, 10);
      emitter.on("testEvent", succeedingListener, 5);

      emitter.emitSimple("testEvent", "test", 2);

      expect(failingListener).toHaveBeenCalled();
      expect(succeedingListener).toHaveBeenCalled(); // Should still run
      expect(errorCallback).toHaveBeenCalledWith(expect.any(Error), {
        source: "listener",
        event: "testEvent",
        key: undefined,
        priority: 10,
        sync: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(errorCallback.mock.calls[0]![0].message).toBe("SyncFail");
    });
  });

  describe("Cross-thread Communication (Mocks)", () => {
    beforeEach(() => {
      // Clear any instance that might have been created in global scope by other tests
      ThreadedOrderedEventEmitter.clearRegistry();
      emitter = new ThreadedOrderedEventEmitter<TestEvents>({
        threadId: "main-comm-test",
      });
    });

    it("handleThreadMessage should process incoming messages and emit locally", () => {
      const localListener = vi.fn();
      emitter.on("testEvent", localListener);

      const message: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "testEvent",
        args: ["from_thread", 77],
        sourceThreadId: "worker-1",
      };

      // Simulate receiving a message (bypass actual channel)
      //@ts-expect-error marked as private but still accessible in javascript
      emitter.handleThreadMessage(message);

      expect(localListener).toHaveBeenCalledWith("from_thread", 77);
      // Ensure it emits locally (localOnly = true) to prevent re-broadcasting loop
      expect(mockGlobalBroadcastChannel.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          sourceThreadId: "main-comm-test",
          localOnly: false,
        }),
      );
    });

    it("handleThreadMessage should ignore messages from self", () => {
      const localListener = vi.fn();
      emitter.on("testEvent", localListener);

      const message: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "testEvent",
        args: ["from_self", 88],
        sourceThreadId: emitter.getThreadId(), // Message from self
      };

      // Simulate receiving a message (bypass actual channel)
      //@ts-expect-error marked as private but still accessible in javascript
      emitter.handleThreadMessage(message);
      expect(localListener).not.toHaveBeenCalled();
    });

    it("registerThreadMessageHandler should add and remove a handler", () => {
      const messageHandler = vi.fn();
      const removeHandler =
        emitter.registerThreadMessageHandler(messageHandler);

      const message: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "anotherEvent",
        args: [{ value: "from_handler" }],
        sourceThreadId: "worker-2",
      };
      // Simulate receiving a message (bypass actual channel)
      //@ts-expect-error marked as private but still accessible in javascript
      emitter.handleThreadMessage(message);
      expect(messageHandler).toHaveBeenCalledWith(message);

      removeHandler();
      messageHandler.mockClear();
      // Simulate receiving a message (bypass actual channel)
      //@ts-expect-error marked as private but still accessible in javascript
      emitter.handleThreadMessage(message);
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it("broadcastEvent should use BroadcastChannel primarily", () => {
      emitter.emit({ event: "testEvent" }, "payload", 1); // Not localOnly
      expect(mockGlobalBroadcastChannel.postMessage).toHaveBeenCalledTimes(1);
      expect(mockGlobalBroadcastChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "testEvent",
          args: ["payload", 1],
          sourceThreadId: emitter.getThreadId(),
        }),
      );
    });

    it("broadcastEvent should use parentPort if no BroadcastChannel and in worker", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const wt = await vi.mocked(import("worker_threads"));
      wt.isMainThread = false;
      const mockParentPort = { postMessage: vi.fn(), on: vi.fn() };
      //@ts-expect-error no need to mock other properties
      wt.parentPort = mockParentPort;

      // Need a new emitter instance for this specific mocked environment
      const workerEmitter = new ThreadedOrderedEventEmitter({
        threadId: "worker-bc-fallback",
      });
      workerEmitter.emit({ event: "testEvent" }, "to_parent", 2); // Not localOnly

      expect(mockParentPort.postMessage).toHaveBeenCalledTimes(1);
      expect(mockParentPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "testEvent",
          args: ["to_parent", 2],
        }),
      );
      workerEmitter.clear();
    });

    it("connectPort should listen to messages from the port (addEventListener)", () => {
      const mockPort: MessageChannel = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const cleanup = emitter.connectPort(mockPort);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPort.addEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );

      // Simulate message from port
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const portMessageHandler = (
        mockPort.addEventListener as ReturnType<typeof vi.fn>
      ).mock.calls[0]![1];
      const testMessage: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "testEvent",
        args: ["from_port"],
        sourceThreadId: "port-1",
      };
      const localListener = vi.fn();
      emitter.on("testEvent", localListener);

      portMessageHandler({ data: testMessage }); // Browser-style event
      expect(localListener).toHaveBeenCalledWith("from_port");

      cleanup();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPort.removeEventListener).toHaveBeenCalledWith(
        "message",
        portMessageHandler,
      );
    });

    it("connectPort should listen to messages from the port (on/off if addEventListener is not present)", () => {
      const mockPortNodeStyle: MessageChannel = {
        postMessage: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      };
      const cleanup = emitter.connectPort(mockPortNodeStyle);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPortNodeStyle.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const portMessageHandler = (
        mockPortNodeStyle.on as ReturnType<typeof vi.fn>
      ).mock.calls[0]![1];
      const testMessage: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "testEvent",
        args: ["from_node_port"],
        sourceThreadId: "node-port-1",
      };
      const localListener = vi.fn();
      emitter.on("testEvent", localListener);

      portMessageHandler(testMessage); // Node.js style direct message
      expect(localListener).toHaveBeenCalledWith("from_node_port");

      cleanup();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPortNodeStyle.off).toHaveBeenCalledWith(
        "message",
        portMessageHandler,
      );
    });

    it("connectWorker should listen to messages from the worker", () => {
      const mockWorkerInstance = {
        postMessage: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      };

      //@ts-expect-error no need to mock other properties
      const cleanup = emitter.connectWorker(mockWorkerInstance);
      expect(mockWorkerInstance.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const workerMessageHandler = mockWorkerInstance.on.mock.calls[0]![1];
      const testMessage: ThreadMessage<keyof TestEvents, unknown[]> = {
        type: "event",
        event: "testEvent",
        args: ["from_worker_connect"],
        sourceThreadId: "worker-instance-1",
      };
      const localListener = vi.fn();
      emitter.on("testEvent", localListener);

      workerMessageHandler(testMessage);
      expect(localListener).toHaveBeenCalledWith("from_worker_connect");

      cleanup();
      expect(mockWorkerInstance.off).toHaveBeenCalledWith(
        "message",
        workerMessageHandler,
      );
    });
  });

  describe("Resource Cleanup (clear)", () => {
    it("clear should remove all listeners, handlers, history and close channels", () => {
      emitter.on("testEvent", vi.fn());
      emitter.registerThreadMessageHandler(vi.fn());
      emitter.setMaxHistoryLength(10); // the history is opt-in
      emitter.emitSimple("testEvent", "hist", 1); // Add to history

      const mockPort: MessageChannel = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
      };
      emitter.connectPort(mockPort);

      const mockWorkerInstance = {
        postMessage: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      };

      //@ts-expect-error no need to mock other properties
      emitter.connectWorker(mockWorkerInstance);

      // Check initial state
      expect(emitter.hasListeners("testEvent")).toBe(true);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.messageHandlers.size).toBe(1);
      expect(emitter.getEventHistory()).toHaveLength(1);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.connectedPorts.size).toBe(1);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.workers.size).toBe(1);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.channel).toBeDefined(); // Should have a mock BroadcastChannel

      emitter.clear();

      expect(emitter.hasListeners("testEvent")).toBe(false);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.messageHandlers.size).toBe(0);
      expect(emitter.getEventHistory()).toHaveLength(0);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.channel).toBeUndefined(); // BroadcastChannel closed and undefined
      expect(mockGlobalBroadcastChannel.close).toHaveBeenCalledTimes(1); // Assuming default global BC was used
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockPort.close).toHaveBeenCalledTimes(1);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.connectedPorts.size).toBe(0);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(emitter.workers.size).toBe(0);

      // Check if removed from registry
      const registry = ThreadedOrderedEventEmitter.getRegistry();
      expect(registry.has(emitter.getChannelName())).toBe(false);
    });
  });

  describe("Helper Functions", () => {
    it("createTypedEmitter should return a configured instance", () => {
      const serializeFn = vi.fn();
      const deserializeFn = vi.fn();
      const errorFn = vi.fn();
      const opts: EmitterOptions = {
        channelName: "typed-emitter-channel",
        onSerializeThreadMessage: serializeFn,
        onDeserializeThreadMessage: deserializeFn,
        onListenerError: errorFn,
      };
      const typedEmitter = createTypedEmitter<TestEvents>(opts);

      expect(typedEmitter).toBeInstanceOf(ThreadedOrderedEventEmitter);
      expect(typedEmitter.getChannelName()).toBe("typed-emitter-channel");
      expect(typedEmitter.onSerializeThreadMessage).toBe(serializeFn);
      expect(typedEmitter.onDeserializeThreadMessage).toBe(deserializeFn);
      expect(typedEmitter.onListenerError).toBe(errorFn);
      typedEmitter.clear();
    });

    it("setupMainThreadHandlers should register a handler and return a cleanup function", () => {
      const taskCompleteHandler = vi.fn();
      // Use getInstance to ensure it works with the registry as intended by the helper
      const testEmitter = ThreadedOrderedEventEmitter.getInstance<TestEvents>({
        channelName: "main-handler-test",
      });

      const cleanup = setupMainThreadHandlers<TestEvents>(
        {
          testEvent: taskCompleteHandler,
        },
        testEmitter,
      );

      const message: ThreadMessage<"testEvent", [string, number]> = {
        type: "event",
        event: "testEvent",
        args: ["task1", 100],
        sourceThreadId: "worker-handler-test",
      };
      // Simulate message arrival by calling the private method on the emitter
      //@ts-expect-error marked as private but still accessible in javascript
      testEmitter.handleThreadMessage(message);
      expect(taskCompleteHandler).toHaveBeenCalledWith(message);

      cleanup();
      taskCompleteHandler.mockClear();
      //@ts-expect-error marked as private but still accessible in javascript
      testEmitter.handleThreadMessage(message);
      expect(taskCompleteHandler).not.toHaveBeenCalled();
      testEmitter.clear();
    });

    it("setupWorkerConnection should connect a worker and return a cleanup function", () => {
      const mockWorker = {
        on: vi.fn(),
        off: vi.fn(),
        postMessage: vi.fn(),
      };
      const testEmitter = ThreadedOrderedEventEmitter.getInstance({
        channelName: "worker-conn-test",
      });

      //@ts-expect-error no need to mock other properties
      const cleanup = setupWorkerConnection(mockWorker, testEmitter);
      //@ts-expect-error marked as private but still accessible in javascript
      expect(testEmitter.workers.has(mockWorker)).toBe(true);
      expect(mockWorker.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      );

      cleanup();
      //@ts-expect-error marked as private but still accessible in javascript
      expect(testEmitter.workers.has(mockWorker)).toBe(false);
      expect(mockWorker.off).toHaveBeenCalled();
      testEmitter.clear();
    });

    it("createConnectedWorker should create a worker, connect it, and return worker and cleanup", async () => {
      const wtMock = await vi.mocked(import("worker_threads"));
      const mockWorkerInstance = {
        on: vi.fn(),
        off: vi.fn(),
        postMessage: vi.fn(),
        terminate: vi.fn(),
      };
      (wtMock.Worker as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockWorkerInstance,
      );
      const testEmitter = ThreadedOrderedEventEmitter.getInstance({
        channelName: "create-conn-test",
      });

      const { worker, cleanup } = createConnectedWorker(
        "./fake-worker.js",
        {},
        testEmitter,
      );

      expect(worker).toBe(mockWorkerInstance);
      expect(wtMock.Worker).toHaveBeenCalledWith("./fake-worker.js", {});
      //@ts-expect-error marked as private but still accessible in javascript

      expect(testEmitter.workers.has(mockWorkerInstance)).toBe(true);

      cleanup();
      //@ts-expect-error marked as private but still accessible in javascript

      expect(testEmitter.workers.has(mockWorkerInstance)).toBe(false);
      testEmitter.clear();
    });
  });
});

/**
 * A listener, a hook or a serialiser that fails must not reach the caller of
 * `emit`, and must not reach the process as an unhandled rejection.
 */
describe("Failure containment", () => {
  interface SafetyRecord {
    asyncEvent: (arg: string) => Promise<void> | void;
    syncEvent: (arg: string) => void;
  }
  type SafetyEvents = ListenerSignature<SafetyRecord>;

  let emitter: ThreadedOrderedEventEmitter<SafetyEvents>;
  const onUnhandledRejection = vi.fn();

  // node raises `unhandledRejection` only once the microtask queue has
  // drained: one macrotask later it has been raised, if it is going to be
  const nextMacrotask = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  const build = (
    options: EmitterOptions = {},
  ): ThreadedOrderedEventEmitter<SafetyEvents> => {
    emitter = new ThreadedOrderedEventEmitter<SafetyEvents>({
      threadId: "safety-test",
      ...options,
    });
    return emitter;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(() => mockGlobalBroadcastChannel),
    );
    ThreadedOrderedEventEmitter.clearRegistry();
    onUnhandledRejection.mockReset();
    process.on("unhandledRejection", onUnhandledRejection);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandledRejection);
    emitter?.clear();
    ThreadedOrderedEventEmitter.clearRegistry();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("a zero-priority async listener that rejects", () => {
    it("raises no unhandled rejection under emitAsync, and reports the error with its context", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const failure = new Error("zero-priority rejected");
      emitter.on(
        "asyncEvent",
        async () => {
          await Promise.resolve();
          throw failure;
        },
        0,
        "pointer-writer",
      );

      await emitter.emitAsync({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "listener",
        event: "asyncEvent",
        key: "pointer-writer",
        priority: 0,
        sync: false,
      });
    });

    it("raises no unhandled rejection under emit", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const failure = new Error("zero-priority rejected (sync emit)");
      // eslint-disable-next-line @typescript-eslint/require-await
      emitter.on("asyncEvent", async () => {
        throw failure;
      });

      emitter.emit({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "listener",
        event: "asyncEvent",
        key: undefined,
        priority: 0,
        sync: true,
      });
    });

    it("is still not awaited: emitAsync resolves before the listener settles", async () => {
      build();
      let settled = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      emitter.on("asyncEvent", async () => {
        await gate;
        settled = true;
      });

      await emitter.emitAsync({ event: "asyncEvent" }, "payload");

      // awaiting zero-priority listeners would change timing for every consumer
      expect(settled).toBe(false);
      release();
      await nextMacrotask();
      expect(settled).toBe(true);
    });

    it("raises no unhandled rejection when no error hook is configured", async () => {
      build();
      // eslint-disable-next-line @typescript-eslint/require-await
      emitter.on("asyncEvent", async () => {
        throw new Error("nobody is listening for errors");
      });

      await emitter.emitAsync({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    });
  });

  describe("a prioritized async listener that rejects under emit", () => {
    it("raises no unhandled rejection, and reports the error with its context", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const failure = new Error("prioritized rejected (sync emit)");
      emitter.on(
        "asyncEvent",
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw failure;
        },
        5,
        "provisioner",
      );

      emitter.emit({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "listener",
        event: "asyncEvent",
        key: "provisioner",
        priority: 5,
        sync: true,
      });
    });

    it("prints nothing while processing prioritized listeners", () => {
      build();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      emitter.on("syncEvent", () => {}, 5, "quiet");

      emitter.emit({ event: "syncEvent" }, "payload");

      expect(log).not.toHaveBeenCalled();
    });
  });

  describe("an awaited prioritized listener that rejects under emitAsync", () => {
    it("reports the error with its context and never the payload", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const failure = new Error("awaited listener rejected");
      emitter.on(
        "asyncEvent",
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw failure;
        },
        10,
        "engine",
      );

      await emitter.emitAsync({ event: "asyncEvent" }, "secret-payload");

      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "listener",
        event: "asyncEvent",
        key: "engine",
        priority: 10,
        sync: false,
      });
      expect(JSON.stringify(onListenerError.mock.calls)).not.toContain(
        "secret-payload",
      );
    });
  });

  describe("an error hook that throws", () => {
    const throwingHook = (): never => {
      throw new Error("the hook itself failed");
    };

    it("does not make emitAsync reject, and later listeners still run", async () => {
      build({ onListenerError: throwingHook });
      const later = vi.fn();
      emitter.on(
        "asyncEvent",
        () => {
          throw new Error("listener failed");
        },
        10,
      );
      emitter.on("asyncEvent", later, 5);

      await expect(
        emitter.emitAsync({ event: "asyncEvent" }, "payload"),
      ).resolves.toBe(true);
      expect(later).toHaveBeenCalledTimes(1);
    });

    it("does not make emit throw, for a zero-priority or a prioritized listener", () => {
      build({ onListenerError: throwingHook });
      const later = vi.fn();
      emitter.on("syncEvent", () => {
        throw new Error("zero-priority listener failed");
      });
      emitter.on(
        "syncEvent",
        () => {
          throw new Error("prioritized listener failed");
        },
        10,
      );
      emitter.on("syncEvent", later, 5);

      expect(() =>
        emitter.emit({ event: "syncEvent" }, "payload"),
      ).not.toThrow();
      expect(later).toHaveBeenCalledTimes(1);
    });

    it("raises no unhandled rejection when it throws for a detached listener", async () => {
      build({ onListenerError: throwingHook });
      // eslint-disable-next-line @typescript-eslint/require-await
      emitter.on("asyncEvent", async () => {
        throw new Error("detached listener failed");
      });

      await emitter.emitAsync({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    });
  });

  describe("a serialiser that throws", () => {
    const failure = new Error("cannot serialise");
    const throwingSerialiser = (): never => {
      throw failure;
    };

    it("does not make emit throw: the listeners run and nothing is broadcast", () => {
      const onListenerError = vi.fn();
      build({ onSerializeThreadMessage: throwingSerialiser, onListenerError });
      const listener = vi.fn();
      emitter.on("syncEvent", listener);

      expect(() =>
        emitter.emit({ event: "syncEvent" }, "payload"),
      ).not.toThrow();

      expect(listener).toHaveBeenCalledWith("payload");
      expect(mockGlobalBroadcastChannel.postMessage).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "serializer",
        event: "syncEvent",
        sync: true,
      });
    });

    it("does not make emitAsync reject", async () => {
      build({ onSerializeThreadMessage: throwingSerialiser });
      const listener = vi.fn();
      emitter.on("asyncEvent", listener, 5);

      await expect(
        emitter.emitAsync({ event: "asyncEvent" }, "payload"),
      ).resolves.toBe(true);
      expect(listener).toHaveBeenCalledWith("payload");
    });
  });
});

describe("Event history is opt-in", () => {
  interface HistoryRecord {
    anEvent: (data: { secret: string }) => void;
  }
  type HistoryEvents = ListenerSignature<HistoryRecord>;
  let emitter: ThreadedOrderedEventEmitter<HistoryEvents>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(() => mockGlobalBroadcastChannel),
    );
    ThreadedOrderedEventEmitter.clearRegistry();
  });

  afterEach(() => {
    emitter?.clear();
    ThreadedOrderedEventEmitter.clearRegistry();
    vi.unstubAllGlobals();
  });

  it("keeps no payload by default", () => {
    emitter = new ThreadedOrderedEventEmitter<HistoryEvents>();
    const listener = vi.fn();
    emitter.on("anEvent", listener);

    emitter.emit({ event: "anEvent" }, { secret: "s3cret" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(emitter.getEventHistory()).toEqual([]);
    // not even with an explicit limit: nothing was recorded
    expect(emitter.getEventHistory(10)).toEqual([]);
  });

  it("records when maxHistoryLength is given as an option", () => {
    emitter = new ThreadedOrderedEventEmitter<HistoryEvents>({
      maxHistoryLength: 2,
    });

    emitter.emit({ event: "anEvent" }, { secret: "one" });
    emitter.emit({ event: "anEvent" }, { secret: "two" });
    emitter.emit({ event: "anEvent" }, { secret: "three" });

    expect(
      emitter.getEventHistory().map((entry): unknown => entry.args[0]),
    ).toEqual([{ secret: "two" }, { secret: "three" }]);
  });

  it("setMaxHistoryLength(0) drops what was already recorded", () => {
    emitter = new ThreadedOrderedEventEmitter<HistoryEvents>({
      maxHistoryLength: 5,
    });
    emitter.emit({ event: "anEvent" }, { secret: "recorded" });
    expect(emitter.getEventHistory()).toHaveLength(1);

    emitter.setMaxHistoryLength(0);

    expect(emitter.getEventHistory()).toEqual([]);
    expect(emitter.getEventHistory(10)).toEqual([]);
    emitter.emit({ event: "anEvent" }, { secret: "after" });
    expect(emitter.getEventHistory(10)).toEqual([]);
  });
});

describe("Broadcasting can be switched off", () => {
  interface LocalRecord {
    anEvent: (data: string) => void;
  }
  type LocalEvents = ListenerSignature<LocalRecord>;
  let emitter: ThreadedOrderedEventEmitter<LocalEvents>;
  let BroadcastChannelMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    BroadcastChannelMock = vi.fn(() => mockGlobalBroadcastChannel);
    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);
    ThreadedOrderedEventEmitter.clearRegistry();
  });

  afterEach(() => {
    emitter?.clear();
    ThreadedOrderedEventEmitter.clearRegistry();
    vi.unstubAllGlobals();
  });

  it("opens no channel, serialises nothing and posts nothing with broadcast: false", async () => {
    const onSerializeThreadMessage = vi.fn((message: unknown) => message);
    emitter = new ThreadedOrderedEventEmitter<LocalEvents>({
      broadcast: false,
      onSerializeThreadMessage,
    });
    const listener = vi.fn();
    emitter.on("anEvent", listener, 1);

    emitter.emit({ event: "anEvent" }, "sync");
    await emitter.emitAsync({ event: "anEvent" }, "async");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(BroadcastChannelMock).not.toHaveBeenCalled();
    expect(onSerializeThreadMessage).not.toHaveBeenCalled();
    expect(mockGlobalBroadcastChannel.postMessage).not.toHaveBeenCalled();
  });

  it("still broadcasts by default", () => {
    emitter = new ThreadedOrderedEventEmitter<LocalEvents>();

    emitter.emit({ event: "anEvent" }, "payload");

    expect(BroadcastChannelMock).toHaveBeenCalledTimes(1);
    expect(mockGlobalBroadcastChannel.postMessage).toHaveBeenCalledTimes(1);
  });
});

/**
 * Review of the containment change: the paths the first tests did not reach.
 */
describe("Failure containment: hooks, thenables and incoming messages", () => {
  interface ReviewRecord {
    asyncEvent: (arg: string) => Promise<void> | void;
    syncEvent: (arg: string) => void;
  }
  type ReviewEvents = ListenerSignature<ReviewRecord>;

  let emitter: ThreadedOrderedEventEmitter<ReviewEvents>;
  const onUnhandledRejection = vi.fn();
  const nextMacrotask = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  const build = (
    options: EmitterOptions = {},
  ): ThreadedOrderedEventEmitter<ReviewEvents> => {
    emitter = new ThreadedOrderedEventEmitter<ReviewEvents>({
      threadId: "review-test",
      ...options,
    });
    return emitter;
  };

  // an event arriving from another thread
  const incoming = (
    event: keyof ReviewEvents,
    isAsync: boolean,
  ): ThreadMessage<keyof ReviewEvents, unknown[]> => ({
    type: "event",
    event,
    args: ["from-another-thread"],
    isAsync,
    sourceThreadId: "another-thread",
  });
  const receive = (
    message: ThreadMessage<keyof ReviewEvents, unknown[]>,
  ): void => {
    //@ts-expect-error marked as private but still accessible in javascript
    emitter.handleThreadMessage(message);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(() => mockGlobalBroadcastChannel),
    );
    // earlier tests leave the thread mock as a worker: state it
    const wt = await vi.mocked(import("worker_threads"));
    wt.isMainThread = true;
    wt.parentPort = null;
    ThreadedOrderedEventEmitter.clearRegistry();
    onUnhandledRejection.mockReset();
    process.on("unhandledRejection", onUnhandledRejection);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandledRejection);
    emitter?.clear();
    ThreadedOrderedEventEmitter.clearRegistry();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("an async error hook that rejects", () => {
    // an error hook that awaits a reporter is an ordinary thing to write.
    // a plain function with a counter: a shared vi.fn would lose its
    // implementation to restoreAllMocks between tests and reject nothing.
    let hookCalls = 0;
    // eslint-disable-next-line @typescript-eslint/require-await
    const rejectingHook = async (): Promise<void> => {
      hookCalls += 1;
      throw new Error("the async hook failed");
    };
    beforeEach(() => {
      hookCalls = 0;
    });

    it("raises no unhandled rejection under emitAsync", async () => {
      build({ onListenerError: rejectingHook });
      // eslint-disable-next-line @typescript-eslint/require-await
      emitter.on("asyncEvent", async () => {
        throw new Error("detached listener failed");
      });
      emitter.on(
        "asyncEvent",
        () => {
          throw new Error("awaited listener failed");
        },
        5,
      );

      await expect(
        emitter.emitAsync({ event: "asyncEvent" }, "payload"),
      ).resolves.toBe(true);
      await nextMacrotask();

      expect(hookCalls).toBe(2);
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    });

    it("raises no unhandled rejection under emit", async () => {
      build({ onListenerError: rejectingHook });
      emitter.on("syncEvent", () => {
        throw new Error("listener failed");
      });

      expect(() =>
        emitter.emit({ event: "syncEvent" }, "payload"),
      ).not.toThrow();
      await nextMacrotask();

      expect(hookCalls).toBe(1);
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    });
  });

  describe("what a listener the emit does not wait for returns", () => {
    it("is not started when it is a lazy thenable and not a promise", async () => {
      // a query builder runs only when something calls its `then`. the emit
      // never did, and still does not: only a real promise can become an
      // unhandled rejection, so only a real promise is watched.
      const onListenerError = vi.fn();
      build({ onListenerError });
      const then = vi.fn();
      emitter.on("asyncEvent", () => ({ then }) as never);
      emitter.on("asyncEvent", () => ({ then }) as never, 5);

      emitter.emit({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(then).not.toHaveBeenCalled();
      expect(onListenerError).not.toHaveBeenCalled();
    });

    it("is reported when it is a promise that rejects with something that is not an Error", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      emitter.on("asyncEvent", () => Promise.reject("not-an-error"));

      emitter.emit({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError).toHaveBeenCalledWith(
        "not-an-error",
        expect.objectContaining({
          source: "listener",
          priority: 0,
          sync: true,
        }),
      );
    });

    it("is reported once, with the error itself, for a one-time listener", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const failure = new Error("once listener rejected");
      // eslint-disable-next-line @typescript-eslint/require-await
      emitter.once("asyncEvent", async () => {
        throw failure;
      });

      await emitter.emitAsync({ event: "asyncEvent" }, "payload");
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError.mock.calls[0]![0]).toBe(failure);
    });
  });

  describe("an event that arrives from another thread", () => {
    it("contains a rejecting listener on the async path", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const failure = new Error("listener rejected on an incoming event");
      // eslint-disable-next-line @typescript-eslint/require-await
      emitter.on("asyncEvent", async () => {
        throw failure;
      });

      receive(incoming("asyncEvent", true));
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError.mock.calls[0]![0]).toBe(failure);
      expect(onListenerError.mock.calls[0]![1]).toEqual({
        source: "listener",
        event: "asyncEvent",
        key: undefined,
        priority: 0,
        sync: false,
      });
    });

    it("drops the message, and reports it, when the deserialiser throws", () => {
      const onListenerError = vi.fn();
      const failure = new Error("cannot deserialise");
      build({
        onListenerError,
        onDeserializeThreadMessage: () => {
          throw failure;
        },
      });
      const listener = vi.fn();
      emitter.on("syncEvent", listener);

      // the caller here is a channel's message callback: a throw would be an
      // uncaught exception
      expect(() => receive(incoming("syncEvent", false))).not.toThrow();

      expect(listener).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "deserializer",
        event: "syncEvent",
      });
    });

    it("reports a thread message handler that throws, and one that rejects", async () => {
      const onListenerError = vi.fn();
      build({ onListenerError });
      const thrown = new Error("handler threw");
      const rejected = new Error("handler rejected");
      emitter.registerThreadMessageHandler(() => {
        throw thrown;
      });
      emitter.registerThreadMessageHandler(
        // eslint-disable-next-line @typescript-eslint/require-await
        (async () => {
          throw rejected;
        }) as never,
      );
      const listener = vi.fn();
      emitter.on("syncEvent", listener);

      receive(incoming("syncEvent", false));
      await nextMacrotask();

      expect(onUnhandledRejection).not.toHaveBeenCalled();
      // a failing handler does not stop the event
      expect(listener).toHaveBeenCalledTimes(1);
      expect(
        onListenerError.mock.calls.map(([error]) => error as unknown),
      ).toEqual([thrown, rejected]);
      expect(onListenerError.mock.calls[0]![1]).toEqual({
        source: "messageHandler",
        event: "syncEvent",
      });
    });
  });

  describe("a serialiser that throws under emitAsync", () => {
    it("reports it as asynchronous, posts nothing, and survives a hook that throws too", async () => {
      const failure = new Error("cannot serialise");
      const onListenerError = vi.fn(() => {
        throw new Error("the hook failed as well");
      });
      build({
        onListenerError,
        onSerializeThreadMessage: () => {
          throw failure;
        },
      });
      const listener = vi.fn();
      emitter.on("asyncEvent", listener, 5);

      await expect(
        emitter.emitAsync({ event: "asyncEvent" }, "payload"),
      ).resolves.toBe(true);

      expect(listener).toHaveBeenCalledWith("payload");
      expect(mockGlobalBroadcastChannel.postMessage).not.toHaveBeenCalled();
      expect(onListenerError).toHaveBeenCalledTimes(1);
      expect(onListenerError).toHaveBeenCalledWith(failure, {
        source: "serializer",
        event: "asyncEvent",
        sync: false,
      });
    });
  });

  describe("event history limits", () => {
    it("getEventHistory(0), or a negative limit, returns none of a history that has entries", () => {
      build({ maxHistoryLength: 5 });
      emitter.emit({ event: "syncEvent" }, "kept");

      expect(emitter.getEventHistory()).toHaveLength(1);
      expect(emitter.getEventHistory(0)).toEqual([]);
      expect(emitter.getEventHistory(-1)).toEqual([]);
    });

    it.each([Number.NaN, -3, Number.POSITIVE_INFINITY])(
      "a maxHistoryLength of %s keeps no history",
      (length) => {
        build({ maxHistoryLength: length });
        for (let i = 0; i < 3; i++) {
          emitter.emit({ event: "syncEvent" }, `event ${i}`);
        }
        expect(emitter.getEventHistory(10)).toEqual([]);

        emitter.setMaxHistoryLength(2);
        emitter.emit({ event: "syncEvent" }, "recorded");
        expect(emitter.getEventHistory()).toHaveLength(1);
        emitter.setMaxHistoryLength(length);
        expect(emitter.getEventHistory(10)).toEqual([]);
      },
    );

    it("a fractional length is rounded down", () => {
      build({ maxHistoryLength: 2.9 });
      for (let i = 0; i < 4; i++) {
        emitter.emit({ event: "syncEvent" }, `event ${i}`);
      }
      expect(emitter.getEventHistory(10)).toHaveLength(2);
    });

    it("createTypedEmitter applies maxHistoryLength to an emitter that already exists", () => {
      const first = createTypedEmitter<ReviewEvents>({
        channelName: "history-reuse",
        maxHistoryLength: 5,
      });
      first.emit({ event: "syncEvent" }, "recorded");
      expect(first.getEventHistory()).toHaveLength(1);

      const second = createTypedEmitter<ReviewEvents>({
        channelName: "history-reuse",
        maxHistoryLength: 0,
      });

      expect(second).toBe(first);
      expect(second.getEventHistory(10)).toEqual([]);
      first.clear();
    });
  });

  describe("broadcast: false, in a worker with a connected port", () => {
    it("neither listens to nor posts on the parent port, a connected port or a connected worker, and ignores what arrives", async () => {
      const wt = await vi.mocked(import("worker_threads"));
      wt.isMainThread = false;
      const parentPort = { postMessage: vi.fn(), on: vi.fn() };
      //@ts-expect-error no need to mock other properties
      wt.parentPort = parentPort;
      const port: MessageChannel = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const worker = { postMessage: vi.fn(), on: vi.fn(), off: vi.fn() };

      build({ broadcast: false });
      emitter.connectPort(port);
      //@ts-expect-error no need to mock other properties
      emitter.connectWorker(worker);
      const listener = vi.fn();
      emitter.on("syncEvent", listener);

      emitter.emit({ event: "syncEvent" }, "local");
      await emitter.emitAsync({ event: "syncEvent" }, "local");

      expect(listener).toHaveBeenCalledTimes(2);
      expect(parentPort.on).not.toHaveBeenCalled();
      expect(parentPort.postMessage).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(worker.postMessage).not.toHaveBeenCalled();

      // and an event sent to it from elsewhere is not delivered
      receive(incoming("syncEvent", false));
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});
