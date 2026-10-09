---
"@satoshibits/ordered-events-emitter": major
---

The library no longer swallows errors that belong to its consumer. 3.0.0 moved every failure into `onListenerError` and left paths that ended in silence; this closes them, and removes two things the library was doing on its consumer's behalf.

Breaking:

- **With no `onListenerError` installed, the rejection of a listener or thread message handler that nothing awaits is an unhandled rejection again**, as it was before 3.0.0. 3.0.0 caught it and, with no hook to report to, dropped it. With a hook installed nothing changes: the rejection is reported to the hook.
- **A hook that throws is no longer discarded.** It still cannot fail the emit; the throw is raised again in a microtask as an uncaught error. A promise the hook returns is no longer watched: if it rejects, that is an unhandled rejection. What a failing hook means is for the consumer's process-level handling to decide.
- **`createTypedEmitter` returns an existing emitter as it is.** It used to overwrite the instance's three hooks (with `undefined` when none were passed) and re-apply `maxHistoryLength`. Options apply when an emitter is created and only then.
- **An `async` serialiser or deserialiser is no longer special-cased.** Both must be synchronous, as before. The library stops checking for a returned promise: it fails where it lands (a `transport` report on a transport that clones, or a `deserializer` report) and its rejection is the consumer's.

New:

- **A message that could not be posted is reported** to the hook with `source: "transport"` and the transport whose `postMessage` threw (`broadcastChannel`, `parentPort`, `port` or `worker`). These failures were swallowed unless `debug` was on, and only the library can see them. The local listeners still run. `ListenerErrorContext` gains this member: a consumer with an exhaustive `switch` on `context.source` has a compile error to resolve.
- If the hook is removed while a promise it had taken on is still pending, the rejection is handed back to the runtime rather than dropped.

Documentation: the hook's context is described as what it is ("identifies what failed; arguments are not passed") and not as a privacy guarantee, since the error itself can carry a payload; and the statement about promises is "native promises are watched; other thenables are not".

Debug output: a failing hook is no longer printed under `debug` (it reaches the process instead), and the four transport messages are replaced by the one line every reported failure gets.

Not changed, and worth knowing: a listener that throws synchronously, or one that `emitAsync` awaits, is caught so that the remaining listeners run. With no hook installed that error, like a failing serialiser, deserialiser or transport, is not reported anywhere (unless `debug` is on), as in every earlier version.
