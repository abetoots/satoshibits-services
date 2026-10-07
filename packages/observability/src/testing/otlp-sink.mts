/**
 * A local OTLP/HTTP receiver for tests.
 *
 * It records what actually arrived on the wire: every connection attempt,
 * and for every request its path, headers, content type and decoded body. A
 * test asserts on that, never on a configuration object.
 *
 * It can bind several loopback addresses on one port (to catch a leak to the
 * specification's default `localhost:4318` on either address family) and can
 * be told to answer with an error or not at all.
 */

import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";

import type {
  DecodedExport,
  OtlpEncoding,
  SinkLogRecord,
  SinkMetric,
  SinkSpan,
} from "./otlp-decode.mjs";
import type { IncomingHttpHeaders, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { decodeOtlpRequest, encodingOf } from "./otlp-decode.mjs";

export interface SinkConnection {
  /** the address the client connected to, e.g. `127.0.0.1` or `::1` */
  localAddress: string | undefined;
  remoteAddress: string | undefined;
}

export interface SinkRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  contentType: string | undefined;
  encoding: OtlpEncoding;
  /** the body after gzip decoding, when the request was gzip encoded */
  body: Buffer;
  /**
   * The body as text (latin1, so every byte survives). Strings inside a
   * protobuf body are stored verbatim, so searching this for an ASCII
   * sentinel proves the sentinel is nowhere in the request.
   */
  bodyText: string;
  decoded: DecodedExport;
}

export interface SinkResponse {
  /** HTTP status to answer with (default 200) */
  status?: number;
  /** never answer; the request stays open until the sink closes */
  hang?: boolean;
  /** wait this long before answering */
  delayMs?: number;
}

export interface StartOtlpSinkOptions {
  /** port to bind (default: an ephemeral port) */
  port?: number;
  /** loopback addresses to bind, all on the same port (default `["127.0.0.1"]`) */
  hosts?: string[];
}

export interface OtlpSink {
  port: number;
  /** base URL on the first bound host */
  url: string;
  connections: SinkConnection[];
  requests: SinkRequest[];
  /**
   * Requests whose body could not be decoded. They are answered with 400, and
   * `spans()`, `metrics()` and `logRecords()` throw while any exist, so a
   * test cannot pass on bytes nobody could read.
   */
  undecodable: { path: string; contentType: string | undefined; error: string }[];
  /** requests whose path ends with the given suffix, e.g. `/v1/traces` */
  requestsTo: (pathSuffix: string) => SinkRequest[];
  spans: () => SinkSpan[];
  metrics: () => SinkMetric[];
  logRecords: () => SinkLogRecord[];
  /** set how later requests are answered */
  respondWith: (
    response: SinkResponse | ((request: SinkRequest) => SinkResponse),
  ) => void;
  /**
   * Resolve as soon as `condition` holds (checked on every arrival); reject
   * after `timeoutMs` with a summary of what did arrive.
   */
  waitFor: (condition: () => boolean, timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
}

const hostForUrl = (host: string): string =>
  host.includes(":") ? `[${host}]` : host;

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Start a sink. Rejects when an address cannot be bound: a test that needs
 * the address must fail, not skip.
 */
export async function startOtlpSink(
  options: StartOtlpSinkOptions = {},
): Promise<OtlpSink> {
  const hosts = options.hosts ?? ["127.0.0.1"];
  const connections: SinkConnection[] = [];
  const requests: SinkRequest[] = [];
  const undecodable: OtlpSink["undecodable"] = [];
  const waiters = new Set<() => void>();
  const openResponses = new Set<ServerResponse>();
  let respond: (request: SinkRequest) => SinkResponse = () => ({});

  const notify = () => {
    for (const waiter of [...waiters]) waiter();
  };

  const makeServer = (): Server => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        const body =
          req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
        const path = req.url ?? "";
        const contentType = req.headers["content-type"];
        let decoded: DecodedExport;
        try {
          decoded = decodeOtlpRequest(path, contentType, body);
        } catch (error) {
          undecodable.push({ path, contentType, error: String(error) });
          res.writeHead(400).end();
          notify();
          return;
        }
        const request: SinkRequest = {
          method: req.method ?? "",
          path,
          headers: req.headers,
          contentType,
          encoding: encodingOf(contentType),
          body,
          bodyText: body.toString("latin1"),
          decoded,
        };
        requests.push(request);
        const { status = 200, hang = false, delayMs = 0 } = respond(request);
        if (hang) {
          openResponses.add(res);
        } else {
          const answer = () => {
            // an empty body is a valid, empty Export*ServiceResponse in both encodings
            res.writeHead(status, {
              "content-type": contentType ?? "application/x-protobuf",
            });
            res.end(request.encoding === "json" ? "{}" : undefined);
          };
          if (delayMs > 0) setTimeout(answer, delayMs).unref();
          else answer();
        }
        notify();
      });
    });
    server.on("connection", (socket) => {
      connections.push({
        localAddress: socket.localAddress,
        remoteAddress: socket.remoteAddress,
      });
      notify();
    });
    return server;
  };

  const servers: Server[] = [];
  let port = options.port ?? 0;
  try {
    for (const host of hosts) {
      const server = makeServer();
      servers.push(server);
      port = await listen(server, port, host);
    }
  } catch (error) {
    for (const server of servers) server.close();
    throw new Error(
      `OTLP sink could not bind ${hosts.join(", ")} on port ${port}: ${String(error)}`,
      { cause: error },
    );
  }

  const decoded = (): DecodedExport[] => {
    if (undecodable.length > 0) {
      throw new Error(
        `OTLP sink received ${undecodable.length} request(s) it could not decode: ` +
          JSON.stringify(undecodable),
      );
    }
    return requests.map((r) => r.decoded);
  };

  return {
    port,
    url: `http://${hostForUrl(hosts[0]!)}:${port}`,
    connections,
    requests,
    undecodable,
    requestsTo: (suffix) => requests.filter((r) => r.path.endsWith(suffix)),
    spans: () => decoded().flatMap((d) => d.spans),
    metrics: () => decoded().flatMap((d) => d.metrics),
    logRecords: () => decoded().flatMap((d) => d.logRecords),
    respondWith: (response) => {
      respond = typeof response === "function" ? response : () => response;
    },
    waitFor: (condition, timeoutMs = 5000) =>
      new Promise<void>((resolve, reject) => {
        if (condition()) {
          resolve();
          return;
        }
        const check = () => {
          if (!condition()) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve();
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(
            new Error(
              `OTLP sink: condition not met within ${timeoutMs} ms; ` +
                `${connections.length} connection(s), requests: ` +
                (requests.map((r) => r.path).join(", ") || "none"),
            ),
          );
        }, timeoutMs);
        waiters.add(check);
      }),
    close: async () => {
      for (const res of openResponses) res.destroy();
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.closeAllConnections();
              server.close((err) => (err ? reject(err) : resolve()));
            }),
        ),
      );
    },
  };
}
