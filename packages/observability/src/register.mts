/**
 * `@satoshibits/observability/register`
 *
 * A preload for `node --import`: starts the preset from the environment
 * alone (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, …).
 *
 * It names no redaction policy yet, and the preset exports nothing without
 * one: with an endpoint configured this entry reports "no redaction policy"
 * and sends nothing. It will pass the redaction package's standard policy
 * once that package exists; until then, export from a preload of your own
 * that calls `start({ redaction })`.
 *
 * A configuration error is reported on stderr and the process carries on
 * without telemetry: a mistyped variable must not stop a service from booting.
 */

import { types } from "node:util";

import { PresetConfigError } from "./preset/config.mjs";
import { createDiagnostics } from "./preset/diagnostics.mjs";
import { start } from "./preset/runtime.mjs";

try {
  start();
} catch (error) {
  try {
    // through diagnostics, so the reason is sanitized like any other text: an
    // error from below the preset can quote a URL
    const diagnostics = createDiagnostics();
    diagnostics.activate();
    // a configuration error lists every problem; each gets a line of its own, so none is cut off
    const reasons =
      error instanceof PresetConfigError
        ? [...new Set(error.problems)]
        : [types.isNativeError(error) ? error.message : "start() threw a value that is not an error"];
    for (const reason of reasons) {
      diagnostics.report({
        level: "error",
        message: "telemetry was not started",
        fields: { reason },
      });
    }
  } catch {
    // an error that cannot even be read; the process still carries on
    try {
      process.stderr.write(
        '{"level":"error","source":"opentelemetry","msg":"telemetry was not started"}\n',
      );
    } catch {
      // nothing left to say it with
    }
  }
}
