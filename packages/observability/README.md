# @satoshibits/observability

Telemetry for a Node.js service, set up with one command-line flag.

[OpenTelemetry](https://opentelemetry.io) is the open standard for a service's telemetry: **traces**
(the steps of each request, with their timings), **metrics** (counts and measurements over time) and
**logs**. A service sends them over **OTLP**, OpenTelemetry's protocol, to a backend such as Grafana
Cloud or to a collector. This package configures OpenTelemetry's Node.js SDK for you, from the
standard `OTEL_*` environment variables, and redacts what it exports.

<!-- illustrative: installs the packages; the tests run against this repository's build -->
```sh
pnpm add @satoshibits/observability
```

## Quick start

Set the service's name and where to send telemetry, and load the package before your application
with Node's `--import` flag (a **preload**: a module Node runs before your code):

<!-- snippet: quick-start -->
```sh
OTEL_SERVICE_NAME=checkout \
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com \
node --import @satoshibits/observability/register app.js
```

That is the whole setup. HTTP, Express, database drivers and the other libraries of OpenTelemetry's
Node bundle are traced automatically (the noisy `fs`, `net` and `dns` ones are off), and lines written
with pino, winston or bunyan carry the trace id of the request that wrote them. Everything exported
passes the standard redaction policy (below), and one line on stderr says so.

A mistake in the variables (a malformed URL, an unknown sampler) is reported on stderr and the service
starts without telemetry: a typo must not stop a service from booting.

The variables, all from the OpenTelemetry specification:

| Variable | What it does |
|---|---|
| `OTEL_SERVICE_NAME` | the service's name; required |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | where to send; nothing is exported without it. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` and `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` set one signal's |
| `OTEL_EXPORTER_OTLP_HEADERS` | headers for every request, such as `Authorization=Basic …` for Grafana Cloud |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (the default) or `http/json`; `grpc` is not supported |
| `OTEL_LOGS_EXPORTER` | `otlp` to export logs; they are off otherwise |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` | `none` turns that signal off |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | which traces to keep, e.g. `parentbased_traceidratio` and `0.1` for a tenth |
| `OTEL_RESOURCE_ATTRIBUTES` | facts about the process, e.g. `deployment.environment.name=production,service.version=1.4.0` |
| `OTEL_METRIC_EXPORT_INTERVAL` | how often metrics are sent, in milliseconds (default 60000) |
| `OTEL_LOG_LEVEL` | how much the package itself reports on stderr (default `warn`) |
| `OTEL_SDK_DISABLED` | `true` turns everything off |

### Variables in `.env` files

A preload runs before your application's code, and it reads `process.env` directly. Variables your
application loads from a `.env` file itself (with dotenv, say) are read too late. Set them on the
command line, or have Node read the file first:

<!-- snippet: env-file -->
```sh
node --env-file=.env --import @satoshibits/observability/register app.js
```

## Redaction

Telemetry leaves the process, so what it carries is redacted on the way out. The **standard policy**,
which `register` uses, comes from [`@satoshibits/redaction`](https://github.com/abetoots/satoshibits-services/tree/main/packages/redaction#readme)
(its README has the full table). In short, it:

- cuts every URL down to scheme, host and path, so query strings go;
- masks email addresses, `Bearer` tokens, JWTs, keys with a vendor's prefix and `password: value` pairs;
- replaces the value of any key that names a password, secret, token, cookie or authorization;
- drops the caller's IP address, and an exception's message and stack trace from spans.

Metric attributes are not passed to the policy: they are bounded names chosen in code, and a masked value would merge separate series.

### A policy of your own

To name your own policy, or to set values in code, write a small preload of your own. It depends on
`@satoshibits/redaction` directly:

<!-- snippet: custom-preload -->
```js
// telemetry.mjs: import only the preset, the redaction package and Node built-ins here
import { start } from "@satoshibits/observability/preset";
import { createPolicy, standardParts, standardRules } from "@satoshibits/redaction";

// the standard policy, but keeping the caller's address: this service is not public
const policy = createPolicy({
  ...standardParts,
  dropKeys: standardParts.dropKeys.filter((rule) => rule !== standardRules.peerAddresses),
});

try {
  start({ serviceName: "checkout", redaction: policy });
} catch (error) {
  // a configuration error: run without telemetry rather than not at all
  console.error(error);
}
```

<!-- snippet: custom-preload-run -->
```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com node --import ./telemetry.mjs app.js
```

`redaction: false` exports everything as given. When something is to be exported and `redaction` is
not given, `start()` throws. Keep the preload's imports to the three named in its first line: a
package imported before `start()` has run is not instrumented.

## Departures from the specification

These are deliberate:

<!-- departures:start -->
- **No endpoint, no export.** The specification sends to `localhost:4318` when no endpoint is set; here nothing is sent, and stderr says so.
- **An invalid sampler stops startup.** An unknown `OTEL_TRACES_SAMPLER`, or a ratio outside 0 to 1, is an error; the specification falls back to the default with a warning.
- **`OTEL_SDK_DISABLED=true` also disables propagators**, so no trace context is read from or added to requests.
- **Logs are opt-in.** They are exported only with `OTEL_LOGS_EXPORTER=otlp`; the specification exports them by default.
- **Only `otlp` and `none` are accepted** in `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER`; any other value, such as `console`, stops startup.
<!-- departures:end -->

## Good to know

- `start()` after `shutdown()` in the same process is refused: telemetry starts once per process.
- Prisma is not in the bundle. Prisma publishes its own instrumentation, `@prisma/instrumentation`; a project that wants Prisma's spans adds it itself.
- `@satoshibits/observability/preset` also exports `forceFlush()`, `shutdown()` and `getStatus()`, which tells you which signals are on and why any is off.

## Testing

`@satoshibits/observability/testing` runs the same pipeline in your tests, with in-memory exporters in
place of the network. Data is collected as emitted, unredacted, unless the test names a policy:

<!-- snippet: test-kit -->
```js
import { trace } from "@opentelemetry/api";
import { startTestTelemetry } from "@satoshibits/observability/testing";

const telemetry = startTestTelemetry();
trace.getTracer("test").startSpan("checkout").end();
const spans = await telemetry.spans();
await telemetry.stop();
```

`telemetry.metrics()` and `telemetry.logRecords()` do the same for the other signals. `startOtlpSink()`
is a local OTLP receiver, for tests that run a whole process.

## The 1.x client (deprecated)

The root entry, `@satoshibits/observability`, is the 1.x client: `SmartClient.initialize()` and its
helpers. It still works, deprecated: `initialize()` now starts the same runtime as the preload, under
the standard policy, or attaches to the one a preload started. What changed for 1.x users, row by
row, is in [COMPATIBILITY.md](COMPATIBILITY.md). The root entry is removed in 3.0.0.
