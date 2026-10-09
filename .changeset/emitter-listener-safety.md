---
"@satoshibits/ordered-events-emitter": major
---

A failing listener, error hook, serialiser, deserialiser or thread message handler no longer reaches the caller of an emit, or the process as an unhandled rejection. The one value this cannot cover is a promise deliberately built to throw when its `constructor` is read.

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
