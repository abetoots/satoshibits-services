/**
 * `@satoshibits/observability/register`
 *
 * A preload for `node --import`: starts the preset from the environment
 * alone (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, …).
 *
 * A configuration error is reported on stderr and the process carries on
 * without telemetry: a mistyped variable must not stop a service from booting.
 */

import { createDiagnostics } from "./preset/diagnostics.mjs";
import { start } from "./preset/runtime.mjs";

try {
  start();
} catch (error) {
  // through diagnostics, so the reason is sanitized like any other text: an
  // error from below the preset can quote a URL
  const diagnostics = createDiagnostics();
  diagnostics.activate();
  diagnostics.report({
    level: "error",
    message: "telemetry was not started",
    fields: { reason: error instanceof Error ? error.message : String(error) },
  });
}
