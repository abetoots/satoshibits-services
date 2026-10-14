/**
 * The `app.js` of the README's snippets: plain ESM that knows nothing of
 * OpenTelemetry. It serves one route, requests it once from itself with a
 * secret in the query string, and prints one `RESULT {json}` line.
 *
 * readme-examples.test.mts copies it into a consumer package as `app.js`.
 */

import { shutdown } from "@satoshibits/observability/preset";
import http from "node:http";
import net from "node:net";

// ===== test plumbing, not part of the application: record every outbound connection but the app's own request =====
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
  sockets.push({ host: target.host ?? target.path ?? "localhost", port: Number(target.port ?? 0) });
  return originalConnect.apply(this, args);
};

const SECRET = "s3cret-query-token";

const server = http.createServer((_request, response) => response.end("ok"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const status = await new Promise((resolve, reject) => {
  http
    .get(`http://127.0.0.1:${port}/orders?token=${SECRET}`, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    })
    .on("error", reject);
});
await new Promise((resolve) => server.close(resolve));

// ===== test plumbing: flush before exiting, so the test reads everything at once =====
await shutdown();
process.stdout.write(
  `RESULT ${JSON.stringify({ status, sockets: sockets.filter((socket) => socket.port !== port) })}\n`,
);
