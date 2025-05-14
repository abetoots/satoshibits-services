# ThreadedOrderedEventEmitter

An advanced event emitter that works seamlessly across threads with priority-based event handling.

## Features

- **Cross-Thread Communication**: Works seamlessly across worker threads using BroadcastChannel (preferred) or parentPort
- **Priority-Based Event Handling**: Control the order of event listener execution
- **Synchronous and Asynchronous Support**: Handle both synchronous and asynchronous event processing
- **Singleton Pattern**: Maintains a registry of instances by channel name
- **Type-Safe Events**: Provides type-safe event definitions with TypeScript generics
- **Event History**: Track and retrieve recent events
- **Custom Serialization**: Customize serialization/deserialization of messages across threads
- **Error Handling**: Configurable error handling for listeners

## Installation

```bash
npm install @satoshibits/ordered-events-emitter
# or
yarn add @satoshibits/ordered-events-emitter
# or
pnpm add @satoshibits/ordered-events-emitter
```

## Basic Usage

```ts
import { ThreadedOrderedEventEmitter } from "@satoshibits/ordered-events-emitter";

// Define your event types
interface MyEvents {
  userJoined: (userId: string, timestamp: number) => void;
  userLeft: (userId: string) => void;
}

// Create an emitter
const emitter = new ThreadedOrderedEventEmitter<MyEvents>();

// Add listeners with priority (higher numbers = higher priority)
emitter.on(
  "userJoined",
  (userId, timestamp) => {
    console.log(`User ${userId} joined at ${timestamp}`);
  },
  2,
); // Will execute first

emitter.on(
  "userJoined",
  (userId) => {
    console.log(`Welcome message sent to ${userId}`);
  },
  1,
); // Will execute second

// Emit events
emitter.emit({ event: "userJoined" }, "user123", Date.now());
```

## Usage Examples

### 1. Priority-Based Event Handling

By default, higher priority listeners are called first:

```ts
interface MyEvents {
  add: (el: string) => void;
}

const emitter = new ThreadedOrderedEventEmitter<MyEvents>();

// Add a listener with priority 1
emitter.on(
  "add",
  (el) => {
    console.log("Second:", el);
  },
  1,
);

// Add a listener with priority 2
emitter.on(
  "add",
  (el) => {
    console.log("First:", el);
  },
  2,
);

emitter.emit({ event: "add" }, "hello");

// Output:
// First: hello
// Second: hello
```

### 2. Asynchronous Event Handling

You can wait for async listeners to complete in order:

```ts
interface MyEvents {
  processData: (data: string) => Promise<void>;
}

const emitter = new ThreadedOrderedEventEmitter<MyEvents>();

// Higher priority listener
emitter.on(
  "processData",
  async (data) => {
    await someAsyncOperation(data);
    console.log("First processor done");
  },
  2,
);

// Lower priority listener
emitter.on(
  "processData",
  async (data) => {
    await anotherAsyncOperation(data);
    console.log("Second processor done");
  },
  1,
);

// Wait for all listeners to complete
await emitter.emitAsync({ event: "processData" }, "sample data");
console.log("All processing complete");

// Output:
// First processor done
// Second processor done
// All processing complete
```

### 3. Custom Listener Arrangement

You can provide a custom function to arrange listeners:

```ts
interface MyEvents {
  custom: (value: string) => void;
}

const emitter = new ThreadedOrderedEventEmitter<MyEvents>();

emitter.on(
  "custom",
  (value) => {
    console.log("Listener 1:", value);
  },
  1,
  "listener1",
);

emitter.on(
  "custom",
  (value) => {
    console.log("Listener 2:", value);
  },
  2,
  "listener2",
);

// Use a custom arrangement to filter or reorder listeners
emitter.emit(
  {
    event: "custom",
    arrangeListeners: (listeners) => {
      // Remove the listener with key "listener2"
      return listeners.filter((listener) => listener.key !== "listener2");
    },
  },
  "test",
);

// Output:
// Listener 1: test
```

### 4. Cross-Thread Communication with Worker Threads

The emitter makes it easy to communicate between the main thread and worker threads:

```ts
// In main.ts
import {
  createConnectedWorker,
  ThreadedOrderedEventEmitter,
} from "@satoshibits/ordered-events-emitter";
import { Worker } from "worker_threads";

interface ThreadEvents {
  taskResult: (result: string) => void;
  taskAssigned: (taskId: string, data: any) => void;
}

// Create an emitter in the main thread
const emitter = ThreadedOrderedEventEmitter.getInstance<ThreadEvents>();

// Register a listener for results from workers
emitter.on(
  "taskResult",
  (result) => {
    console.log("Worker returned:", result);
  },
  1,
);

// Create a worker with the emitter automatically connected
const { worker, cleanup } = createConnectedWorker("./worker.js");

// Assign a task to the worker
emitter.emit({ event: "taskAssigned" }, "task123", { value: 42 });

// When done
cleanup();
```

```ts
// In worker.ts
import { ThreadedOrderedEventEmitter } from "@satoshibits/ordered-events-emitter";
import { parentPort } from "worker_threads";

interface ThreadEvents {
  taskResult: (result: string) => void;
  taskAssigned: (taskId: string, data: any) => void;
}

// Get the same emitter instance in the worker
const emitter = ThreadedOrderedEventEmitter.getInstance<ThreadEvents>();

// Listen for task assignments
emitter.on(
  "taskAssigned",
  async (taskId, data) => {
    console.log(`Worker processing task ${taskId} with data:`, data);

    // Do some work
    const result = `Result for task ${taskId}: ${data.value * 2}`;

    // Send the result back to the main thread
    emitter.emit({ event: "taskResult" }, result);
  },
  1,
);
```

### 5. Using BroadcastChannel for Cross-Window Communication

```ts
// In window 1
import { ThreadedOrderedEventEmitter } from "@satoshibits/ordered-events-emitter";

interface WindowEvents {
  notification: (message: string) => void;
}

// Create emitter with a specific channel name
const emitter = new ThreadedOrderedEventEmitter<WindowEvents>({
  channelName: "app-communication",
});

// Listen for notifications
emitter.on(
  "notification",
  (message) => {
    console.log("Received notification:", message);
  },
  1,
);

// Send a notification (will be received by all windows/threads using this channel)
emitter.emit({ event: "notification" }, "Hello from window 1");
```

```ts
// In window 2
import { ThreadedOrderedEventEmitter } from "@satoshibits/ordered-events-emitter";

interface WindowEvents {
  notification: (message: string) => void;
}

// Create emitter with the same channel name
const emitter = new ThreadedOrderedEventEmitter<WindowEvents>({
  channelName: "app-communication",
});

// Listen for notifications
emitter.on(
  "notification",
  (message) => {
    console.log("Window 2 received:", message);
  },
  1,
);

// Send a notification
emitter.emit({ event: "notification" }, "Hello from window 2");
```

### 6. Simplified Helper Functions

```ts
import {
  createTypedEmitter,
  setupMainThreadHandlers,
  setupWorkerConnection,
} from "@satoshibits/ordered-events-emitter";
import { Worker } from "worker_threads";

interface AppEvents {
  dataReceived: (data: any) => void;
  error: (message: string) => void;
}

// Create a typed emitter
const emitter = createTypedEmitter<AppEvents>({
  debug: true,
  channelName: "app-events",
});

// Setup main thread handlers
const cleanup = setupMainThreadHandlers<AppEvents>(
  {
    dataReceived: (message) => {
      console.log("Data received in main thread:", message.args[0]);
    },
    error: (message) => {
      console.error("Error received:", message.args[0]);
    },
  },
  emitter,
);

// Connect a worker
const worker = new Worker("./worker.js");
const workerCleanup = setupWorkerConnection(worker, emitter);

// Later, clean up resources
cleanup();
workerCleanup();
```

## API Reference

### ThreadedOrderedEventEmitter Class

The main class that provides event emitting functionality.

```ts
class ThreadedOrderedEventEmitter<L extends ListenerSignature<L> = DefaultListener>
```

#### Constructor

```ts
constructor(options?: EmitterOptions)
```

Options:

- `channelName`: Name for the BroadcastChannel (default: 'threaded-ordered-events')
- `defaultPriorityBehavior`: Default priority behavior (default: 'highestFirst')
- `threadId`: Unique identifier for the thread (default: auto-generated)
- `debug`: Enable debug logging (default: false)
- `onSerializeThreadMessage`: Function to serialize thread messages
- `onDeserializeThreadMessage`: Function to deserialize thread messages
- `onListenerError`: Error handler for listener errors

#### Static Methods

- `getInstance<T>(options?: EmitterOptions)`: Get or create a singleton instance.
- `clearRegistry(): void`: Clears the emitter registry. Useful for testing to ensure isolation.
- `getRegistry(): Map<string, ThreadedOrderedEventEmitter<any>>`: Returns the internal emitter registry map.

#### Event Registration

- `on<U>(event: U, listener: L[U], priority = 0, key?: string): this`: Add an event listener
- `addListener<U>(event: U, listener: L[U], priority = 0, key?: string): this`: Alias for `on()`
- `once<U>(event: U, listener: L[U], priority = 0, key?: string): this`: Add a one-time listener
- `off<U>(event: U, listener: L[U]): this`: Remove a specific listener
- `offByKey<U>(event: U, key: string): this`: Remove a listener by key
- `offAll<U>(event: U): this`: Remove all listeners for an event

#### Event Emission

- `emit<U>(options: EmitFunctionOptions, ...args: Parameters<L[U]>): boolean`: Emit an event. The `options` object can include:
  - `event: U`: The event name.
  - `priorityBehavior?: "highestFirst" | "lowestFirst"`: Override default priority.
  - `arrangeListeners?: (listeners: ListenerInfo<L[U]>[]) => ListenerInfo<L[U]>[]`: Custom function to filter/sort listeners.
  - `localOnly?: boolean`: If true, only emit to local listeners, do not broadcast.
- `emitSimple<U>(event: U, ...args: Parameters<L[U]>): boolean`: Simplified emit (broadcasts by default).
- `emitLocal<U>(event: U, ...args: Parameters<L[U]>): boolean`: Emit only locally.
- `emitAsync<U>(options: EmitFunctionOptions, ...args: Parameters<L[U]>): Promise<boolean>`: Async emit. `options` are the same as `emit`.
- `emitAsyncSimple<U>(event: U, ...args: Parameters<L[U]>): Promise<boolean>`: Simplified async emit (broadcasts by default).
- `emitAsyncLocal<U>(event: U, ...args: Parameters<L[U]>): Promise<boolean>`: Async emit locally.

#### Thread Communication

- `registerThreadMessageHandler(handler: (message: ThreadMessage<keyof L, any[]>) => void): () => void`: Register a handler for thread messages.

#### Utility Methods

- `getThreadId(): string | number`: Get the thread ID
- `getChannelName(): string`: Get the channel name
- `setDebugMode(debug: boolean): void`: Set debug mode
- `hasListeners<U>(event: U): boolean`: Check if event has listeners
- `listenerCount<U>(event: U): number`: Get listener count for an event
- `getListeners<U>(event: U): ListenerInfo<L[U]>[]`: Get all listeners for an event
- `eventNames(): (keyof L)[]`: Get all registered event names
- `getEventHistory(limit?: number): { event: keyof L; args: any[]; timestamp: number; threadId: string | number; }[]`: Get recent event history.
- `setMaxHistoryLength(length: number): void`: Set the maximum event history length
- `clear(): void`: Clear all resources

### Helper Functions

This module also exports several helper functions to simplify common tasks:

#### `createTypedEmitter<T extends ListenerSignature<T>>(options?: EmitterOptions): ThreadedOrderedEventEmitter<T>`

Configures and retrieves a typed `ThreadedOrderedEventEmitter` instance. This function uses a registry to ensure that instances with the same `channelName` are singletons. It's useful for creating an emitter that is strongly typed according to your application's event structure.

- `options`: Optional `EmitterOptions` to configure the emitter.
- **Returns**: A `ThreadedOrderedEventEmitter<T>` instance.

#### `setupMainThreadHandlers<T extends ListenerSignature<T>>(handlers: { [K in keyof T]?: (message: ThreadMessage<K, Parameters<T[K]>>) => void; }, emitter?: ThreadedOrderedEventEmitter<T>): () => void`

Registers event handlers on the main thread, typically for messages received from worker threads. This simplifies setting up listeners for specific event types originating from workers.

- `handlers`: An object where keys are event names (from `T`) and values are handler functions. Handler functions receive a `ThreadMessage` object containing the event arguments.
- `emitter`: Optional `ThreadedOrderedEventEmitter<T>` instance. If not provided, one is retrieved or created based on default or provided options in `handlers`.
- **Returns**: A cleanup function that, when called, removes all registered handlers.

#### `setupWorkerConnection(worker: Worker, emitter?: ThreadedOrderedEventEmitter<any>): () => void`

Connects a given `Worker` instance to the event emitter system. This sets up the necessary message listeners on the worker to enable bidirectional communication with the main thread (or other workers) via the emitter.

- `worker`: The `Worker` instance to connect.
- `emitter`: Optional `ThreadedOrderedEventEmitter<any>` instance. If not provided, one is retrieved or created.
- **Returns**: A cleanup function that, when called, removes the message listener from the worker.

#### `createConnectedWorker(filename: string, options?: WorkerOptions, emitter?: ThreadedOrderedEventEmitter<any>): { worker: Worker; cleanup: () => void }`

A convenience function that creates a new `Worker`, connects it to the event emitter system using `setupWorkerConnection`, and returns the worker instance along with a cleanup function. The cleanup function terminates the worker and removes its listeners.

- `filename`: The path to the worker script.
- `options`: Optional `WorkerOptions` for the worker constructor.
- `emitter`: Optional `ThreadedOrderedEventEmitter<any>` instance.
- **Returns**: An object containing:
  - `worker`: The created and connected `Worker` instance.
  - `cleanup`: A function to terminate the worker and clean up associated resources.

## Testing

When testing code that uses ThreadedOrderedEventEmitter, you can disable cross-thread behavior:

```ts
// In test files
import { ThreadedOrderedEventEmitter } from "@satoshibits/ordered-events-emitter";

// Set up a test-specific emitter
const emitter = new ThreadedOrderedEventEmitter<MyEvents>({
  // Setting a unique channelName prevents interference with other tests
  channelName: `test-channel-${Math.random()}`,
});

// Test your event handlers
emitter.on("eventName", (arg1, arg2) => {
  // Your test assertions
});

// Emit events
emitter.emit({ event: "eventName" }, "arg1", "arg2");
```

## License

ISC
