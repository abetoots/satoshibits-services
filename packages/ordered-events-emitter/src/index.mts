/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BroadcastChannel,
  isMainThread,
  parentPort,
  Worker,
  WorkerOptions,
} from "worker_threads";

/**
 * Type definition for BroadcastChannel (not included in Node.js types by default)
 * Used for cross-thread communication in browsers and newer Node.js versions
 */
// interface BroadcastChannel {
//   name: string;
//   postMessage(message: any): void;
//   onmessage: ((event: any) => void) | null;
//   close(): void;
// }

/**
 * Type definitions for event listener signatures
 * This allows for typed event listeners with custom event names and arguments
 */
export type ListenerSignature<L> = {
  [E in keyof L]: (...args: any[]) => any;
};

export type DefaultListener = Record<string, (...args: any[]) => any>;

/**
 * Interface for message structure used in cross-thread communication
 *
 * @remarks
 * All event arguments must be structured-cloneable values when using
 * cross-thread communication. This means they can be serialized and
 * transferred between threads. Examples include:
 * - Primitive values (strings, numbers, booleans, null, undefined)
 * - Arrays and plain objects
 * - Certain built-in objects (Date, RegExp, etc.)
 *
 * Non-cloneable values like functions, class instances with methods,
 * DOM nodes, etc. will cause errors when passed across threads.
 */
export interface ThreadMessage<U extends keyof any, A extends any[]> {
  type: "event";
  event: U;
  args: A;
  priority?: number;
  priorityBehavior?: "highestFirst" | "lowestFirst";
  isAsync?: boolean;
  sourceThreadId?: number | string;
  messageId?: string; // Unique ID for loop prevention
}

/**
 * Interface for communication channel
 */
export interface MessageChannel {
  postMessage(message: any): void;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (message: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
  off?(type: string, listener: (message: any) => void): void;
  close?(): void;
}

/**
 * Configuration options for ThreadedOrderedEventEmitter
 */
export interface EmitterOptions {
  /**
   * Channel name for BroadcastChannel (if used)
   * @default 'threaded-ordered-events'
   */
  channelName?: string;

  /**
   * Default priority behavior
   * @default 'highestFirst'
   */
  defaultPriorityBehavior?: "highestFirst" | "lowestFirst";

  /**
   * Unique identifier for this thread
   * @default auto-generated
   */
  threadId?: string | number;

  /**
   * Debugging mode
   * @default false
   */
  debug?: boolean;

  /**
   * Serialization function for thread messages
   * @returns Serialized message
   */
  onSerializeThreadMessage?: (message: unknown) => any;
  /**
   * Deserialization function for thread messages
   * @returns
   */
  onDeserializeThreadMessage?: (message: unknown) => any;

  /**
   * Callback for handling errors in listeners
   * @param error The error that occurred
   */
  onListenerError?: (error: unknown) => void;
}

/**
 * Information about a registered listener
 */
export interface ListenerInfo<T> {
  listener: T;
  priority: number;
  key?: string;
  once?: boolean;
}

export interface EmitFunctionOptions<TEvent, TListener> {
  event: TEvent;
  priorityBehavior?: "highestFirst" | "lowestFirst";
  /** For customizing priority. priorityBehavior is ignored when this is provided,
   * meaning you won't get a pre-arranged list of listeners but in the order
   * they were added.
   */
  arrangeListeners?: (
    listeners: ListenerInfo<TListener>[],
  ) => ListenerInfo<TListener>[];
  localOnly?: boolean;
}

// Registry to store emitter instances by channelName
const emitterRegistry = new Map<string, ThreadedOrderedEventEmitter<any>>();

/**
 * ThreadedOrderedEventEmitter - An event emitter that works across threads
 * and supports priority-based event handling.
 *
 * Features:
 * - Works seamlessly across worker threads using BroadcastChannel (preferred) or parentPort
 * - Supports priority-based event listeners
 * - Handles both synchronous and asynchronous event processing
 * - Maintains a registry of instances by channel name
 * - Provides type-safe event definitions
 */
export class ThreadedOrderedEventEmitter<
  L extends ListenerSignature<L> = DefaultListener,
> {
  private listenersMap: Map<keyof L, ListenerInfo<L[keyof L]>[]>;
  private channel?: BroadcastChannel;
  private defaultPriorityBehavior: "highestFirst" | "lowestFirst";
  private messageHandlers: Set<(message: ThreadMessage<any, any[]>) => void>;
  private connectedPorts: Set<MessageChannel>;
  private workers: Set<Worker>;
  private threadId: string | number;
  private debug: boolean;
  private maxHistoryLength: number;
  private eventHistory: {
    event: keyof L;
    args: any[];
    timestamp: number;
    threadId: string | number;
  }[];
  private channelName: string;

  public onSerializeThreadMessage?: EmitterOptions["onSerializeThreadMessage"];
  public onDeserializeThreadMessage?: EmitterOptions["onDeserializeThreadMessage"];
  public onListenerError?: EmitterOptions["onListenerError"];

  constructor(options?: EmitterOptions) {
    this.listenersMap = new Map();
    this.messageHandlers = new Set();
    this.connectedPorts = new Set();
    this.workers = new Set();
    this.defaultPriorityBehavior =
      options?.defaultPriorityBehavior ?? "highestFirst";
    this.threadId =
      options?.threadId ??
      `thread-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.debug = options?.debug ?? false;
    this.maxHistoryLength = 100;
    this.eventHistory = [];
    this.onSerializeThreadMessage = options?.onSerializeThreadMessage;
    this.onDeserializeThreadMessage = options?.onDeserializeThreadMessage;
    this.onListenerError = options?.onListenerError;

    // Setup cross-thread communication
    this.channelName = options?.channelName ?? "threaded-ordered-events";

    // Register this instance in the registry
    emitterRegistry.set(this.channelName, this);

    // Try to use BroadcastChannel (preferred method)
    if (typeof globalThis.BroadcastChannel !== "undefined") {
      try {
        this.channel = new globalThis.BroadcastChannel(this.channelName);

        // Handle both browser and Node.js style message events
        this.channel.onmessage = (eventOrData: any) => {
          // Determine if the argument is an event object (browser) or the data itself (Node.js)
          const data: unknown =
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            eventOrData && eventOrData.data !== undefined
              ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                eventOrData.data
              : eventOrData;

          this.handleThreadMessage(data as ThreadMessage<keyof L, any[]>);
        };

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] BroadcastChannel '${this.channelName}' created for thread ${this.threadId}`,
          );
        }
      } catch (err) {
        console.error(
          "[ThreadedOrderedEventEmitter] Failed to create BroadcastChannel",
        );
        if (this.debug) {
          console.warn(
            "[ThreadedOrderedEventEmitter] BroadcastChannel not supported, falling back to parentPort",
            err,
          );
        }
      }
    }

    // Fallback: worker → main communication via parentPort
    if (!isMainThread && parentPort) {
      parentPort.on("message", (msg: ThreadMessage<keyof L, any[]>) => {
        this.handleThreadMessage(msg);
      });

      if (this.debug) {
        console.debug(
          `[ThreadedOrderedEventEmitter] Worker thread setup complete for thread ${this.threadId}`,
        );
      }
    }
  }

  /**
   * Get an existing instance of ThreadedOrderedEventEmitter or create a new one.
   * This implements the Singleton pattern, ensuring that only one emitter
   * exists per channel name across your application.
   *
   * @param options Configuration options
   * @returns ThreadedOrderedEventEmitter instance
   *
   * @example
   * ```ts
   * // Get or create a shared emitter with a specific channel
   * const sharedEmitter = ThreadedOrderedEventEmitter.getInstance({
   *   channelName: "app-events",
   *   debug: true
   * });
   *
   * // Later in other modules, get the same instance:
   * const sameEmitter = ThreadedOrderedEventEmitter.getInstance({
   *   channelName: "app-events"
   * });
   *
   * // sharedEmitter === sameEmitter (true)
   * ```
   */
  public static getInstance<T extends ListenerSignature<T>>(
    options?: EmitterOptions,
  ): ThreadedOrderedEventEmitter<T> {
    const channelName = options?.channelName ?? "threaded-ordered-events";

    if (emitterRegistry.has(channelName)) {
      return emitterRegistry.get(channelName) as ThreadedOrderedEventEmitter<T>;
    }

    return new ThreadedOrderedEventEmitter<T>(options);
  }

  /**
   * Get the thread ID for this instance
   */
  public getThreadId(): string | number {
    return this.threadId;
  }

  /**
   * Get the channel name for this instance
   */
  public getChannelName(): string {
    return this.channelName;
  }

  /**
   * Set debug mode for the emitter.
   * When debug mode is enabled, the emitter will log detailed information about
   * its operations to the console, which is useful for troubleshooting.
   *
   * @param debug Whether to enable debug logging
   *
   * @example
   * ```ts
   * // Enable debug mode to see detailed logs
   * emitter.setDebugMode(true);
   *
   * // Turn off debug logging in production
   * if (process.env.NODE_ENV === 'production') {
   *   emitter.setDebugMode(false);
   * }
   * ```
   */
  public setDebugMode(debug: boolean): void {
    this.debug = debug;
  }

  /**
   * Handle thread messages and re-emit locally with proper ordering
   */
  private handleThreadMessage(message: ThreadMessage<keyof L, any[]>): void {
    if (message.type !== "event") return;

    // Skip messages from self (prevent infinite loops)
    if (message.sourceThreadId === this.threadId) {
      return;
    }

    if (this.debug) {
      console.debug(
        `[ThreadedOrderedEventEmitter] Received message for event '${String(message.event)}' from thread ${message.sourceThreadId ?? "unknown"}`,
      );
    }

    // Notify any registered message handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (err) {
        if (this.debug) {
          console.error(
            "[ThreadedOrderedEventEmitter] Error in message handler:",
            err,
          );
        }
      }
    }

    // Deserialize the message if a deserialization function is provided
    if (this.onDeserializeThreadMessage) {
      message.args = this.onDeserializeThreadMessage(
        message.args,
      ) as typeof message.args;
    }

    // Process the event locally, but with localOnly=true to prevent rebroadcasting
    if (message.isAsync) {
      void this.emitAsync(
        {
          event: message.event,
          priorityBehavior:
            message.priorityBehavior ?? this.defaultPriorityBehavior,
          localOnly: true, // Don't rebroadcast
        },
        ...(message.args as Parameters<L[keyof L]>),
      );
    } else {
      this.emit(
        {
          event: message.event,
          priorityBehavior:
            message.priorityBehavior ?? this.defaultPriorityBehavior,
          localOnly: true, // Don't rebroadcast
        },
        ...(message.args as Parameters<L[keyof L]>),
      );
    }
  }

  /**
   * Register a handler for thread messages.
   * This allows declarative handling of messages from worker threads.
   *
   * @param handler Function to handle incoming thread messages
   * @returns Function to remove the handler when no longer needed
   *
   * @example
   * ```ts
   * // Register a custom handler for thread messages
   * const cleanup = emitter.registerThreadMessageHandler((message) => {
   *   console.log("Thread message received:", message.event);
   *   // Process message
   *   if (message.sourceThreadId === "worker-1") {
   *     // Handle messages from worker-1
   *   }
   * });
   *
   * // Later when done
   * cleanup();
   * ```
   *
   * @example
   * ```tsx
   * // In a React component
   * function TaskMonitor() {
   *   const [tasks, setTasks] = useState([]);
   *
   *   useEffect(() => {
   *     const emitter = ThreadedOrderedEventEmitter.getInstance();
   *
   *     // Use the handler naming convention with "handle" prefix
   *     const handleThreadMessage = (message) => {
   *       if (message.event === "taskAdded") {
   *         setTasks(prev => [...prev, message.args[0]]);
   *       }
   *     };
   *
   *     const cleanup = emitter.registerThreadMessageHandler(handleThreadMessage);
   *
   *     // Clean up when component unmounts
   *     return cleanup;
   *   }, []);
   *
   *   return (
   *     <div>
   *       <h2>Active Tasks</h2>
   *       <ul>
   *         {tasks.map(task => <li key={task.id}>{task.name}</li>)}
   *       </ul>
   *     </div>
   *   );
   * }
   * ```
   */
  public registerThreadMessageHandler(
    handler: (message: ThreadMessage<keyof L, any[]>) => void,
  ): () => void {
    this.messageHandlers.add(handler);

    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Add a listener with specified priority.
   * Registers an event handler function that will be called when the specified event is emitted.
   * Higher priority listeners are called before lower priority ones (when using 'highestFirst').
   *
   * @param event Event name
   * @param listener Event handler function
   * @param priority Priority value (default: 0, higher number = higher priority)
   * @param key Optional key to identify the listener for later removal
   * @returns The emitter instance for chaining
   *
   * @example
   * ```ts
   * // Basic listener with default priority (0)
   * emitter.on("dataReceived", (data) => {
   *   console.log("Processing data:", data);
   * });
   *
   * // High priority listener (will be called first)
   * emitter.on("dataReceived", (data) => {
   *   console.log("Pre-processing data:", data);
   * }, 10);
   *
   * // Named listener that can be removed by key
   * emitter.on("dataReceived", (data) => {
   *   console.log("Logging data:", data);
   * }, 5, "logger");
   *
   * // Later, remove by key:
   * emitter.offByKey("dataReceived", "logger");
   * ```
   */
  public on<U extends keyof L>(
    event: U,
    listener: L[U],
    priority = 0,
    key?: string,
  ): this {
    const listeners = this.listenersMap.get(event) ?? [];
    listeners.push({ listener, priority, key });
    this.listenersMap.set(event, listeners);

    if (this.debug) {
      console.debug(
        `[ThreadedOrderedEventEmitter] Added listener for event '${String(event)}' with priority ${priority}${key ? ` and key '${key}'` : ""}`,
      );
    }

    return this;
  }

  /**
   * Alias for on() method
   */
  public addListener<U extends keyof L>(
    event: U,
    listener: L[U],
    priority = 0,
    key?: string,
  ): this {
    return this.on(event, listener, priority, key);
  }

  /**
   * Add a listener that will be removed after first execution.
   * Similar to the `on` method, but the listener is automatically removed
   * after it is executed once.
   *
   * @param event Event name
   * @param listener Event handler function
   * @param priority Priority value (default: 0)
   * @param key Optional key for identification
   * @returns The emitter instance for chaining
   *
   * @example
   * ```ts
   * // Add a one-time listener
   * emitter.once("userConnected", (userId) => {
   *   console.log(`Welcome new user: ${userId}`);
   *   // This will only run the first time the event is emitted
   * }, 5);
   *
   * // With a key for potential early removal
   * emitter.once("startup", () => {
   *   console.log("First-time initialization");
   * }, 0, "init");
   *
   * // If needed, remove it before it fires:
   * emitter.offByKey("startup", "init");
   * ```
   */
  public once<U extends keyof L>(
    event: U,
    listener: L[U],
    priority = 0,
    key?: string,
  ): this {
    // Create a wrapper function that removes itself after execution
    const wrappedListener = ((...args: Parameters<L[U]>) => {
      // Remove the listener before execution to prevent recursive issues
      this.off(event, wrappedListener);

      // Call the original listener
      return listener(...args) as L[U];
    }) as L[U];

    // Mark this as a once listener
    const listeners = this.listenersMap.get(event) ?? [];
    listeners.push({ listener: wrappedListener, priority, key, once: true });
    this.listenersMap.set(event, listeners);

    if (this.debug) {
      console.debug(
        `[ThreadedOrderedEventEmitter] Added one-time listener for event '${String(event)}' with priority ${priority}${key ? ` and key '${key}'` : ""}`,
      );
    }

    return this;
  }

  /**
   * Remove a listener
   *
   * @param event Event name
   * @param listener Event handler function
   */
  public off<U extends keyof L>(event: U, listener: L[U]): this {
    const listeners = this.listenersMap.get(event);

    if (listeners) {
      const index = listeners.findIndex((item) => item.listener === listener);
      if (index !== -1) {
        listeners.splice(index, 1);
        this.listenersMap.set(event, listeners);

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] Removed listener for event '${String(event)}'`,
          );
        }
      }
    }

    return this;
  }

  /**
   * Remove a listener by key.
   * This method allows you to remove a listener without having a reference
   * to the original function, instead using the key provided when it was added.
   *
   * @param event Event name
   * @param key Key to identify the listener
   * @returns The emitter instance for chaining
   *
   * @example
   * ```ts
   * // Add a listener with a key
   * emitter.on("userActivity", (data) => {
   *   console.log("User activity:", data);
   * }, 1, "activity-logger");
   *
   * // Later, remove it by key
   * emitter.offByKey("userActivity", "activity-logger");
   * ```
   */
  public offByKey<U extends keyof L>(event: U, key: string): this {
    const listeners = this.listenersMap.get(event);

    if (listeners) {
      const newListeners = listeners.filter((item) => item.key !== key);

      if (newListeners.length !== listeners.length) {
        this.listenersMap.set(event, newListeners);

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] Removed listener(s) for event '${String(event)}' with key '${key}'`,
          );
        }
      }
    }

    return this;
  }

  /**
   * Remove all listeners for a specific event
   *
   * @param event Event name
   */
  public offAll<U extends keyof L>(event: U): this {
    const hadListeners = this.listenersMap.has(event);
    this.listenersMap.delete(event);

    if (hadListeners && this.debug) {
      console.debug(
        `[ThreadedOrderedEventEmitter] Removed all listeners for event '${String(event)}'`,
      );
    }

    return this;
  }

  /**
   * Check if event has listeners
   *
   * @param event Event name
   * @returns True if event has listeners
   */
  public hasListeners<U extends keyof L>(event: U): boolean {
    const listeners = this.listenersMap.get(event);
    return !!listeners && listeners.length > 0;
  }

  /**
   * Get listener count for an event
   *
   * @param event Event name
   * @returns Number of listeners
   */
  public listenerCount<U extends keyof L>(event: U): number {
    const listeners = this.listenersMap.get(event);
    return listeners ? listeners.length : 0;
  }

  /**
   * Get all listeners for an event
   *
   * @param event Event name
   * @returns Array of listeners
   */
  public getListeners<U extends keyof L>(event: U): ListenerInfo<L[U]>[] {
    const listeners = this.listenersMap.get(event) ?? [];
    return [...listeners] as ListenerInfo<L[U]>[];
  }

  /**
   * Get all registered event names
   *
   * @returns Array of event names
   */
  public eventNames(): (keyof L)[] {
    return Array.from(this.listenersMap.keys());
  }

  /**
   * Get recent event history.
   * Retrieves a list of recently emitted events with their arguments,
   * timestamps, and originating thread IDs. This is useful for debugging
   * and understanding the flow of events in a complex system.
   *
   * @param limit Maximum number of events to return (defaults to maxHistoryLength)
   * @returns Array of recent events with metadata
   *
   * @example
   * ```ts
   * // Get the last 10 events
   * const recentEvents = emitter.getEventHistory(10);
   *
   * // Check events for debugging
   * console.log("Recent events:", recentEvents);
   *
   * // Find events of a specific type
   * const loginEvents = recentEvents.filter(e => e.event === 'userLoggedIn');
   * ```
   */
  public getEventHistory(limit: number = this.maxHistoryLength): {
    event: keyof L;
    args: any[];
    timestamp: number;
    threadId: string | number;
  }[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Set the maximum event history length.
   * Controls how many events are stored in the history buffer.
   * Older events are automatically discarded when the limit is reached.
   *
   * @param length Maximum number of events to store in history
   *
   * @example
   * ```ts
   * // Increase history capacity for debugging
   * emitter.setMaxHistoryLength(500);
   *
   * // Or reduce it to conserve memory
   * emitter.setMaxHistoryLength(20);
   * ```
   */
  public setMaxHistoryLength(length: number): void {
    this.maxHistoryLength = length;

    // Trim history if needed
    if (this.eventHistory.length > length) {
      this.eventHistory = this.eventHistory.slice(-length);
    }
  }

  /**
   * Emit an event with priority-based ordering
   *
   * @param options Event options object containing event name and optional behavior settings
   * @param args Event arguments
   * @returns Boolean indicating if any listeners were triggered
   *
   * @remarks
   * When broadcasting across threads, all arguments must be structured-cloneable.
   * This means they must be serializable using the structured clone algorithm.
   * Functions, symbols, DOM nodes, and class instances with methods are not
   * structured-cloneable and will cause errors.
   */
  public emit<U extends keyof L>(
    options: EmitFunctionOptions<U, L[keyof L]>,
    ...args: Parameters<L[U]>
  ): boolean {
    const event = options.event;
    const priorityBehavior =
      options.priorityBehavior ?? this.defaultPriorityBehavior;
    const localOnly = options.localOnly ?? false;

    // Record in history
    this.recordInHistory(event, args);

    // Broadcast across threads (unless localOnly is true)
    if (!localOnly) {
      this.broadcastEvent(event as string, args, {
        priorityBehavior,
        isAsync: false,
      });
    }

    // Get and sort listeners
    const listeners = this.listenersMap.get(event) ?? [];
    if (listeners.length === 0) return false;

    if (this.debug) {
      console.debug(
        `[ThreadedOrderedEventEmitter] Emitting event '${String(event)}' with ${listeners.length} listeners`,
      );
    }

    // Arrange listeners by priority
    const arrangedListeners = this.arrangeListeners(
      listeners,
      priorityBehavior,
      options.arrangeListeners,
    );

    // Process listeners in the correct order (synchronously)
    void this.processListeners(arrangedListeners, args, event, false);

    return true;
  }

  /**
   * Emit an event with a string event name (simplified API)
   *
   * @param event Event name
   * @param args Event arguments
   * @returns Boolean indicating if any listeners were triggered
   *
   * @remarks
   * When broadcasting across threads, all arguments must be structured-cloneable.
   *
   * @example
   * ```ts
   * // Simple event emission without additional options
   * emitter.emitSimple("userLoggedIn", "user123", { timestamp: Date.now() });
   * ```
   *
   * @example
   * ```tsx
   * // In a React component following handler naming convention
   * function UserLoginButton({ userId }) {
   *   const emitter = useRef(ThreadedOrderedEventEmitter.getInstance());
   *
   *   // Event handler method with "handle" prefix
   *   const handleLogin = () => {
   *     // Emit the event when button is clicked
   *     emitter.current.emitSimple("userLoggedIn", userId, { timestamp: Date.now() });
   *   };
   *
   *   return (
   *     <button onClick={handleLogin}>
   *       Log In
   *     </button>
   *   );
   * }
   * ```
   */
  public emitSimple<U extends keyof L>(
    event: U,
    ...args: Parameters<L[U]>
  ): boolean {
    return this.emit({ event }, ...args);
  }

  /**
   * Emit an event locally without broadcasting to other threads
   *
   * @param event Event name
   * @param args Event arguments
   * @returns Boolean indicating if any listeners were triggered
   *
   * @example
   * ```ts
   * // Only notify local listeners without broadcasting to other threads
   * emitter.emitLocal("configUpdated", { theme: "dark" });
   * ```
   *
   * @example
   * ```tsx
   * // In a React component with local theme switching
   * function ThemeSwitcher() {
   *   const [theme, setTheme] = useState('light');
   *   const emitter = useRef(ThreadedOrderedEventEmitter.getInstance());
   *
   *   // Set up listener for theme changes
   *   useEffect(() => {
   *     const handleThemeUpdated = (newTheme) => {
   *       document.documentElement.setAttribute('data-theme', newTheme);
   *     };
   *
   *     emitter.current.on('themeUpdated', handleThemeUpdated);
   *
   *     return () => {
   *       emitter.current.off('themeUpdated', handleThemeUpdated);
   *     };
   *   }, []);
   *
   *   // Handler with "handle" prefix for toggling theme
   *   const handleToggleTheme = () => {
   *     const newTheme = theme === 'light' ? 'dark' : 'light';
   *     setTheme(newTheme);
   *
   *     // Only notify local components without broadcasting to other threads
   *     emitter.current.emitLocal('themeUpdated', newTheme);
   *   };
   *
   *   return (
   *     <button onClick={handleToggleTheme}>
   *       Switch to {theme === 'light' ? 'Dark' : 'Light'} Theme
   *     </button>
   *   );
   * }
   * ```
   */
  public emitLocal<U extends keyof L>(
    event: U,
    ...args: Parameters<L[U]>
  ): boolean {
    return this.emit({ event, localOnly: true }, ...args);
  }

  /**
   * Emit an event asynchronously, waiting for each listener to complete
   *
   * @param options Event options
   * @param args Event arguments
   * @returns Promise resolving to boolean indicating if any listeners were triggered
   *
   * @remarks
   * - Asynchronous emission waits for each prioritized listener to complete before calling the next
   * - Zero-priority listeners are still called synchronously without waiting
   * - When broadcasting across threads, all arguments must be structured-cloneable
   *
   * @example
   * ```tsx
   * // React component example with async data processing
   * function DataProcessor({ dataId }) {
   *   const [status, setStatus] = useState('idle');
   *   const emitter = useRef(ThreadedOrderedEventEmitter.getInstance());
   *
   *   // Following the "handle" prefix naming convention for handlers
   *   const handleProcessData = async () => {
   *     try {
   *       setStatus('processing');
   *
   *       // Emit async event and wait for all listeners to complete
   *       await emitter.current.emitAsync(
   *         { event: "processData" },
   *         dataId,
   *         { startTime: Date.now() }
   *       );
   *
   *       setStatus('completed');
   *     } catch (error) {
   *       setStatus('failed');
   *       console.error('Processing failed:', error);
   *     }
   *   };
   *
   *   return (
   *     <div>
   *       <button
   *         onClick={handleProcessData}
   *         disabled={status === 'processing'}
   *       >
   *         {status === 'processing' ? 'Processing...' : 'Process Data'}
   *       </button>
   *       <div>Status: {status}</div>
   *     </div>
   *   );
   * }
   * ```
   */
  public async emitAsync<U extends keyof L>(
    options: EmitFunctionOptions<U, L[keyof L]>,
    ...args: Parameters<L[U]>
  ): Promise<boolean> {
    const event = options.event;
    const priorityBehavior =
      options.priorityBehavior ?? this.defaultPriorityBehavior;
    const localOnly = options.localOnly ?? false;

    // Record in history
    this.recordInHistory(event, args);

    // Broadcast across threads (unless localOnly is true)
    if (!localOnly) {
      this.broadcastEvent(event as string, args, {
        priorityBehavior,
        isAsync: true,
      });
    }

    // Get and sort listeners
    const listeners = this.listenersMap.get(event) ?? [];
    if (listeners.length === 0) return false;

    if (this.debug) {
      console.debug(
        `[ThreadedOrderedEventEmitter] Emitting async event '${String(event)}' with ${listeners.length} listeners`,
      );
    }

    // Arrange listeners by priority
    const arrangedListeners = this.arrangeListeners(
      listeners,
      priorityBehavior,
      options.arrangeListeners,
    );

    // Process listeners asynchronously in the correct order
    await this.processListeners(arrangedListeners, args, event, true);

    return true;
  }

  /**
   * Emit an event asynchronously with a string event name (simplified API)
   *
   * @param event Event name
   * @param args Event arguments
   * @returns Promise resolving to boolean indicating if any listeners were triggered
   *
   * @remarks
   * When broadcasting across threads, all arguments must be structured-cloneable.
   *
   * @example
   * ```ts
   * // Simple asynchronous event emission
   * await emitter.emitAsyncSimple("processFile", "path/to/file.txt");
   * console.log("All processors completed");
   * ```
   *
   * @example
   * ```tsx
   * // In a React component with async file processing
   * function FileProcessor({ filePath }) {
   *   const [isProcessing, setIsProcessing] = useState(false);
   *   const emitter = useRef(ThreadedOrderedEventEmitter.getInstance());
   *
   *   // Following "handle" prefix convention for event handlers
   *   const handleProcessFile = async () => {
   *     setIsProcessing(true);
   *     try {
   *       // Wait for all file processors to complete
   *       await emitter.current.emitAsyncSimple("processFile", filePath);
   *       toast.success("File processing completed");
   *     } catch (err) {
   *       console.error("Processing failed:", err);
   *       toast.error("File processing failed");
   *     } finally {
   *       setIsProcessing(false);
   *     }
   *   };
   *
   *   return (
   *     <button
   *       onClick={handleProcessFile}
   *       disabled={isProcessing}
   *     >
   *       {isProcessing ? "Processing..." : "Process File"}
   *     </button>
   *   );
   * }
   * ```
   */
  public emitAsyncSimple<U extends keyof L>(
    event: U,
    ...args: Parameters<L[U]>
  ): Promise<boolean> {
    return this.emitAsync({ event }, ...args);
  }

  /**
   * Emit an event asynchronously, but only locally (no broadcast)
   *
   * @param event Event name
   * @param args Event arguments
   * @returns Promise resolving to boolean indicating if any listeners were triggered
   *
   * @example
   * ```ts
   * // Process locally and wait for completion without broadcasting
   * await emitter.emitAsyncLocal("generateReport", { userId: "user123" });
   * console.log("Local report generation complete");
   * ```
   *
   * @example
   * ```tsx
   * // In a React component that generates reports locally
   * function LocalReportGenerator({ userData }) {
   *   const [isGenerating, setIsGenerating] = useState(false);
   *   const [report, setReport] = useState(null);
   *   const emitter = useRef(ThreadedOrderedEventEmitter.getInstance());
   *
   *   // Set up report generation listener
   *   useEffect(() => {
   *     emitter.current.on("reportGenerated", (reportData) => {
   *       setReport(reportData);
   *     });
   *   }, []);
   *
   *   // Follow "handle" prefix naming convention for event handlers
   *   const handleGenerateReport = async () => {
   *     setIsGenerating(true);
   *     try {
   *       // Process without broadcasting to other threads
   *       await emitter.current.emitAsyncLocal("generateReport", userData);
   *     } finally {
   *       setIsGenerating(false);
   *     }
   *   };
   *
   *   return (
   *     <div>
   *       <button
   *         onClick={handleGenerateReport}
   *         disabled={isGenerating}
   *       >
   *         {isGenerating ? "Generating..." : "Generate Report"}
   *       </button>
   *       {report && <ReportViewer data={report} />}
   *     </div>
   *   );
   * }
   * ```
   */
  public emitAsyncLocal<U extends keyof L>(
    event: U,
    ...args: Parameters<L[U]>
  ): Promise<boolean> {
    return this.emitAsync({ event, localOnly: true }, ...args);
  }

  /**
   * Broadcast an event to other threads
   *
   * @private
   * @param event Event name
   * @param args Event arguments
   * @param options Additional options for broadcasting
   */
  private broadcastEvent<U extends keyof L>(
    event: string,
    args: any[],
    options: {
      priorityBehavior?: "highestFirst" | "lowestFirst";
      isAsync?: boolean;
    } = {},
  ): void {
    const message: ThreadMessage<U, any[]> = {
      type: "event",
      event: event as U,
      args,
      priorityBehavior: options.priorityBehavior,
      isAsync: options.isAsync,
      sourceThreadId: this.threadId,
      messageId: `${this.threadId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    };

    // Serialize the message if a serialization function is provided
    if (this.onSerializeThreadMessage) {
      message.args = this.onSerializeThreadMessage(
        message.args,
      ) as typeof message.args;
    }

    // Try BroadcastChannel first
    if (this.channel) {
      try {
        this.channel.postMessage(message);

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] Broadcast event '${event}' via BroadcastChannel`,
          );
        }
      } catch (err) {
        if (this.debug) {
          console.error(
            "[ThreadedOrderedEventEmitter] Error broadcasting via BroadcastChannel:",
            err,
          );
        }
      }
    }
    // Fall back to parentPort for worker threads
    else if (!isMainThread && parentPort) {
      try {
        parentPort.postMessage(message);

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] Sent event '${event}' to parent thread via parentPort`,
          );
        }
      } catch (err) {
        if (this.debug) {
          console.error(
            "[ThreadedOrderedEventEmitter] Error sending to parent thread:",
            err,
          );
        }
      }
    }

    // Also send to all connected ports
    for (const port of this.connectedPorts) {
      try {
        port.postMessage(message);

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] Sent event '${event}' to connected port`,
          );
        }
      } catch (err) {
        if (this.debug) {
          console.error(
            "[ThreadedOrderedEventEmitter] Error sending to connected port:",
            err,
          );
        }
      }
    }

    // Send to all worker threads
    for (const worker of this.workers) {
      try {
        worker.postMessage(message);

        if (this.debug) {
          console.debug(
            `[ThreadedOrderedEventEmitter] Sent event '${event}' to worker thread`,
          );
        }
      } catch (err) {
        if (this.debug) {
          console.error(
            "[ThreadedOrderedEventEmitter] Error sending to worker thread:",
            err,
          );
        }
      }
    }
  }

  /**
   * Record an event in the history
   *
   * @private
   * @param event Event name
   * @param args Event arguments
   */
  private recordInHistory<U extends keyof L>(
    event: U,
    args: Record<string, unknown>[],
  ): void {
    // Record in history
    this.eventHistory.push({
      event,
      args: [...args],
      timestamp: Date.now(),
      threadId: this.threadId,
    });

    // Trim history if needed
    if (this.eventHistory.length > this.maxHistoryLength) {
      this.eventHistory.shift();
    }
  }

  /**
   * Arrange listeners based on priority behavior
   *
   * @private
   * @param listeners List of listeners to arrange
   * @param priorityBehavior Priority behavior to use
   * @param customArrangement Optional custom arrangement function
   * @returns Arranged listeners
   */
  private arrangeListeners<U extends keyof L>(
    listeners: ListenerInfo<L[U]>[],
    priorityBehavior: "highestFirst" | "lowestFirst",
    customArrangement?: (
      listeners: ListenerInfo<L[U]>[],
    ) => ListenerInfo<L[U]>[],
  ): {
    zeroPriority: ListenerInfo<L[U]>[];
    prioritized: ListenerInfo<L[U]>[];
  } {
    // Return empty array if no listeners
    if (listeners.length === 0) {
      return { zeroPriority: [], prioritized: [] };
    }

    // Split listeners into zero and non-zero priority
    const zeroPriorityListeners = listeners.filter((l) => l.priority === 0);
    const nonZeroPriorityListeners = listeners.filter((l) => l.priority !== 0);

    // Arrange non-zero priority listeners
    let arrangedNonZero: ListenerInfo<L[U]>[];

    if (customArrangement && typeof customArrangement === "function") {
      arrangedNonZero = customArrangement([...nonZeroPriorityListeners]);
    } else if (priorityBehavior === "highestFirst") {
      arrangedNonZero = [...nonZeroPriorityListeners].sort(
        (a, b) => b.priority - a.priority,
      );
    } else {
      arrangedNonZero = [...nonZeroPriorityListeners].sort(
        (a, b) => a.priority - b.priority,
      );
    }

    // Return zero priority first, then arranged non-zero priority
    return {
      zeroPriority: zeroPriorityListeners,
      prioritized: arrangedNonZero,
    };
  }

  /**
   * Process listeners either synchronously or asynchronously
   *
   * @private
   * @param listeners Object containing zero priority and prioritized listeners
   * @param args Arguments to pass to listeners
   * @param event Event name for error reporting
   * @param isAsync Whether to process listeners asynchronously
   * @returns Promise if processing asynchronously, void otherwise
   */
  private processListeners<U extends keyof L>(
    listeners: {
      zeroPriority: ListenerInfo<L[U]>[];
      prioritized: ListenerInfo<L[U]>[];
    },
    args: Parameters<L[U]>,
    event: U,
    isAsync: boolean,
  ): Promise<void> | void {
    // Process zero priority listeners first, in the order they were added
    for (const { listener } of listeners.zeroPriority) {
      try {
        listener(...args);
      } catch (err) {
        if (this.debug) {
          console.error(
            `[ThreadedOrderedEventEmitter] Error in listener for event '${String(event)}':`,
            err,
          );
        }

        this.onListenerError?.(err);
      }
    }

    // Process prioritized listeners
    if (isAsync) {
      // Return a promise for async processing
      return (async () => {
        for (const { listener } of listeners.prioritized) {
          try {
            await listener(...args);
          } catch (err) {
            if (this.debug) {
              console.error(
                `[ThreadedOrderedEventEmitter] Error in async listener for event '${String(event)}':`,
                err,
              );
            }

            this.onListenerError?.(err);
          }
        }
      })();
    } else {
      // Synchronous processing
      for (const { listener, key } of listeners.prioritized) {
        console.log("Processing prioritized listener", key);
        try {
          void listener(...args);
        } catch (err) {
          if (this.debug) {
            console.error(
              `[ThreadedOrderedEventEmitter] Error in listener for event '${String(event)}':`,
              err,
            );
          }

          this.onListenerError?.(err);
        }
      }
    }
  }

  /**
   * Connect to a custom message port.
   * This method allows integration with any object that implements the MessageChannel
   * interface, such as Worker MessagePorts, BroadcastChannel, or custom implementations.
   *
   * @param port MessageChannel compatible object
   * @returns Cleanup function to disconnect the port when no longer needed
   *
   * @example
   * ```ts
   * // Connect to a MessagePort from a MessageChannel
   * const { port1, port2 } = new MessageChannel();
   * const cleanup = emitter.connectPort(port1);
   *
   * // Connect to a BroadcastChannel
   * const channel = new BroadcastChannel("app-channel");
   * const channelCleanup = emitter.connectPort(channel);
   *
   * // Later when done
   * cleanup();
   * channelCleanup();
   * ```
   *
   * @example
   * ```tsx
   * // In a React component
   * function WorkerCommunication() {
   *   const [messages, setMessages] = useState([]);
   *
   *   useEffect(() => {
   *     const emitter = ThreadedOrderedEventEmitter.getInstance();
   *     const { port1, port2 } = new MessageChannel();
   *
   *     // Send port2 to a worker or iframe
   *     worker.postMessage({ port: port2 }, [port2]);
   *
   *     // Connect port1 to the emitter - note the "handle" prefix on the message handler
   *     const cleanup = emitter.connectPort(port1);
   *
   *     // Register event listeners using the "handle" prefix naming convention
   *     const handleMessageReceived = (data) => {
   *       setMessages(prev => [...prev, data]);
   *     };
   *
   *     emitter.on("messageReceived", handleMessageReceived);
   *
   *     return () => {
   *       cleanup();
   *       emitter.off("messageReceived", handleMessageReceived);
   *     };
   *   }, []);
   *
   *   return (
   *     <div>
   *       <h2>Communication Log</h2>
   *       <ul>
   *         {messages.map((msg, i) => <li key={i}>{JSON.stringify(msg)}</li>)}
   *       </ul>
   *     </div>
   *   );
   * }
   * ```
   */
  public connectPort(port: MessageChannel): () => void {
    this.connectedPorts.add(port);

    const handleMessage = (messageOrEvent: any) => {
      // Handle both browser-style events and Node.js-style direct messages
      const data: unknown =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        messageOrEvent && messageOrEvent.data !== undefined
          ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            messageOrEvent.data
          : messageOrEvent;
      this.handleThreadMessage(data as ThreadMessage<keyof L, any[]>);
    };

    // Support both EventTarget and Node.js EventEmitter interfaces
    if (typeof port.addEventListener === "function") {
      port.addEventListener("message", handleMessage);

      if (this.debug) {
        console.debug(
          "[ThreadedOrderedEventEmitter] Connected port with addEventListener interface",
        );
      }

      return () => {
        this.connectedPorts.delete(port);
        if (typeof port.removeEventListener === "function") {
          port.removeEventListener("message", handleMessage);

          if (this.debug) {
            console.debug(
              "[ThreadedOrderedEventEmitter] Disconnected port with removeEventListener interface",
            );
          }
        }
      };
    } else if (typeof port.on === "function") {
      port.on("message", handleMessage);

      if (this.debug) {
        console.debug(
          "[ThreadedOrderedEventEmitter] Connected port with on/off interface",
        );
      }

      return () => {
        this.connectedPorts.delete(port);
        if (typeof port.off === "function") {
          port.off("message", handleMessage);

          if (this.debug) {
            console.debug(
              "[ThreadedOrderedEventEmitter] Disconnected port with on/off interface",
            );
          }
        }
      };
    }

    return () => {
      this.connectedPorts.delete(port);

      if (this.debug) {
        console.debug("[ThreadedOrderedEventEmitter] Disconnected port");
      }
    };
  }

  /**
   * Connect a worker thread to the event system.
   * This method sets up bidirectional communication with a Worker instance,
   * allowing events to be sent and received between the main thread and worker.
   *
   * @param worker Worker instance to connect
   * @returns Cleanup function to disconnect the worker when no longer needed
   *
   * @example
   * ```ts
   * import { Worker } from 'worker_threads';
   *
   * // Create a worker
   * const worker = new Worker('./processor.js');
   *
   * // Connect it to the event system
   * const cleanup = emitter.connectWorker(worker);
   *
   * // Later when done with the worker
   * cleanup();
   * ```
   */
  public connectWorker(worker: Worker): () => void {
    this.workers.add(worker);

    const handleMessage = (data: ThreadMessage<keyof L, any[]>) => {
      this.handleThreadMessage(data);
    };

    worker.on("message", handleMessage);

    if (this.debug) {
      console.debug("[ThreadedOrderedEventEmitter] Connected worker thread");
    }

    return () => {
      this.workers.delete(worker);
      worker.off("message", handleMessage);

      if (this.debug) {
        console.debug(
          "[ThreadedOrderedEventEmitter] Disconnected worker thread",
        );
      }
    };
  }

  /**
   * Clear all message handlers and event listeners.
   * Call this to clean up resources when the emitter is no longer needed.
   * This method releases all resources associated with the emitter, including:
   * - Event listeners
   * - Message handlers
   * - Event history
   * - BroadcastChannel connections
   * - Connected ports
   * - Worker connections
   *
   * @example
   * ```ts
   * // Create an emitter
   * const emitter = new ThreadedOrderedEventEmitter();
   *
   * // Use the emitter...
   *
   * // Clean up all resources when done
   * emitter.clear();
   * ```
   */
  public clear(): void {
    this.listenersMap.clear();
    this.messageHandlers.clear();
    this.eventHistory = [];

    // Close BroadcastChannel if one exists
    if (this.channel) {
      try {
        this.channel.close();
        this.channel = undefined;

        if (this.debug) {
          console.debug(
            "[ThreadedOrderedEventEmitter] Closed BroadcastChannel",
          );
        }
      } catch (err) {
        if (this.debug) {
          console.error(
            "[ThreadedOrderedEventEmitter] Error closing BroadcastChannel:",
            err,
          );
        }
      }
    }

    // Close all connected ports that have a close method
    for (const port of this.connectedPorts) {
      if (typeof port.close === "function") {
        try {
          port.close();

          if (this.debug) {
            console.debug(
              "[ThreadedOrderedEventEmitter] Closed connected port",
            );
          }
        } catch (err) {
          if (this.debug) {
            console.error(
              "[ThreadedOrderedEventEmitter] Error closing connected port:",
              err,
            );
          }
        }
      }
    }

    this.connectedPorts.clear();
    this.workers.clear();

    // Remove from registry
    emitterRegistry.delete(this.channelName);

    if (this.debug) {
      console.debug("[ThreadedOrderedEventEmitter] Cleared all resources");
    }
  }

  public static clearRegistry(): void {
    emitterRegistry.clear();
  }

  public static getRegistry(): Map<string, ThreadedOrderedEventEmitter<any>> {
    return emitterRegistry;
  }
}

/**
 * Configure and get a typed emitter that matches your event interface.
 * This is a convenience function that creates or retrieves an instance
 * from the registry and sets up serialization and error handling.
 *
 * @param options Configuration options for the emitter
 * @returns A properly configured ThreadedOrderedEventEmitter instance with the specified event types
 *
 * @example
 * ```ts
 * interface UserEvents {
 *   login: (userId: string, timestamp: number) => void;
 *   logout: (userId: string) => void;
 * }
 *
 * const emitter = createTypedEmitter<UserEvents>({
 *   channelName: "user-events",
 *   debug: true
 * });
 * ```
 *
 * @example
 * ```tsx
 * // Use within a React application
 * import { createTypedEmitter } from '@satoshibits/ordered-events-emitter';
 * import { createContext, useContext, useEffect, useState } from 'react';
 *
 * // Define your event types
 * interface AppEvents {
 *   userLoggedIn: (userId: string, data: any) => void;
 *   userLoggedOut: (userId: string) => void;
 *   dataUpdated: (newData: any) => void;
 * }
 *
 * // Create a singleton emitter
 * const emitter = createTypedEmitter<AppEvents>({
 *   channelName: "app-events"
 * });
 *
 * // Create a React context for the emitter
 * const EmitterContext = createContext(emitter);
 *
 * // Example React hook to use the emitter
 * function useAppEvents() {
 *   const emitter = useContext(EmitterContext);
 *
 *   // Login function that emits an event
 *   const handleLogin = (userId, userData) => {
 *     // Note the "handle" prefix on event handlers
 *     emitter.emitSimple("userLoggedIn", userId, userData);
 *   };
 *
 *   // Logout function
 *   const handleLogout = (userId) => {
 *     emitter.emitSimple("userLoggedOut", userId);
 *   };
 *
 *   return {
 *     handleLogin,
 *     handleLogout,
 *     emitter
 *   };
 * }
 * ```
 */
export function createTypedEmitter<T extends ListenerSignature<T>>(
  options?: EmitterOptions,
): ThreadedOrderedEventEmitter<T> {
  const instance = ThreadedOrderedEventEmitter.getInstance<T>(options);

  instance.onSerializeThreadMessage = options?.onSerializeThreadMessage;
  instance.onDeserializeThreadMessage = options?.onDeserializeThreadMessage;
  instance.onListenerError = options?.onListenerError;
  return instance;
}

/**
 * Helper to register a thread handler for the main thread.
 * Makes it easy to set up worker thread communication by mapping
 * event types to their respective handler functions.
 *
 * @param handlers A record of event name to handler function mappings
 * @param emitter The emitter instance to use (creates a new one if not provided)
 * @returns A cleanup function to remove the registered handlers
 *
 * @example
 * ```ts
 * interface WorkerEvents {
 *   taskComplete: (taskId: string, result: any) => void;
 *   taskError: (taskId: string, error: Error) => void;
 * }
 *
 * const cleanup = setupMainThreadHandlers<WorkerEvents>({
 *   taskComplete: (message) => {
 *     console.log(`Task ${message.args[0]} completed with result:`, message.args[1]);
 *   },
 *   taskError: (message) => {
 *     console.error(`Task ${message.args[0]} failed:`, message.args[1]);
 *   }
 * });
 *
 * // Later when done:
 * cleanup();
 * ```
 */
export function setupMainThreadHandlers<T extends ListenerSignature<T>>(
  handlers: {
    [K in keyof T]?: (message: ThreadMessage<K, Parameters<T[K]>>) => void;
  },
  emitter?: ThreadedOrderedEventEmitter<T>,
): () => void {
  const eventEmitter = emitter ?? ThreadedOrderedEventEmitter.getInstance<T>();

  const handler = (message: ThreadMessage<keyof T, any[]>) => {
    const eventHandler = handlers[message.event];
    if (eventHandler) {
      eventHandler(
        message as ThreadMessage<
          typeof message.event,
          Parameters<T[typeof message.event]>
        >,
      );
    }
  };

  return eventEmitter.registerThreadMessageHandler(handler);
}

/**
 * Helper to set up a worker thread connection in the main thread.
 * This function connects a worker to an event emitter to enable
 * bidirectional communication with proper event handling.
 *
 * @param worker Worker instance to be connected
 * @param emitter The emitter instance to use (creates a new one if not provided)
 * @returns Cleanup function to remove the connection when no longer needed
 *
 * @example
 * ```ts
 * import { Worker } from 'worker_threads';
 * import { setupWorkerConnection } from '@satoshibits/ordered-events-emitter';
 *
 * // Create a worker
 * const worker = new Worker('./worker.js');
 *
 * // Connect it to the event system
 * const cleanup = setupWorkerConnection(worker);
 *
 * // Later when done:
 * cleanup();
 * ```
 *
 * @example
 * ```tsx
 * // In a React component managing worker threads
 * function WorkerManager({ taskData }) {
 *   const [status, setStatus] = useState('idle');
 *   const workerRef = useRef(null);
 *   const cleanupRef = useRef(null);
 *
 *   useEffect(() => {
 *     // Create and set up a worker when component mounts
 *     const worker = new Worker('./task-worker.js', {
 *       workerData: { initialConfig: taskData.config }
 *     });
 *
 *     // Store the worker reference
 *     workerRef.current = worker;
 *
 *     // Connect the worker with "handle" prefix naming convention for handlers
 *     const emitter = ThreadedOrderedEventEmitter.getInstance();
 *
 *     // Set up event listeners with "handle" prefix
 *     const handleTaskProgress = (progress) => {
 *       setStatus(`Processing: ${progress}%`);
 *     };
 *
 *     const handleTaskComplete = (result) => {
 *       setStatus('completed');
 *       console.log('Task result:', result);
 *     };
 *
 *     emitter.on('taskProgress', handleTaskProgress);
 *     emitter.on('taskComplete', handleTaskComplete);
 *
 *     // Connect the worker and store cleanup reference
 *     cleanupRef.current = setupWorkerConnection(worker, emitter);
 *
 *     // Clean up when component unmounts
 *     return () => {
 *       if (cleanupRef.current) {
 *         cleanupRef.current();
 *       }
 *
 *       emitter.off('taskProgress', handleTaskProgress);
 *       emitter.off('taskComplete', handleTaskComplete);
 *
 *       if (workerRef.current) {
 *         workerRef.current.terminate();
 *       }
 *     };
 *   }, []);
 *
 *   // Handler to start the task (note "handle" prefix)
 *   const handleStartTask = () => {
 *     setStatus('starting');
 *     const emitter = ThreadedOrderedEventEmitter.getInstance();
 *     emitter.emitSimple('startTask', taskData);
 *   };
 *
 *   return (
 *     <div>
 *       <div>Task Status: {status}</div>
 *       <button
 *         onClick={handleStartTask}
 *         disabled={status !== 'idle' && status !== 'completed'}
 *       >
 *         Start Task
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function setupWorkerConnection(
  worker: Worker,
  emitter?: ThreadedOrderedEventEmitter<any>,
): () => void {
  const eventEmitter = emitter ?? ThreadedOrderedEventEmitter.getInstance();
  return eventEmitter.connectWorker(worker);
}

/**
 * Create worker threads with the emitter automatically connected.
 * This is a convenience function that creates a new worker and immediately
 * connects it to the event system for seamless communication.
 *
 * @param filename Path to worker file to be executed
 * @param options Worker options following the Node.js Worker constructor options
 * @param emitter The emitter instance to use (creates a new one if not provided)
 * @returns Object containing the worker instance and a cleanup function
 *
 * @example
 * ```ts
 * import { createConnectedWorker } from '@satoshibits/ordered-events-emitter';
 *
 * // Create and connect a worker in one step
 * const { worker, cleanup } = createConnectedWorker('./task-processor.js', {
 *   workerData: { taskId: 'abc123', priority: 'high' }
 * });
 *
 * // Worker is already connected to the event system
 * // Later when done:
 * cleanup();
 * ```
 */
export function createConnectedWorker(
  filename: string,
  options?: WorkerOptions,
  emitter?: ThreadedOrderedEventEmitter<any>,
): { worker: Worker; cleanup: () => void } {
  const worker = new Worker(filename, options);
  const eventEmitter = emitter ?? ThreadedOrderedEventEmitter.getInstance();
  const cleanup = eventEmitter.connectWorker(worker);
  return { worker, cleanup };
}
