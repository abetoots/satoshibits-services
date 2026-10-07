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
 *   start({ serviceName: "billing-worker" });
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
export type { RedactionOptions } from "./preset/redaction.mjs";
