# @satoshibits/observability

Telemetry for a Node.js service, set up with one command-line flag.

[OpenTelemetry](https://opentelemetry.io) is the open standard for a service's telemetry: **traces**
(the steps of each request, with their timings), **metrics** (counts and measurements over time) and
**logs**. A service sends them over **OTLP**, OpenTelemetry's protocol, to a backend such as Grafana
Cloud or to a collector. This package configures OpenTelemetry's Node.js SDK for you, from the
standard `OTEL_*` environment variables, and redacts what it exports.

<!-- illustrative: installs the packages; the tests run against this repository's build -->
```sh
pnpm add @satoshibits/observability @opentelemetry/api@~1.9.0
```

`@opentelemetry/api` is a peer dependency: your app installs it, so that your app and this package
share one copy, and its version must stay inside this package's peer range (`>=1.9.0 <1.10.0`). To
name a redaction policy of your own, also add `@satoshibits/redaction`.

This package needs Node.js 18.19 or later on the 18 line, or 20.6 or later. Those are the versions
with the `--import` flag.

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
Node bundle (`@opentelemetry/auto-instrumentations-node`) are traced automatically (the noisy `fs`, `net` and `dns` ones are off), and lines written
with pino, winston or bunyan carry the trace id of the request that wrote them. Everything exported
passes the standard redaction policy (below), and one line on stderr says so.

A mistake in the variables (a malformed URL, an unknown sampler) is reported on stderr and the service
starts without telemetry: a typo must not stop a service from booting.

The variables, all from the OpenTelemetry specification:

| Variable | What it does |
|---|---|
| `OTEL_SERVICE_NAME` | the service's name; required |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | where to send every **signal** (kind of telemetry: traces, metrics or logs). `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` set that signal's endpoint, and turn that signal on by themselves. `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` sets the logs endpoint, but logs also need `OTEL_LOGS_EXPORTER=otlp`. A signal with no endpoint is not exported |
| `OTEL_EXPORTER_OTLP_HEADERS` | headers for every request, such as `Authorization=Basic …` for Grafana Cloud |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (the default) or `http/json`; `grpc` is not supported |
| `OTEL_LOGS_EXPORTER` | `otlp` to export logs; they are off otherwise, because application logs are the signal most likely to carry personal data |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` | `none` turns that signal off |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | which traces to keep, e.g. `parentbased_traceidratio` and `0.1` for a tenth |
| `OTEL_RESOURCE_ATTRIBUTES` | facts about the process, e.g. `deployment.environment.name=production,service.version=1.4.0` |
| `OTEL_METRIC_EXPORT_INTERVAL` | how often metrics are sent, in milliseconds (default 60000) |
| `OTEL_LOG_LEVEL` | how much the package itself reports on stderr (default `warn`) |
| `OTEL_SDK_DISABLED` | `true` turns everything off |

### Variables in `.env` files

A preload runs before your application's code, and it reads `process.env` directly. Variables your
application loads from a `.env` file itself (with dotenv, say) are read too late. Set them on the
command line, or have Node read the file first (`--env-file` needs Node.js 20.6 or later):

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
- drops the caller's IP address;
- on a span (one step of a trace), drops its status message and an error's message and stack trace;
  a log record keeps them, masked like any text.

Metrics are not redacted. Their labels (attributes, such as `route` or `status`) are a small set of values your code chooses, and masking one would lump separate series of counts together.
So never put user data in a metric attribute.

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

`redaction: false` exports everything as given. If anything is set to be exported and you pass no
`redaction`, `start()` throws, so nothing goes out unredacted by accident. Import nothing else in this
file: OpenTelemetry can only trace a library that loads after `start()` has run.

## Departures from the specification

These are deliberate:

<!-- departures:start -->
- **No endpoint, no export.** The specification sends to `localhost:4318` when no endpoint is set; here nothing is sent, and stderr says so.
- **An invalid sampler stops telemetry from starting.** An unknown `OTEL_TRACES_SAMPLER`, or a ratio outside 0 to 1, is an error; the specification falls back to the default with a warning.
- **`OTEL_SDK_DISABLED=true` also disables propagators.** Propagators read and write the request headers (such as `traceparent`) that connect one service's part of a trace to the next service's; with them off, a request is neither joined to the caller's trace nor passed on to the next service.
- **Logs are opt-in.** They are exported only with `OTEL_LOGS_EXPORTER=otlp`; the specification exports them by default. Application logs are the signal most likely to carry personal data, so sending them is always a stated choice.
- **Only `otlp` and `none` are accepted** in `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER`; any other value, such as `console`, stops telemetry from starting.
<!-- departures:end -->

## Good to know

- `start()` after `shutdown()` in the same process is refused: telemetry starts once per process.
- Prisma is not in the bundle. Prisma publishes its own instrumentation, `@prisma/instrumentation`; a project that wants Prisma's spans adds it itself.
- `@satoshibits/observability/preset` also exports `forceFlush()`, `shutdown()` and `getStatus()`, which tells you which signals are on and why any is off.

## Testing

`@satoshibits/observability/testing` runs the same pipeline in your tests, and sends telemetry to
memory instead of the network. Nothing is redacted unless you pass a `redaction` policy:

<!-- snippet: test-kit -->
```js
import { trace } from "@opentelemetry/api";
import { startTestTelemetry } from "@satoshibits/observability/testing";

const telemetry = startTestTelemetry();
trace.getTracer("test").startSpan("checkout").end();
const spans = await telemetry.spans();
await telemetry.stop();
```

`telemetry.metrics()` and `telemetry.logRecords()` do the same for the other signals. `startOtlpSink()`,
also from `@satoshibits/observability/testing`, is a local OTLP receiver, for tests that run a whole
process.

## The 1.x client (deprecated)

The root entry, `@satoshibits/observability`, is the 1.x client: `SmartClient.initialize()` and its
helpers. It still works, deprecated: `initialize()` now starts the same runtime as the preload, under
the standard policy, or attaches to the one a preload started. What changed for 1.x users, row by
row, is in [COMPATIBILITY.md](COMPATIBILITY.md). The root entry is removed in 3.0.0.
