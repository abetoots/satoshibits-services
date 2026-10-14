# Compatibility with 1.x

The root entry (`@satoshibits/observability`) is the 1.x client facade. In 2.x it is kept for one
major version, deprecated, as a thin layer over the preset (`@satoshibits/observability/preset`),
and removed in 3.0.0.

Every row below has a test. `src/__tests__/preset/compatibility.test.mts` reads these tables: it fails
when the root entry exports a name with no row, when a row names something that is not exported
(unless the row says `removed`), and when a row's test does not exist.

## Root entry exports

Every name the root entry exported in 1.x. "unchanged" means it resolves and behaves as in 1.x.
Each row is checked by the test of the same name in `compatibility.test.mts`.

<!-- root-exports:start -->
| Export | Kind | Status | Notes |
| --- | --- | --- | --- |
| `ApplicationContext` | type | unchanged | |
| `ContextEnricher` | value | unchanged | |
| `Meter` | type | unchanged | re-exported from `@opentelemetry/api` |
| `SanitizerManager` | value | unchanged | its masks are now the redaction package's; their output is as in 1.x |
| `SanitizerOptions` | type | unchanged | |
| `SanitizerPresets` | value | unchanged | |
| `SmartClient` | value | changed | runs on the preset's runtime; see "The facade's config and behaviour" |
| `SmartContext` | type | unchanged | |
| `SmartSampler` | value | unchanged | the class itself; the facade no longer installs it (row `sampling`) |
| `SmartSamplerConfig` | type | unchanged | |
| `Span` | type | unchanged | re-exported from `@opentelemetry/api` |
| `SpanKind` | value | unchanged | re-exported from `@opentelemetry/api` |
| `SpanStatusCode` | value | unchanged | re-exported from `@opentelemetry/api` |
| `Tracer` | type | unchanged | re-exported from `@opentelemetry/api` |
| `UnifiedObservabilityClient` | value | unchanged | |
| `addBreadcrumb` | value | unchanged | |
| `addTag` | value | unchanged | |
| `categorizeErrorForObservability` | value | unchanged | |
| `clearContext` | value | unchanged | |
| `clearSanitizationCache` | value | unchanged | |
| `createSmartCounter` | value | unchanged | |
| `createSmartGauge` | value | unchanged | |
| `createSmartHistogram` | value | unchanged | |
| `createSmartSampler` | value | unchanged | |
| `createSmartUpDownCounter` | value | unchanged | |
| `extractResultError` | value | unchanged | |
| `extractResultValue` | value | unchanged | |
| `getAllInstances` | value | unchanged | |
| `getCacheStats` | value | unchanged | |
| `getEnrichedLabels` | value | unchanged | |
| `getGlobalContext` | value | unchanged | |
| `getInstanceCount` | value | unchanged | |
| `getResultAdapter` | value | unchanged | |
| `getSmartContext` | value | unchanged | |
| `getUnifiedClientInstance` | value | unchanged | |
| `initializeObservability` | value | changed | the same function as `SmartClient.initialize` |
| `isResultFailure` | value | unchanged | |
| `isResultLike` | value | unchanged | |
| `isResultSuccess` | value | unchanged | |
| `mergeBusinessContext` | value | unchanged | |
| `normalizeHash` | value | unchanged | |
| `reportError` | value | unchanged | |
| `runWithBusinessContext` | value | unchanged | |
| `sanitize` | value | unchanged | |
| `sanitizeError` | value | unchanged | |
| `sanitizeObject` | value | unchanged | |
| `sanitizeString` | value | unchanged | |
| `setUser` | value | unchanged | |
| `shutdownObservability` | value | changed | the same function as `SmartClient.shutdown`; see rows `shutdown` and `shutdown-test-mode` |
| `withErrorReporting` | value | unchanged | |
<!-- root-exports:end -->

## Types the sanitizer exports' signatures expose

Not exported by name, but reachable through the signatures above, so they are kept with them.

<!-- signature-types:start -->
| Type | Reached through | Status |
| --- | --- | --- |
| `DataSanitizer` | `SanitizerManager.getSanitizer()`, `SanitizerManager.getDefault()` | unchanged |
| `SanitizationContext` | the second parameter of `sanitize`, `sanitizeError`, `sanitizeObject`, `sanitizeString`; `SanitizerManager.getSanitizer()` | unchanged |
| `SanitizedValue` | the return of `sanitize` and `sanitizeObject` | unchanged |
<!-- signature-types:end -->

## The facade's config and behaviour

What `SmartClient.initialize` does with its Node config, as against 1.x. A "changed" row says why.

<!-- facade-behaviour:start -->
| Row | 1.x | 2.x | Status | Why | Test |
| --- | --- | --- | --- | --- | --- |
| `endpoint` | exported traces, metrics and logs to it | overrides `OTEL_EXPORTER_OTLP_ENDPOINT`; traces and metrics go to it | unchanged | | `subprocess/facade.test.mts` › exports to the endpoint and with the headers given in code |
| `headers` | sent with every export | added to every signal's request headers | unchanged | | `subprocess/facade.test.mts` › exports to the endpoint and with the headers given in code |
| `endpoint-v1-traces` | a trailing `/v1/traces` was stripped | the same | unchanged | | `subprocess/facade.test.mts` › strips a trailing /v1/traces from the endpoint, as 1.x did |
| `default-endpoint` | no endpoint meant `http://localhost:4318` | no endpoint means nothing is exported, with one warning per signal | changed | an address nobody configured must not receive data; set the endpoint in code or `OTEL_EXPORTER_OTLP_ENDPOINT` | `subprocess/facade.test.mts` › exports nothing without an endpoint: the implicit localhost:4318 of 1.x is gone |
| `logs` | always exported beside traces and metrics | exported only with `OTEL_LOGS_EXPORTER=otlp` | changed | application logs usually have a destination already; logs are opt-in in the preset | `subprocess/facade.test.mts` › exports logs only when OTEL_LOGS_EXPORTER=otlp asks for them, where 1.x always did |
| `metric-interval` | metrics exported every 10 s | every 60 s, or `OTEL_METRIC_EXPORT_INTERVAL` | changed | the specification's default; the interval is the environment's to set | `facade.test.mts` › builds the metric reader for an endpoint with a 60 s interval, where 1.x used 10 s |
| `serviceName` | on the resource; won over `OTEL_SERVICE_NAME` | the same | unchanged | | `subprocess/facade.test.mts` › puts the service name and version given in code on the resource, and no 1.x defaults |
| `service-version-default` | `service.version` was `0.0.0` when none was given | not set unless given | changed | the preset sets no value nobody gave | `subprocess/facade.test.mts` › puts the service name and version given in code on the resource, and no 1.x defaults |
| `NODE_ENV` | `deployment.environment` from `NODE_ENV` (default `production`) | not set; use `OTEL_RESOURCE_ATTRIBUTES` or the preset's `deploymentEnvironment` | changed | the resource comes from the preset's options and the `OTEL_*` variables only | `subprocess/facade.test.mts` › puts the service name and version given in code on the resource, and no 1.x defaults |
| `empty-service-name` | started with an empty service name | refused unless `OTEL_SERVICE_NAME` is set: the facade logs the configuration error and runs without telemetry | changed | the preset requires a service name | `subprocess/facade.test.mts` › refuses an empty service name with no OTEL_SERVICE_NAME, and runs without telemetry |
| `redaction` | the client's sanitizer masked attributes set through the client's own API; the rest (instrumentation, the raw OTel API) was exported as given | every export also goes through `@satoshibits/redaction`'s standard policy | changed | a 1.x consumer expected redaction by default; the preset redacts at the exporter, where everything passes | `subprocess/facade.test.mts` › exports under the standard redaction policy |
| `sampling` | installed `SmartSampler` | no effect, with a warning | changed | the preset takes a sampler by name only; use `OTEL_TRACES_SAMPLER` | `facade.test.mts` › warns that sampling no longer has an effect |
| `OTEL_TRACES_SAMPLER` | honoured | honoured | unchanged | | `facade.test.mts` › honours OTEL_TRACES_SAMPLER, as 1.x did |
| `samplingRate` | an invalid rate warned; the rate was never applied | the same | unchanged | | `facade.test.mts` › warns about an invalid samplingRate and about enablePrometheus, and applies neither, as 1.x did |
| `enablePrometheus` | warned that it is not implemented | the same | unchanged | | `facade.test.mts` › warns about an invalid samplingRate and about enablePrometheus, and applies neither, as 1.x did |
| `disableInstrumentation` | `true` (or `autoInstrument: false`) installed no instrumentation | the same | unchanged | | `subprocess/facade.test.mts` › installs the auto-instrumentation unless disableInstrumentation or autoInstrument: false |
| `testSpanProcessor` | installed as given; network exporters off, but the SDK could still build exporters from the environment | installed as given; every signal without a hook is off, whatever the environment says | changed | a test hook must not let anything reach the network | `subprocess/facade.test.mts` › delivers spans to an injected test span processor and sends nothing over the network |
| `testMetricReader` | installed as given, as for `testSpanProcessor` | installed as given; its failed exports are reported once in diagnostics | changed | as for `testSpanProcessor` | `facade.test.mts` › reports a failed export behind a metric reader given to initialize exactly once |
| `OBS_TEST_NO_EXPORT` | `1` dropped the facade's own exporters | `1` turns every signal off, whatever the environment says | changed | as for `testSpanProcessor` | `subprocess/facade.test.mts` › sends nothing anywhere with the old no-export flag, whatever the variables say |
| `OTEL_SDK_DISABLED-hooks` | the test hooks still received data | the test hooks receive nothing | changed | the preset registers nothing when disabled | `facade.test.mts` › gives the test hooks nothing with OTEL_SDK_DISABLED=true |
| `preload` | a second SDK was built beside a preloaded one | attaches to the runtime already there and builds nothing | changed | one runtime per process | `subprocess/facade.test.mts` › attaches to the runtime already there and builds nothing |
| `preload-hooks` | — | test hooks given to a facade that attaches are not used, with a warning | changed | one runtime per process | `facade.test.mts` › warns that the test hooks it was given are not used when it attaches |
| `initialize-twice` | returned the same client, with a warning | the same; the runtime is started once | unchanged | | `facade.test.mts` › returns the client it already has when initialize is called twice, and starts nothing again |
| `shutdown` | shut the SDK down; a later initialize started a new one | shuts the runtime down, the one attached to included; a later initialize attaches to the stopped runtime | changed | a process starts telemetry once | `subprocess/facade.test.mts` › does not start again after a shutdown outside test mode: the second initialize attaches |
| `shutdown-test-mode` | a later initialize started again | with a test hook or `OBS_TEST_NO_EXPORT=1`, shutdown also resets the runtime, so a later initialize starts again | unchanged | | `facade.test.mts` › starts again after a shutdown in test mode, with the new hooks |
| `skipSdkInitialization` | built nothing and used the registered providers | the same | unchanged | | `facade.test.mts` › builds nothing with skipSdkInitialization, as 1.x did |
| `enableProcessHandlers` | registered the process handlers, removed at shutdown | the same | unchanged | | `facade.test.mts` › registers its process handlers with enableProcessHandlers and removes them at shutdown, as 1.x did |
| `sanitizerOptions` | configured the root entry's sanitize helpers | the same | unchanged | | `facade.test.mts` › configures the root entry's sanitize helpers with sanitizerOptions, as 1.x did |
<!-- facade-behaviour:end -->
