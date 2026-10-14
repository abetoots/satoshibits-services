/**
 * What the standard redaction policy costs on a full batch: 512 finished
 * spans shaped like HTTP server spans, run through the span exporter wrapper
 * the preset puts in front of every exporter (the policy, and the views it
 * hands the exporter), with an inner exporter that keeps what it is given.
 * The SDK's batching is not in it: the batch is handed to the wrapper whole,
 * as the batch processor hands one over.
 *
 * It fails only on a generous regression: the threshold is ten times what was
 * measured on the development machine, and never under 500 ms.
 */
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { standardPolicy } from "@satoshibits/redaction";
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";

import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

import { createDiagnostics } from "../../preset/diagnostics.mjs";
import { wrapSpanExporter } from "../../preset/exporters.mjs";
import { createRedactor } from "../../preset/redaction.mjs";

/** the batch processor's default `maxExportBatchSize` */
const BATCH = 512;
/** every this many spans, one failed with an exception event */
const FAILED_EVERY = 32;
const RUNS = 5;
// best of 5 measured on the development machine (WSL2, Node 24, the runner's): 6.7 to 6.8 ms for the batch.
// ten times that is under the floor, so the floor is the threshold
const THRESHOLD_MILLIS = 500;

/** finished spans as the HTTP and Express instrumentations leave them, about 18 attributes each */
function finishedSpans(): ReadableSpan[] {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(memory)],
  });
  const tracer = provider.getTracer(
    "@opentelemetry/instrumentation-http",
    "0.223.0",
  );
  for (let index = 0; index < BATCH; index++) {
    const failed = index % FAILED_EVERY === 0;
    const span = tracer.startSpan("GET /api/accounts/:accountId/orders", {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": "GET",
        "url.scheme": "https",
        "url.full": `https://shop.example.com/api/accounts/${index}/orders?page=2&session=s${index}x9f2&email=user${index}@example.com`,
        "url.path": `/api/accounts/${index}/orders`,
        "url.query": `page=2&session=s${index}x9f2&email=user${index}@example.com`,
        "http.route": "/api/accounts/:accountId/orders",
        "http.response.status_code": failed ? 500 : 200,
        "user_agent.original":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        "client.address": `203.0.113.${index % 250}`,
        "client.port": 50_000 + index,
        "server.address": "shop.example.com",
        "server.port": 443,
        "network.peer.address": `10.0.${index % 250}.7`,
        "network.peer.port": 50_000 + index,
        "network.protocol.version": "1.1",
        "app.account_id": `acct-${index}`,
        "app.request_id": `req-${index}-7d1c9a3e`,
        "app.note": `order lookup for user${index}@example.com`,
      },
    });
    if (failed) {
      const error = new Error(
        `order lookup failed for user${index}@example.com`,
      );
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }
    span.end();
  }
  return memory.getFinishedSpans();
}

/** whether an exported span shows a value the standard policy removes from these spans */
function unredacted(span: ReadableSpan): boolean {
  const { attributes } = span;
  if ("client.address" in attributes || "network.peer.address" in attributes)
    return true;
  if ("url.query" in attributes) return true;
  if (String(attributes["url.full"]).includes("?")) return true;
  if (
    Object.values(attributes).some((value) =>
      String(value).includes("@example.com"),
    )
  ) {
    return true;
  }
  if (span.status.message !== undefined) return true;
  return span.events.some(
    (event) =>
      event.attributes !== undefined && "exception.message" in event.attributes,
  );
}

describe("the standard redaction policy on a full batch", () => {
  it(`redacts ${BATCH} HTTP server spans through the exporter wrapper within ${THRESHOLD_MILLIS} ms (best of ${RUNS})`, async ({
    annotate,
  }) => {
    const spans = finishedSpans();
    expect(spans).toHaveLength(BATCH);

    let exported: ReadableSpan[] = [];
    const inner: SpanExporter = {
      export: (batch, callback) => {
        exported = batch;
        callback({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
    };
    const wrapper = wrapSpanExporter(inner, {
      diagnostics: createDiagnostics(),
      redactor: createRedactor(standardPolicy),
    });

    let best = Number.POSITIVE_INFINITY;
    // a run that failed fast inside the wrapper, or skipped the policy for some spans,
    // would read as a low time: each run must answer success with the whole batch, every
    // span of it redacted, and none may read an earlier run's batch. The check runs after
    // the timed region, on what that run exported
    const runs: {
      code: ExportResultCode | undefined;
      exported: number;
      unredacted: number;
    }[] = [];
    for (let run = 0; run < RUNS; run++) {
      exported = [];
      let code: ExportResultCode | undefined;
      const started = performance.now();
      wrapper.export(spans, (result) => (code = result.code));
      best = Math.min(best, performance.now() - started);
      runs.push({
        code,
        exported: exported.length,
        unredacted: exported.filter(unredacted).length,
      });
    }
    expect(runs).toEqual(
      Array.from({ length: RUNS }, () => ({
        code: ExportResultCode.SUCCESS,
        exported: BATCH,
        unredacted: 0,
      })),
    );

    // the time is of the policy actually applied, to every span of the batch
    const last = exported[BATCH - 1]!;
    expect(last.attributes["url.full"]).toBe(
      `https://shop.example.com/api/accounts/${BATCH - 1}/orders`,
    );
    expect(last.attributes).not.toHaveProperty("client.address");
    expect(exported[0]!.events[0]!.attributes).toEqual({
      "exception.type": "Error",
    });
    // on every run, passing or not: `--reporter=verbose` prints it under the test's name
    await annotate(`best of ${RUNS}: ${best.toFixed(1)} ms for ${BATCH} spans`);
    expect(
      best,
      `the standard policy took ${best.toFixed(1)} ms for ${BATCH} spans (best of ${RUNS})`,
    ).toBeLessThan(THRESHOLD_MILLIS);
  });
});
