---
"@satoshibits/observability": major
---

2.0: OpenTelemetry for a Node.js service from one `--import` flag and the standard `OTEL_*` variables, with redaction at the exporter. New entries: `/register` (a preload), `/preset` (`start`, `forceFlush`, `shutdown`, `getStatus`) and a real-pipeline test kit in `/testing`. See the README.

Migrating from 1.x:

1. **No more `localhost:4318` default.** 1.x exported to `http://localhost:4318` when no endpoint was given. 2.0 exports nothing without an endpoint (the `endpoint` option or `OTEL_EXPORTER_OTLP_ENDPOINT`) and writes one warning per signal. Set the endpoint wherever you relied on the default.
2. **Start telemetry with a preload.** `node --import @satoshibits/observability/register app.js` replaces initialising in application code; it reads only the environment. A project that sets values in code writes its own preload that calls `start(options)` from `/preset` inside a try/catch. Preloads read `process.env` before your app loads any `.env` file: use the command line or `node --env-file`.
3. **`redaction` is required when anything is exported.** `start()` throws when a signal would be exported and no `redaction` option was given. Pass `standardPolicy` from `@satoshibits/redaction` (what `register` and the 1.x facade use), a policy of your own, or `false` to export as given. A preload that names a policy depends on `@satoshibits/redaction` itself.
4. **The root entry is deprecated.** `SmartClient.initialize()` and the 1.x helpers still work: `initialize()` starts the preset's runtime under the standard policy, or attaches to the one a preload started. The root entry is removed in 3.0.0.
5. **The browser entry is removed.** `@satoshibits/observability/browser`, `BrowserClientConfig` and the browser instrumentation presets are gone; 1.3.x stays on npm. For browser telemetry use Grafana Faro, or `@opentelemetry/browser-sdk`, directly.
6. **`MockObservabilityClient` is removed** from `/testing`, with `createMockClient`, `withMockClient` and the `Recorded*` types. Use `startTestTelemetry()`, which runs the real pipeline with in-memory exporters.
7. **Other changes** (each with its 1.x behaviour, its 2.0 behaviour and why, in `COMPATIBILITY.md`):
   - a service name given in code now wins over `OTEL_SERVICE_NAME`;
   - `service.version` is no longer `0.0.0` by default;
   - `deployment.environment` no longer comes from `NODE_ENV`; set `deployment.environment.name` in `OTEL_RESOURCE_ATTRIBUTES` or the `deploymentEnvironment` option;
   - no host or process attributes (host name, command line, executable path, OS user) are collected;
   - logs are exported only with `OTEL_LOGS_EXPORTER=otlp`;
   - metrics are exported every 60 s, not 10 s, unless `OTEL_METRIC_EXPORT_INTERVAL` says otherwise.
