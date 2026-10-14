/**
 * `@satoshibits/observability/register`
 *
 * A preload for `node --import`: starts the preset from the environment
 * alone (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, …).
 *
 * It configures every exporter with the standard policy of
 * `@satoshibits/redaction`, and says so in one line on stderr when it has
 * configured at least one (unless `OTEL_LOG_LEVEL` asks for errors only, or
 * for nothing). The line is written at start, before anything is exported,
 * and whether or not the application goes on to emit anything. To export
 * under a policy of your own, or with none, use a preload of your own that
 * calls `start({ redaction })`.
 *
 * A configuration error is reported on stderr and the process carries on
 * without telemetry: a mistyped variable must not stop a service from booting.
 */

import { DiagLogLevel } from "@opentelemetry/api";
import { standardPolicy } from "@satoshibits/redaction";
import { types } from "node:util";

import { PresetConfigError } from "./preset/config.mjs";
import { createDiagnostics } from "./preset/diagnostics.mjs";
import { start } from "./preset/runtime.mjs";

try {
  const status = start({ redaction: standardPolicy });
  try {
    // the diagnostics module resolves the level the environment asks for (warning when
    // unset or unknown); an operator who asked for errors only, or nothing, is not told
    const wanted =
      createDiagnostics({ logLevel: process.env.OTEL_LOG_LEVEL }).diagLevel >= DiagLogLevel.WARN;
    if (wanted && Object.values(status.signals).some((signal) => signal.enabled)) {
      // an instance of its own, at the level of this line: the preset's default drops
      // informational lines, and the choice of policy was made here, not by the operator
      const diagnostics = createDiagnostics({ logLevel: "info" });
      diagnostics.activate();
      diagnostics.report({
        level: "info",
        message: "telemetry exporters are configured with the standard redaction policy",
        fields: { policy: "@satoshibits/redaction standardPolicy" },
      });
    }
  } catch {
    // telemetry is running; a line that cannot be written must not look like a failed start
  }
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
