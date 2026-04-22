---
"@satoshibits/observability": minor
---

Bump OpenTelemetry dependencies and add required `forceFlush()` to browser exporters.

- OTel unstable channel (`@opentelemetry/sdk-node`, `sdk-logs`, `api-logs`, `instrumentation*`, `exporter-*-otlp-http`, `exporter-prometheus`, `auto-instrumentations-*`): `0.204.0` → `0.215.0`. This transitively pulls `@opentelemetry/otlp-transformer` to `0.215.0`.
- OTel stable channel (`api` 1.9.0→1.9.1, `core`/`resources`/`context-*`/`sdk-metrics`/`sdk-trace-base`/`sdk-trace-node`/`sdk-trace-web` 2.0.1→2.7.0, `semantic-conventions` 1.36→1.40).
- `lru-cache` 11.2 → 11.3.
- `@sentry/node` (optional) 10.7 → 10.49.
- Add `forceFlush()` to `FetchLogExporter` and `FetchSpanExporter` in `sdk-wrapper-browser.mts`. `LogRecordExporter.forceFlush()` became required in OTel 0.215; added on `FetchSpanExporter` for symmetry.
