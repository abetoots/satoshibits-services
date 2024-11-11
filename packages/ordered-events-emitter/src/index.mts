/* eslint-disable @typescript-eslint/no-explicit-any */
import cloneDeep from "lodash.clonedeep";

export type ListenerSignature<L> = {
  [E in keyof L]: (...args: any[]) => any;
};

export type DefaultListener = Record<string, (...args: any[]) => any>;

/**
 * A class that emits events and calls listeners sequentially in the order of their priority.
 * IMPORTANT: If listeners have a priority of 0, they will be called synchronously in the order they were added,
 * just like the default EventEmitter.
 *
 * Alternatively, you can provide a custom function to arrange the listeners in a custom way i.e.
 * using keys instead of priority.
 *
 * Sample usage:
 * ```ts
 *
 * interface MyClassEvents {
 *  add: (el: string, wasNew: boolean) => void;
 *  delete: (changedCount: number) => void;
 * }
 * const manager = new OrderedEventEmitter<MyClassEvents>();
 *
 * //add a listener with priority 1
 * manager.on("add", (el, wasNew) => {
 *  console.log("added", el, wasNew);
 * }, 1);
 *
 * manager.emit({ event: "add" }, "hello", true);
 *
 * // Prints
 * // added hello true
 * ```
 */
export class OrderedEventEmitter<
  L extends ListenerSignature<L> = DefaultListener,
> {
  listenersMap: Map<
    keyof L,
    { listener: L[keyof L]; priority: number; key?: string }[]
  >;
  constructor() {
    this.listenersMap = new Map();
  }

  /**
   * Alias for `emitter.on({event: "eventName", priority: 1}, listener)`
   */
  addListener<U extends keyof L>(
    event: U,
    listener: L[U],
    priority: number,
    key?: string,
  ): this {
    const listeners = this.listenersMap.get(event) ?? [];
    listeners.push({ listener, priority, key });
    this.listenersMap.set(event, listeners);
    return this;
  }

  /**
   * Adds a listener to the listeners map.
   *
   * @param event The name of the event
   * @param listener The callback function
   * @param priority The priority of the listener. By default, higher priority listeners are called first unless:
   * a) the priority is 0, in which case all listeners with priority 0 are called synchronously in the order
   * they were added like the default EventEmitter. These listeners are called before any other listeners with a priority > 0.
   * b) a custom behavior is provided by the emitter `emit` method for this event.
   *
   * @param key An optional key to identify the listener.
   * @returns The emitter instance
   */
  on<U extends keyof L>(
    event: U,
    listener: L[U],
    priority: number,
    key?: string,
  ): this {
    return this.addListener(event, listener, priority, key);
  }

  /**
   * Sequentially calls the listeners registered for the event named eventName, in the order they were registered, passing the supplied arguments to each.
   * Returns true if the event had listeners, false otherwise.
   *
   * Behavior:
   * 1. Listeners with priority 0 are called synchronously in the order they were added. This is the same behavior as the default EventEmitter.
   * 2. Listeners with priority > 0 are called synchronously in the order of their priority, without waiting for async listeners to finish.
   *
   */
  emit<U extends keyof L>(
    {
      event,
      priorityBehavior = "highestFirst",
      arrangeListeners,
    }: {
      /** The event name */
      event: U;
      /** The priority of the listeners */
      priorityBehavior?: "highestFirst" | "lowestFirst";
      /** An optional function to arrange the listeners in a custom way */
      arrangeListeners?: (
        listeners: { listener: L[keyof L]; priority: number; key?: string }[],
      ) => { listener: L[keyof L]; priority: number; key?: string }[];
    },
    ...args: Parameters<L[U]>
  ): boolean {
    let listeners = this.listenersMap.get(event) ?? [];
    //take care of listeners with priority 0
    const zeroPriorityListeners = listeners.filter(
      (listener) => listener.priority === 0,
    );

    if (zeroPriorityListeners.length) {
      for (const { listener } of zeroPriorityListeners) {
        void listener(...args);
      }
    }

    const nonZeroPriorityListeners = listeners.filter(
      (listener) => listener.priority !== 0,
    );

    listeners = nonZeroPriorityListeners;

    if (arrangeListeners && typeof arrangeListeners === "function") {
      const clone = cloneDeep(listeners);
      listeners = arrangeListeners(clone);
    } else if (priorityBehavior === "highestFirst") {
      listeners.sort((a, b) => b.priority - a.priority);
    } else {
      listeners.sort((a, b) => a.priority - b.priority);
    }
    for (const { listener } of listeners) {
      void listener(...args);
    }
    return true;
  }

  /**
   * Async version of `emit`.
   *
   * Differs with behavior #2 above in that listeners with priority > 0 are called sequentially in the order of their priority, waiting for async listeners to finish.
   *
   */
  async emitAsync<U extends keyof L>(
    {
      event,
      priorityBehavior = "highestFirst",
      arrangeListeners,
    }: {
      /** The event name */
      event: U;
      /** The priority of the listeners */
      priorityBehavior?: "highestFirst" | "lowestFirst";
      /** An optional function to arrange the listeners in a custom way */
      arrangeListeners?: (
        listeners: { listener: L[keyof L]; priority: number; key?: string }[],
      ) => { listener: L[keyof L]; priority: number; key?: string }[];
    },
    ...args: Parameters<L[U]>
  ): Promise<boolean> {
    let listeners = this.listenersMap.get(event) ?? [];
    //take care of listeners with priority 0
    const zeroPriorityListeners = listeners.filter(
      (listener) => listener.priority === 0,
    );

    if (zeroPriorityListeners.length) {
      for (const { listener } of zeroPriorityListeners) {
        void listener(...args);
      }
    }

    const nonZeroPriorityListeners = listeners.filter(
      (listener) => listener.priority !== 0,
    );

    listeners = nonZeroPriorityListeners;

    if (arrangeListeners && typeof arrangeListeners === "function") {
      const clone = cloneDeep(listeners);
      listeners = arrangeListeners(clone);
    } else if (priorityBehavior === "highestFirst") {
      listeners.sort((a, b) => b.priority - a.priority);
    } else {
      listeners.sort((a, b) => a.priority - b.priority);
    }
    for (const { listener } of listeners) {
      await listener(...args);
    }
    return true;
  }
}

export default OrderedEventEmitter;
