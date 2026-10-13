/**
 * `@satoshibits/observability/preset`
 *
 * OpenTelemetry for a Node service in one call. Load a module that calls
 * `start()` with `node --import`, before the application:
 *
 * ```js
 * // telemetry.mjs — import nothing here but the preset and Node built-ins
 * import { start } from "@satoshibits/observability/preset";
 * try {
 *   // `redaction` is a policy of yours, or `false` to export everything as given;
 *   // with a signal to export and no `redaction`, start() throws
 *   start({ serviceName: "billing-worker", redaction: myPolicy });
 * } catch (error) {
 *   console.error(error); // run without telemetry rather than not at all
 * }
 * ```
 *
 * A project that needs no values set in code can skip the file and use
 * `node --import @satoshibits/observability/register`.
 */

export { forceFlush, getStatus, shutdown, start } from "./preset/runtime.mjs";
export { PresetConfigError } from "./preset/config.mjs";

export type {
  PresetStatus,
  SignalStatus,
  StartOptions,
  TestExporters,
} from "./preset/runtime.mjs";
export type {
  OtlpProtocol,
  SamplerOption,
  SamplerType,
  Signal,
  SignalOffReason,
} from "./preset/config.mjs";
export type {
  DiagnosticsEvent,
  DiagnosticsLevel,
  DiagnosticsSink,
} from "./preset/diagnostics.mjs";
export type {
  AttributesSurface,
  PolicyAttributes,
  PolicyLogRecord,
  PolicySpanEvent,
  RedactionOption,
  RedactionPolicy,
  TextSurface,
} from "./preset/redaction.mjs";
