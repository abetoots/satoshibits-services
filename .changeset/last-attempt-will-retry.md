---
"@satoshibits/queue": minor
---

Fix `willRetry` and `job.retrying` on a job's last attempt.

The worker compared `job.attempts` (the attempts made _before_ the current one) with `maxAttempts`, so the final attempt of a retry budget still reported `willRetry: true` on the `failed` event and emitted a `job.retrying` event for a retry that never happened. A handler waiting for `!payload.permanent && !payload.willRetry` to detect exhausted retries never saw it.

- `failed`: `willRetry` is now `false` on the last attempt (`attempts + 1 >= maxAttempts`).
- `job.retrying`: emitted only when `willRetry` is `true`, no longer after the last attempt (so `maxAttempts - 1` times in an uninterrupted run of a job with at least one attempt).
- `PermanentJobError` behaviour is unchanged (`permanent: true`, `willRetry: false`, no `job.retrying`).

Make `retryable: false` permanent on every path.

One rule now decides permanence everywhere: an error is permanent when it is a `PermanentJobError` **or** it carries `retryable === false` (an `Error` instance with that property, or a plain structured object such as a `QueueError`), whether the handler throws it or returns it through `Result.err`. The rule is exported as `isPermanentError`. Before, the memory provider and BullMQ's pull `nack()` applied it, BullMQ's push model and the `failed` event did not, and the worker wrapped a plain object in `new Error(String(error))`, losing the flag and the message.

**Behaviour changes:**

- **BullMQ push model (a `Worker` with `BullMQProvider`): a handler that returns or throws an error carrying `retryable: false` is no longer retried.** The job fails after that attempt, as it does for `PermanentJobError` (the provider translates it to BullMQ's `UnrecoverableError`, with the original as `cause`). Before, it ran until its attempts were spent.
- **A plain-object error with `retryable: false` is no longer retried** in the memory provider or BullMQ's pull model either (before, only an `Error` instance carrying the flag stopped the retries there).
- `failed`: `permanent: true` and `willRetry: false` for any error the rule covers, and no `job.retrying` (before, `permanent` was `true` only for `PermanentJobError`).
- **Plain-object errors keep their message**: `failed.error`, the memory provider's stored `error` and BullMQ's `failedReason` carry the object's `message` instead of `"[object Object]"`. `structuredError` is still the original value.
- This includes a library `QueueError` a handler forwards (for example `return result` on a failed `queue.add()`): many of those carry `retryable: false`, among them the catch-all for an unrecognised provider error. A handler that wants such a failure retried should return or throw its own `Error`.
- The worker hands the provider the handler's original error instead of a wrapper: `nack()` receives the structured object itself, and in the push model the handler given to `process()` rejects with it (only a thrown primitive is still wrapped in an `Error`). **Custom providers** that assumed an `Error` in `process()` should convert at their boundary; `BullMQProvider` does (a non-`Error` that is not permanent is wrapped in an `Error` with the original as `cause`).

`willRetry` remains the worker's prediction from the job's own budget; the README lists where a provider can decide otherwise (SQS redrive policy, which does not apply the permanence rule, BullMQ's own `UnrecoverableError`, `job.discard()` and a backoff strategy returning `-1`, a failure the provider could not record).

Released as a minor because consumers that worked around the old behaviour (for example by counting attempts themselves) now also receive the corrected signal, and because jobs failing with `retryable: false` stop being retried.
