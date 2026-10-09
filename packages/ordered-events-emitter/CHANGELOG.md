# @satoshibits/ordered-events-emitter

## 4.0.0

### Major Changes

- 37406c1: The library no longer swallows errors that belong to its consumer. 3.0.0 moved every failure into `onListenerError` and left paths that ended in silence; this closes them, and removes two things the library was doing on its consumer's behalf.

  Breaking:

  - **With no `onListenerError` installed, the rejection of a listener or thread message handler that nothing awaits is an unhandled rejection again**, as it was before 3.0.0. 3.0.0 caught it and, with no hook to report to, dropped it. With a hook installed nothing changes: the rejection is reported to the hook.
  - **A hook that throws is no longer discarded.** It still cannot fail the emit; the throw is raised again in a microtask as an uncaught error. A promise the hook returns is no longer watched: if it rejects, that is an unhandled rejection. What a failing hook means is for the consumer's process-level handling to decide.
  - **`createTypedEmitter` returns an existing emitter as it is.** It used to overwrite the instance's three hooks (with `undefined` when none were passed) and re-apply `maxHistoryLength`. Options apply when an emitter is created and only then. The consequence to know: a hook passed for a channel name that already has an emitter is not installed, and nothing says so. Whoever creates a channel's emitter first decides its hooks (`getInstance()` and `setupMainThreadHandlers(handlers)` with no emitter create the default one with none). Pass the hook at first creation, or set `instance.onListenerError`.
  - **`ListenerErrorContext` has a new member**, `{ source: "transport", event, sync, transport }`. A consumer with an exhaustive `switch` on `context.source` has a compile error to resolve.
  - **An `async` serialiser or deserialiser is no longer special-cased.** Both must be synchronous, as before. The library stops checking for a returned promise: it fails where it lands (a `transport` report on a transport that clones, or a `deserializer` report) and its rejection is the consumer's.

  New:

  - **A message that could not be posted is reported** to the hook with `source: "transport"` and the transport whose `postMessage` threw (`broadcastChannel`, `parentPort`, `port` or `worker`). These failures were swallowed unless `debug` was on, and only the library can see them. The local listeners still run.
  - If the hook is removed while a promise it had taken on is still pending, the rejection is handed back to the runtime rather than dropped.

  Documentation: the hook's context is described as what it is ("identifies what failed; arguments are not passed") and not as a privacy guarantee, since the error itself can carry a payload; and the statement about promises is "native promises are watched; other thenables are not".

  Debug output: a failing hook is no longer printed under `debug` (it reaches the process instead), and the four transport messages are replaced by the one line every reported failure gets.

  Not changed, and worth knowing: a listener that throws synchronously, or one that `emitAsync` awaits, is caught so that the remaining listeners run. With no hook installed that error, like a failing serialiser, deserialiser or transport, is not reported anywhere (unless `debug` is on), as in every earlier version.

## 3.0.0

### Major Changes

- 17a44ef: A failing listener, error hook, serialiser, deserialiser or thread message handler no longer reaches the caller of an emit, or the process as an unhandled rejection. The one value this cannot cover is a promise deliberately built to throw when its `constructor` is read.

  - A listener the emit does not wait for (priority 0 under `emit` or `emitAsync`, and any listener under `emit`) that returns a rejected promise used to be an unhandled rejection, which ends a Node process. The rejection is now caught and handed to `onListenerError`. These listeners are still not awaited: timing is unchanged. Only a genuine promise is watched (the engine decides, so one from another realm counts and an object that merely looks like one does not); any other thenable is left untouched, as before.
  - `onListenerError` is called as `(error, context)`. The context says what failed (`source`, `event`, and for a listener its `key`, `priority` and whether the emit was synchronous) and never carries the event's arguments. A hook that throws, or an `async` hook that rejects, is contained.
  - A handler registered with `registerThreadMessageHandler` that throws is now reported (it was swallowed silently), and one that rejects is no longer an unhandled rejection. The same holds for the handlers given to `setupMainThreadHandlers`, which used to drop what they returned.
  - An event from another thread whose `onDeserializeThreadMessage` throws, or returns something that is not the list of arguments, is dropped and reported; it used to throw into the channel's message callback. So did a delivery that was not a message at all, which is now ignored, and an event whose arguments are not a list, which is now dropped and reported.
  - `onSerializeThreadMessage` and `onDeserializeThreadMessage` must be synchronous, as they always had to be for the event to arrive. One written as an `async` function is now reported as a failure (the event is not broadcast, or is dropped) and its rejection is contained; it used to be an unhandled rejection.
  - The synchronous path no longer prints `Processing prioritized listener` for every prioritized listener.

  Breaking:

  - The event history is off by default. It kept the arguments of the last 100 emits by reference whether or not anything read them. Pass `maxHistoryLength` to the constructor or to `createTypedEmitter`, or call `setMaxHistoryLength`, to switch it on. A length that is not a positive finite number, or a limit below 1, now means "none": `setMaxHistoryLength(0)` and `getEventHistory(0)` used to keep, and return, everything, and a negative limit used to return a slice.
  - `onSerializeThreadMessage` throwing no longer makes `emit` throw or `emitAsync` reject. The event is not broadcast, the local listeners still run, and the error is reported with `source: "serializer"`. Code that relied on the throw to stop an emit must check before emitting.
  - An `onListenerError` that throws no longer makes `emit` throw or `emitAsync` reject. A hook cannot be used to fail an emit.

  Not changed: a custom `arrangeListeners` function passed to an emit is the caller's own code for that emit, and still throws to the caller.

  New:

  - `broadcast: false` makes an emitter local to its thread in both directions: no `BroadcastChannel` is opened, the parent port is not listened to, nothing is serialised or posted (not to a connected port or worker either), and an event arriving from another thread is ignored. It is fixed when the emitter is created.
  - `maxHistoryLength` option.
  - `ListenerErrorContext` type.

## 2.0.0

### Major Changes

- 3f5fce7: ensure it works across v8 isolates like worker threads

## 1.0.4

### Patch Changes

- 92b3d00: move to monorepo and add tests
