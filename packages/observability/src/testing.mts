/**
 * Testing Utilities for @satoshibits/observability
 *
 * This module exports test utilities for use in applications that depend
 * on @satoshibits/observability. Import from '@satoshibits/observability/testing'
 * to access mock clients and testing helpers.
 *
 * @example
 * ```typescript
 * import { createMockClient } from '@satoshibits/observability/testing';
 *
 * const mockClient = createMockClient();
 * // use mockClient in tests
 * ```
 *
 * @packageDocumentation
 */

export {
  MockObservabilityClient,
  createMockClient,
  withMockClient,
} from "./__tests__/test-utils/mock-client.mjs";

export type {
  RecordedMetric,
  RecordedSpan,
  RecordedLog,
  RecordedError,
  RecordedBreadcrumb,
  RecordedTag,
} from "./__tests__/test-utils/mock-client.mjs";

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
