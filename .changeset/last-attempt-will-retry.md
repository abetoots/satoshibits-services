---
"@satoshibits/queue": minor
---

Fix `willRetry` and `job.retrying` on a job's last attempt.

The worker compared `job.attempts` (the attempts made _before_ the current one) with `maxAttempts`, so the final attempt of a retry budget still reported `willRetry: true` on the `failed` event and emitted a `job.retrying` event for a retry that never happened. A handler waiting for `!payload.permanent && !payload.willRetry` to detect exhausted retries never saw it.

- `failed`: `willRetry` is now `false` on the last attempt (`attempts + 1 >= maxAttempts`).
- `job.retrying`: emitted once per retry that will actually run (`maxAttempts - 1` times at most), no longer after the last attempt.
- `PermanentJobError` behaviour is unchanged (`permanent: true`, `willRetry: false`, no `job.retrying`).

Released as a minor because consumers that worked around the old behaviour (for example by counting attempts themselves) now also receive the corrected signal.
