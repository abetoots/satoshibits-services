/**
 * Decoding of OTLP export requests, for the test sink.
 *
 * Reads the protobuf encoding with a small schema-driven reader and the JSON
 * encoding with `JSON.parse`, and reduces both to one plain view (spans,
 * metrics, log records) so a test asserts on what a backend would receive,
 * whatever the wire encoding.
 *
 * Field numbers follow opentelemetry-proto v1 (trace, metrics, logs, common,
 * resource). Unknown fields are skipped, never an error.
 */

type Scalar =
  | "string"
  | "bytes"
  | "base64"
  | "varint"
  | "bool"
  | "fixed64"
  | "sfixed64"
  | "double"
  | "fixed32";

interface Field {
  name: string;
  type: Scalar | { message: string };
  repeated?: boolean;
}

type Schema = Record<number, Field>;

const f = (name: string, type: Field["type"], repeated = false): Field => ({
  name,
  type,
  repeated,
});
const m = (message: string) => ({ message });

const SCHEMAS: Record<string, Schema> = {
  TraceRequest: { 1: f("resourceSpans", m("ResourceSpans"), true) },
  ResourceSpans: {
    1: f("resource", m("Resource")),
    2: f("scopeSpans", m("ScopeSpans"), true),
  },
  ScopeSpans: {
    1: f("scope", m("Scope")),
    2: f("spans", m("Span"), true),
  },
  Span: {
    1: f("traceId", "bytes"),
    2: f("spanId", "bytes"),
    3: f("traceState", "string"),
    4: f("parentSpanId", "bytes"),
    5: f("name", "string"),
    6: f("kind", "varint"),
    9: f("attributes", m("KeyValue"), true),
    11: f("events", m("Event"), true),
    13: f("links", m("Link"), true),
    15: f("status", m("Status")),
  },
  Event: {
    2: f("name", "string"),
    3: f("attributes", m("KeyValue"), true),
  },
  Link: {
    1: f("traceId", "bytes"),
    2: f("spanId", "bytes"),
    4: f("attributes", m("KeyValue"), true),
  },
  Status: { 2: f("message", "string"), 3: f("code", "varint") },

  MetricsRequest: { 1: f("resourceMetrics", m("ResourceMetrics"), true) },
  ResourceMetrics: {
    1: f("resource", m("Resource")),
    2: f("scopeMetrics", m("ScopeMetrics"), true),
  },
  ScopeMetrics: {
    1: f("scope", m("Scope")),
    2: f("metrics", m("Metric"), true),
  },
  Metric: {
    1: f("name", "string"),
    2: f("description", "string"),
    3: f("unit", "string"),
    5: f("gauge", m("NumberPoints")),
    7: f("sum", m("NumberPoints")),
    9: f("histogram", m("HistogramPoints")),
  },
  NumberPoints: { 1: f("dataPoints", m("NumberDataPoint"), true) },
  HistogramPoints: { 1: f("dataPoints", m("HistogramDataPoint"), true) },
  NumberDataPoint: {
    4: f("asDouble", "double"),
    6: f("asInt", "sfixed64"),
    7: f("attributes", m("KeyValue"), true),
  },
  HistogramDataPoint: {
    4: f("count", "fixed64"),
    5: f("sum", "double"),
    9: f("attributes", m("KeyValue"), true),
  },

  LogsRequest: { 1: f("resourceLogs", m("ResourceLogs"), true) },
  ResourceLogs: {
    1: f("resource", m("Resource")),
    2: f("scopeLogs", m("ScopeLogs"), true),
  },
  ScopeLogs: {
    1: f("scope", m("Scope")),
    2: f("logRecords", m("LogRecord"), true),
  },
  LogRecord: {
    2: f("severityNumber", "varint"),
    3: f("severityText", "string"),
    5: f("body", m("AnyValue")),
    6: f("attributes", m("KeyValue"), true),
    9: f("traceId", "bytes"),
    10: f("spanId", "bytes"),
    12: f("eventName", "string"),
  },

  Resource: { 1: f("attributes", m("KeyValue"), true) },
  Scope: {
    1: f("name", "string"),
    2: f("version", "string"),
    3: f("attributes", m("KeyValue"), true),
  },
  KeyValue: { 1: f("key", "string"), 2: f("value", m("AnyValue")) },
  AnyValue: {
    1: f("stringValue", "string"),
    2: f("boolValue", "bool"),
    3: f("intValue", "varint"),
    4: f("doubleValue", "double"),
    5: f("arrayValue", m("ArrayValue")),
    6: f("kvlistValue", m("KeyValueList")),
    7: f("bytesValue", "base64"),
  },
  ArrayValue: { 1: f("values", m("AnyValue"), true) },
  KeyValueList: { 1: f("values", m("KeyValue"), true) },
};

type Json = Record<string, unknown>;

function readVarint(buf: Buffer, at: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let pos = at;
  for (;;) {
    const byte = buf[pos++];
    if (byte === undefined) throw new Error("truncated varint");
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

/** the protobuf wire type each declared scalar type must arrive with */
const WIRE_TYPE: Record<Scalar, number> = {
  varint: 0,
  bool: 0,
  fixed64: 1,
  sfixed64: 1,
  double: 1,
  string: 2,
  bytes: 2,
  base64: 2,
  fixed32: 5,
};

function scalar(type: Scalar, raw: Buffer | bigint, wireType: number): unknown {
  // a field arriving with the wrong wire type means the schema here, or the sender, is wrong
  if (WIRE_TYPE[type] !== wireType) {
    throw new Error(`field of type ${type} arrived with wire type ${wireType}`);
  }
  if (typeof raw === "bigint") {
    if (type === "bool") return raw === 1n;
    // int64 values arrive as unsigned varints; fold back to signed
    const signed = BigInt.asIntN(64, raw);
    return Number(signed);
  }
  switch (type) {
    case "string":
      return raw.toString("utf8");
    case "bytes":
      return raw.toString("hex");
    case "base64":
      // the spelling the JSON encoding uses for an AnyValue's bytes
      return raw.toString("base64");
    case "double":
      return raw.readDoubleLE(0);
    case "fixed64":
      return Number(raw.readBigUInt64LE(0));
    case "sfixed64":
      return Number(raw.readBigInt64LE(0));
    case "fixed32":
      return raw.readUInt32LE(0);
    default:
      throw new Error(`wire type does not fit declared type ${type}`);
  }
}

function decodeMessage(buf: Buffer, schemaName: string): Json {
  const schema = SCHEMAS[schemaName];
  if (!schema) throw new Error(`no schema for ${schemaName}`);
  const out: Json = {};
  let pos = 0;
  while (pos < buf.length) {
    let tag: bigint;
    [tag, pos] = readVarint(buf, pos);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    let raw: Buffer | bigint;
    if (wireType === 0) {
      [raw, pos] = readVarint(buf, pos);
    } else if (wireType === 1) {
      raw = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wireType === 2) {
      let length: bigint;
      [length, pos] = readVarint(buf, pos);
      raw = buf.subarray(pos, pos + Number(length));
      pos += Number(length);
    } else if (wireType === 5) {
      raw = buf.subarray(pos, pos + 4);
      pos += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wireType}`);
    }
    if (pos > buf.length) throw new Error("protobuf message overran its buffer");

    const field = schema[fieldNumber];
    if (!field) continue;
    let value: unknown;
    if (typeof field.type === "string") {
      value = scalar(field.type, raw, wireType);
    } else {
      if (wireType !== 2) {
        throw new Error(`field ${field.name} is a message but has wire type ${wireType}`);
      }
      value = decodeMessage(raw as Buffer, field.type.message);
    }
    if (field.repeated) {
      ((out[field.name] ??= []) as unknown[]).push(value);
    } else {
      out[field.name] = value;
    }
  }
  return out;
}

// ===== the plain view =====

export interface SinkScope {
  name: string;
  version?: string;
  attributes: Record<string, unknown>;
}

interface Origin {
  resource: Record<string, unknown>;
  scope: SinkScope;
}

export interface SinkSpan extends Origin {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  kind?: number;
  attributes: Record<string, unknown>;
  events: { name: string; attributes: Record<string, unknown> }[];
  links: { traceId: string; attributes: Record<string, unknown> }[];
  status: { code?: number; message?: string };
}

export interface SinkMetric extends Origin {
  name: string;
  unit?: string;
  type: "gauge" | "sum" | "histogram" | "other";
  points: { attributes: Record<string, unknown>; value: number }[];
}

export interface SinkLogRecord extends Origin {
  body: unknown;
  severityText?: string;
  eventName?: string;
  traceId?: string;
  spanId?: string;
  attributes: Record<string, unknown>;
}

export interface DecodedExport {
  spans: SinkSpan[];
  metrics: SinkMetric[];
  logRecords: SinkLogRecord[];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const list = (value: unknown): Json[] =>
  Array.isArray(value) ? (value as Json[]) : [];

function plainValue(anyValue: unknown): unknown {
  if (anyValue === null || typeof anyValue !== "object") return undefined;
  const v = anyValue as Json;
  if ("stringValue" in v) return v.stringValue;
  if ("boolValue" in v) return v.boolValue;
  // the JSON encoding writes 64-bit integers as strings
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("bytesValue" in v) {
    return Buffer.from(String(v.bytesValue), "base64").toString("hex");
  }
  if ("arrayValue" in v) {
    return list((v.arrayValue as Json | undefined)?.values).map(plainValue);
  }
  if ("kvlistValue" in v) {
    return plainAttributes((v.kvlistValue as Json | undefined)?.values);
  }
  return undefined;
}

function plainAttributes(keyValues: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of list(keyValues)) {
    out[String(kv.key)] = plainValue(kv.value);
  }
  return out;
}

function origin(resourceBlock: Json, scopeBlock: Json): Origin {
  const scope = (scopeBlock.scope ?? {}) as Json;
  return {
    resource: plainAttributes((resourceBlock.resource as Json | undefined)?.attributes),
    scope: {
      name: text(scope.name),
      version: scope.version as string | undefined,
      attributes: plainAttributes(scope.attributes),
    },
  };
}

const optionalId = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function numberPoint(point: Json): number {
  if (point.asDouble !== undefined) return Number(point.asDouble);
  if (point.asInt !== undefined) return Number(point.asInt);
  return Number.NaN;
}

function simplify(request: Json): DecodedExport {
  const result: DecodedExport = { spans: [], metrics: [], logRecords: [] };

  for (const block of list(request.resourceSpans)) {
    for (const scopeBlock of list(block.scopeSpans)) {
      for (const span of list(scopeBlock.spans)) {
        const status = (span.status ?? {}) as Json;
        result.spans.push({
          ...origin(block, scopeBlock),
          name: text(span.name),
          traceId: text(span.traceId),
          spanId: text(span.spanId),
          parentSpanId: optionalId(span.parentSpanId),
          kind: span.kind as number | undefined,
          attributes: plainAttributes(span.attributes),
          events: list(span.events).map((event) => ({
            name: text(event.name),
            attributes: plainAttributes(event.attributes),
          })),
          links: list(span.links).map((link) => ({
            traceId: text(link.traceId),
            attributes: plainAttributes(link.attributes),
          })),
          status: {
            code: status.code as number | undefined,
            message: status.message as string | undefined,
          },
        });
      }
    }
  }

  for (const block of list(request.resourceMetrics)) {
    for (const scopeBlock of list(block.scopeMetrics)) {
      for (const metric of list(scopeBlock.metrics)) {
        const numeric = (metric.gauge ?? metric.sum) as Json | undefined;
        const histogram = metric.histogram as Json | undefined;
        result.metrics.push({
          ...origin(block, scopeBlock),
          name: text(metric.name),
          unit: metric.unit as string | undefined,
          type: metric.gauge
            ? "gauge"
            : metric.sum
              ? "sum"
              : histogram
                ? "histogram"
                : "other",
          points: numeric
            ? list(numeric.dataPoints).map((point) => ({
                attributes: plainAttributes(point.attributes),
                value: numberPoint(point),
              }))
            : list(histogram?.dataPoints).map((point) => ({
                attributes: plainAttributes(point.attributes),
                value: Number(point.sum ?? Number.NaN),
              })),
        });
      }
    }
  }

  for (const block of list(request.resourceLogs)) {
    for (const scopeBlock of list(block.scopeLogs)) {
      for (const record of list(scopeBlock.logRecords)) {
        result.logRecords.push({
          ...origin(block, scopeBlock),
          body: plainValue(record.body),
          severityText: record.severityText as string | undefined,
          eventName: optionalId(record.eventName),
          traceId: optionalId(record.traceId),
          spanId: optionalId(record.spanId),
          attributes: plainAttributes(record.attributes),
        });
      }
    }
  }

  return result;
}

const ROOT_SCHEMA: Record<string, string> = {
  "/v1/traces": "TraceRequest",
  "/v1/metrics": "MetricsRequest",
  "/v1/logs": "LogsRequest",
};

export type OtlpEncoding = "protobuf" | "json" | "unknown";

export function encodingOf(contentType: string | undefined): OtlpEncoding {
  if (contentType?.startsWith("application/x-protobuf")) return "protobuf";
  if (contentType?.startsWith("application/json")) return "json";
  return "unknown";
}

/**
 * Decode one export request body. `path` selects the message type by its
 * suffix, so a signal-specific endpoint with a path prefix still decodes.
 * Throws when the body does not parse as the declared encoding: a test must
 * not pass on bytes nobody could read.
 */
export function decodeOtlpRequest(
  path: string,
  contentType: string | undefined,
  body: Buffer,
): DecodedExport {
  const pathname = path.split("?")[0]!;
  const suffix = Object.keys(ROOT_SCHEMA).find((p) => pathname.endsWith(p));
  if (!suffix) {
    throw new Error(`not an OTLP signal path: ${pathname}`);
  }
  const encoding = encodingOf(contentType);
  if (encoding === "json") {
    return simplify(JSON.parse(body.toString("utf8")) as Json);
  }
  if (encoding === "protobuf") {
    return simplify(decodeMessage(body, ROOT_SCHEMA[suffix]!));
  }
  throw new Error(`cannot decode OTLP body with content type ${contentType}`);
}
