import * as matchers from "jest-extended";
import { describe, expect, it, vi } from "vitest";

import { OrderedEventEmitter } from "./index.mjs";

expect.extend(matchers);

describe("OrderedEventEmitter", () => {
  it("should initialize with an empty listeners map", () => {
    const emitter = new OrderedEventEmitter();
    expect(emitter.listenersMap.size).toBe(0);
  });

  it("should add listeners correctly with specified priority", () => {
    const emitter = new OrderedEventEmitter();
    const listener = vi.fn();
    emitter.on("testEvent", listener, 1);
    expect(emitter.listenersMap.get("testEvent")).toEqual([
      { listener, priority: 1 },
    ]);
  });

  it("should call listeners in the correct order based on priority", () => {
    const emitter = new OrderedEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("testEvent", listener1, 1);
    emitter.on("testEvent", listener2, 2);
    emitter.emit({ event: "testEvent" });
    expect(listener2).toHaveBeenCalledBefore(listener1);
  });

  it("should call listeners with priority 0 synchronously in the order they were added", () => {
    const emitter = new OrderedEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("testEvent", listener1, 0);
    emitter.on("testEvent", listener2, 0);
    emitter.emit({ event: "testEvent" });
    expect(listener1).toHaveBeenCalledBefore(listener2);
  });

  it("should call listeners with custom arrangement functions in the correct order", () => {
    const emitter = new OrderedEventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("testEvent", listener1, 1);
    emitter.on("testEvent", listener2, 2);
    emitter.emit({
      event: "testEvent",
      //IMPORTANT: listeners are cloned.
      arrangeListeners: (listeners) => {
        return listeners.reverse();
      },
    });

    expect(listener2).toHaveBeenCalledBefore(listener1);
  });

  it("should call async listeners sequentially in the order of their priority", async () => {
    const emitter = new OrderedEventEmitter();
    const listener1 = vi.fn().mockResolvedValue(true);
    const listener2 = vi.fn().mockResolvedValue(true);
    emitter.on("testEvent", listener1, 1);
    emitter.on("testEvent", listener2, 2);
    await emitter.emitAsync({ event: "testEvent" });
    expect(listener2).toHaveBeenCalledBefore(listener1);
  });

  it("should call async listeners with custom arrangement functions in the correct order", async () => {
    const emitter = new OrderedEventEmitter();
    const listener1 = vi.fn().mockResolvedValue(true);
    const listener2 = vi.fn().mockResolvedValue(true);
    emitter.on("testEvent", listener1, 1);
    emitter.on("testEvent", listener2, 2);
    await emitter.emitAsync({
      event: "testEvent",
      arrangeListeners: (listeners) => listeners.reverse(),
    });
    expect(listener2).toHaveBeenCalledBefore(listener1);
  });
});
