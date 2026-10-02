---
"@satoshibits/queue": minor
---

Fix `willRetry` and `job.retrying` on a job's last attempt.

The worker compared `job.attempts` (the attempts made _before_ the current one) with `maxAttempts`, so the final attempt of a retry budget still reported `willRetry: true` on the `failed` event and emitted a `job.retrying` event for a retry that never happened. A handler waiting for `!payload.permanent && !payload.willRetry` to detect exhausted retries never saw it.

- `failed`: `willRetry` is now `false` on the last attempt (`attempts + 1 >= maxAttempts`).
- `job.retrying`: emitted only when `willRetry` is `true`, no longer after the last attempt (so `maxAttempts - 1` times in an uninterrupted run of a job with at least one attempt).
- `PermanentJobError` behaviour is unchanged (`permanent: true`, `willRetry: false`, no `job.retrying`).

Make `retryable: false` permanent on every path.

One rule now decides permanence everywhere: an error is permanent when it is a `PermanentJobError` **or** it carries `retryable === false` (an `Error` instance with that property, or a plain structured object such as a `QueueError`), whether the handler throws it or returns it through `Result.err`. The rule is exported as `isPermanentError`. Before, the memory provider's and BullMQ's pull `nack()` applied it to the value they were given, BullMQ's push model and the `failed` event did not, and the worker wrapped a plain object in `new Error(String(error))` before any provider saw it, losing the flag and the message.

**Behaviour changes:**

- **BullMQ push model (a `Worker` with `BullMQProvider`): a handler that returns or throws an error carrying `retryable: false` is no longer retried.** The job fails after that attempt, as it does for `PermanentJobError` (the provider translates it to BullMQ's `UnrecoverableError`, with the original as `cause`). Before, it ran until its attempts were spent.
- **Through a `Worker`, a plain-object error with `retryable: false` is no longer retried** in the memory provider or BullMQ's pull model either. Their `nack()` already honoured the flag on a plain object passed to it directly; through a `Worker` only an `Error` instance carrying the flag reached it intact.
- `failed`: `permanent: true` and `willRetry: false` for any error the rule covers, and no `job.retrying` (before, `permanent` was `true` only for `PermanentJobError`).
- **Plain-object errors keep their message**: `failed.error`, the memory provider's stored `error` and BullMQ's `failedReason` carry the object's `message` instead of `"[object Object]"`. `structuredError` is still the original value.
- This includes a library `QueueError` a handler forwards (for example `throw result.error` on a failed `queue.add()`): its `retryable` flag now decides whether the job is retried. So that a failure nothing proves permanent does not end the job on its first attempt, **these library errors change from `retryable: false` to `retryable: true`**:
  - BullMQ and SQS: **an error the adapter does not recognise** (the catch-all of each provider's error mapping, for example Redis `READONLY` or `OOM`), and SQS's "Unhandled AWS SQS Error".
  - BullMQ and SQS: `SHUTDOWN` ("Provider is shutting down."), from every method that returns it.
  - BullMQ: a lost or mismatched job lock, and a Redis script error (any message naming `script`, `lua` or `evalsha`).

  The job's attempt budget bounds the retries. Still `retryable: false`: invalid configuration, validation and serialization failures, duplicates, a job or queue not found, a missing lock token or receipt handle, AWS permission and credential errors, and BullMQ's `UnrecoverableError`. BullMQ's `DelayedError`, `WaitingChildrenError` and `WaitingError` are unchanged: they are control flow, not failures (see the README).
- Inspecting a failure never throws. A `retryable` flag that cannot be read (a throwing getter, a Proxy) is not `false`, so the error is retried; an object with no string `message` is reported by its JSON (capped at 500 characters) or as `Unknown error (no readable message)`.
- The worker hands the provider the handler's original error instead of a wrapper: `nack()` receives the structured object itself, and in the push model the handler given to `process()` rejects with it (only a thrown primitive is still wrapped in an `Error`, which now keeps the primitive as its `cause`). **Custom providers** that assumed an `Error` in `process()` should convert at their boundary; `BullMQProvider` does, for anything that fails inside its processor (a non-`Error` that is not permanent is wrapped in an `Error` with the original as `cause`).

`willRetry` remains the worker's prediction from the job's own budget; the README lists where a provider can decide otherwise (SQS redrive policy, which does not apply the permanence rule, BullMQ's own `UnrecoverableError`, `job.discard()` and a backoff strategy returning `-1`, a failure the provider could not record).

Released as a minor because consumers that worked around the old behaviour (for example by counting attempts themselves) now also receive the corrected signal, because jobs failing with `retryable: false` stop being retried, and because unrecognised provider errors are now `retryable: true`.
