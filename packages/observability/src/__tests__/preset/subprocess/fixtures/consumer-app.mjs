/**
 * An application as a consumer writes it: plain ESM that imports Express,
 * pino, winston, bunyan and `node:http` statically, and knows nothing of
 * OpenTelemetry. Run it as
 *
 *   node --import @satoshibits/observability/register consumer-app.mjs
 *
 * from the package directory, so the package resolves by its own name
 * through its `exports` map (self-reference), which means the built `dist/`.
 *
 * It serves one route, requests it once from itself, logs one line with each
 * logger inside the route handler, shuts the preset down and prints one
 * `RESULT {json}` line. Everything the loggers wrote goes to stdout as one
 * JSON line each.
 *
 * `OBS_FIXTURE_DNS_LOOKUP=1` also resolves `localhost` by name once, for
 * the dns instrumentation's partial-override case.
 *
 * `OBS_FIXTURE_EARLY_LOGGER=1` also logs a line with the logger that
 * fixtures/early-logger.mjs created before start() (a preload of the test's
 * own imports that module first).
 *
 * `OBS_FIXTURE_SENSITIVE=1` makes the run carry what a redaction policy must
 * deal with: the request to itself has a query string holding a secret; the
 * route sets the same email address on its span under two keys
 * (`app.contact`, `app.owner`) and logs a pino line whose `otel.event.name`
 * holds an email address and a URL with a query string; and the app then
 * requests two routes that log an error with pino and throw it, one whose
 * message holds an email address (`/fail/email`) and one whose message is
 * clean (`/fail/clean`). Every value a policy must remove is in
 * SENSITIVE, printed in the result so the test can look for each.
 */

import { shutdown } from "@satoshibits/observability/preset";
import bunyan from "bunyan";
import dns from "node:dns";
import express from "express";
import http from "node:http";
import net from "node:net";
import pino from "pino";
import winston from "winston";

// ===== test plumbing, not part of the application: record every outbound connection but the fixture's own request =====
const sockets = [];
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const target =
    typeof first === "object" && first !== null
      ? Array.isArray(first)
        ? first[0]
        : first
      : { port: first, host: typeof args[1] === "string" ? args[1] : undefined };
  sockets.push({
    host: target.host ?? target.path ?? "localhost",
    port: Number(target.port ?? 0),
  });
  return originalConnect.apply(this, args);
};

const early =
  process.env.OBS_FIXTURE_EARLY_LOGGER === "1"
    ? // already evaluated by the preload: this is the instance it created before start()
      (await import("./early-logger.mjs")).earlyLogger
    : undefined;

// a censor of pino's own: the record at the sink must be the line pino finished, not the call's arguments
const pinoLogger = pino({ redact: { paths: ["note"], censor: "[pino-censored]" } });
if (process.env.OBS_FIXTURE_DNS_LOOKUP === "1") await dns.promises.lookup("localhost");

// a consumer using winston also needs @opentelemetry/winston-transport for its lines to be sent over OTLP
const winstonLogger = winston.createLogger({
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});
const bunyanLogger = bunyan.createLogger({ name: "consumer-app" });

const sensitive = process.env.OBS_FIXTURE_SENSITIVE === "1";
// distinct markers, so a test can tell which one reached the sink
const SENSITIVE = {
  querySecret: "qsecret-5e1f0c",
  contact: "carol@example.com",
  eventEmail: "dave@example.com",
  eventQuery: "evsecret-9b2d47",
  errorEmail: "erin@example.com",
};
// ===== test plumbing: the application itself knows nothing of OpenTelemetry, but the
// allow-list case needs an attribute the app sets, and only the API can set one =====
const otel = sensitive ? await import("@opentelemetry/api") : undefined;

const app = express();
app.get("/users/:id", (request, response) => {
  pinoLogger.info({ logger: "pino", note: "pino-note-value" }, "pino line");
  if (sensitive) {
    const span = otel.trace.getActiveSpan();
    span?.setAttribute("app.contact", SENSITIVE.contact);
    span?.setAttribute("app.owner", SENSITIVE.contact);
    pinoLogger.info(
      {
        logger: "pino-event",
        "otel.event.name": `signup ${SENSITIVE.eventEmail} https://example.com/cb?code=${SENSITIVE.eventQuery}`,
      },
      "pino event line",
    );
  }
  winstonLogger.info("winston line", { logger: "winston" });
  bunyanLogger.info({ logger: "bunyan" }, "bunyan line");
  early?.info({ logger: "early-pino" }, "early pino line");
  response.json({ id: request.params.id });
});

// pino's own err serializer gives the line `err: { type, message, stack }`
app.get("/fail/email", () => {
  const err = new Error(`payment failed for ${SENSITIVE.errorEmail}`);
  pinoLogger.error({ logger: "pino-email-error", err }, "email error line");
  throw err;
});
app.get("/fail/clean", () => {
  const err = new Error("payment gateway timed out");
  pinoLogger.error({ logger: "pino-clean-error", err }, "clean error line");
  throw err;
});

const server = await new Promise((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const port = server.address().port;

const request = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      })
      .on("error", reject);
  });
const status = await request(
  sensitive ? `/users/42?api_key=${SENSITIVE.querySecret}&page=2` : "/users/42",
);
const failures = sensitive
  ? { email: await request("/fail/email"), clean: await request("/fail/clean") }
  : undefined;
await new Promise((resolve) => server.close(resolve));

let finishError = null;
try {
  await shutdown();
} catch (error) {
  finishError = error instanceof Error ? error.message : String(error);
}

const result = {
  status,
  finishError,
  port,
  ...(sensitive && { failures, sensitive: SENSITIVE }),
  // the fixture's request to itself is not telemetry
  sockets: sockets.filter((socket) => socket.port !== port),
};
process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
process.exit(0);
