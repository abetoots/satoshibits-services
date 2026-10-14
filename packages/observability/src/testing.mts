/**
 * Testing utilities for @satoshibits/observability.
 *
 * The test kit runs the preset's real pipeline with in-memory exporters, and
 * an OTLP sink receives what a process sends over the network.
 *
 * @example
 * ```typescript
 * import { startTestTelemetry } from '@satoshibits/observability/testing';
 *
 * const telemetry = startTestTelemetry();
 * // ... code under test ...
 * const spans = await telemetry.spans();
 * await telemetry.stop();
 * ```
 *
 * @packageDocumentation
 */

// ===== the real-pipeline test kit (2.0) =====

export { startTestTelemetry } from "./testing/in-memory.mjs";
export type { TestMetricPoint, TestTelemetry } from "./testing/in-memory.mjs";

export { startOtlpSink } from "./testing/otlp-sink.mjs";
export type {
  OtlpSink,
  SinkConnection,
  SinkRequest,
  SinkResponse,
  StartOtlpSinkOptions,
} from "./testing/otlp-sink.mjs";
export type {
  DecodedExport,
  OtlpEncoding,
  SinkLogRecord,
  SinkMetric,
  SinkScope,
  SinkSpan,
} from "./testing/otlp-decode.mjs";
