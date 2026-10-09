---
"@satoshibits/ordered-events-emitter": major
---

A failing listener, error hook or serialiser can no longer reach the caller of an emit or the process.

- A listener the emit does not wait for (priority 0 under `emit` or `emitAsync`, and any listener under `emit`) that returns a rejected promise used to be an unhandled rejection, which ends a Node process. The rejection is now caught and handed to `onListenerError`. These listeners are still not awaited: timing is unchanged.
- `onListenerError` is called as `(error, context)`. The context says what failed (`source`, `event`, the listener's `key` and `priority`, and whether the emit was synchronous) and never carries the event's arguments. A hook that throws is contained.
- `onSerializeThreadMessage` throwing no longer makes `emit` throw or `emitAsync` reject: the event is not broadcast, the local listeners still run, and the error is reported with `source: "serializer"`.
- The synchronous path no longer prints `Processing prioritized listener` for every prioritized listener.

Breaking:

- The event history is off by default. It kept the arguments of the last 100 emits by reference whether or not anything read them. Pass `maxHistoryLength` to the constructor, or call `setMaxHistoryLength`, to switch it on. `setMaxHistoryLength(0)` and `getEventHistory(0)` now mean "none"; they used to keep, and return, everything.

New:

- `broadcast: false` makes an emitter local to its thread: no `BroadcastChannel` is opened, nothing is serialised and nothing is posted.
- `maxHistoryLength` constructor option.
- `ListenerErrorContext` type.
