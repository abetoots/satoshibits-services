/**
 * The standard policy against a recorded list of attribute keys: the ones
 * the auto-instrumentation bundle emitted for an Express request, an
 * outbound HTTP request and a pino line, and the ones the MongoDB and Redis
 * instrumentations declare. The list is `fixtures/attribute-keys.json`,
 * written by the observability package's `capture:attribute-keys` script.
 *
 * It covers the keys listed, not every key an instrumentation could emit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REDACTED } from "./masks.mjs";
import { standardPolicy } from "./standard.mjs";

interface Fixture {
  captured: Record<string, string[]>;
  declared: Record<string, { version: string; keys: string[] }>;
}

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/attribute-keys.json"), "utf8"),
) as Fixture;
const README = path.join(import.meta.dirname, "../README.md");

type Action = "dropped" | "redacted" | "query removed" | "text masks";

/** what the standard policy does to a value under a key, found by trying it */
const actionOn = (key: string): Action => {
  // a path with a query: only a rule for URL keys cuts it, and no text mask touches it
  const probe = "/path?query=1";
  const result = standardPolicy.attributes("span", { [key]: probe });
  if (!(key in result)) return "dropped";
  if (result[key] === REDACTED) return "redacted";
  if (result[key] === "/path") return "query removed";
  expect(result[key]).toBe(probe);
  return "text masks";
};

/** where a key was seen, or which instrumentation declares it */
const sources = new Map<string, string[]>();
for (const [key, surfaces] of Object.entries(fixture.captured)) {
  sources.set(key, surfaces.map((surface) => `captured on a ${surface}`));
}
for (const [name, { keys }] of Object.entries(fixture.declared)) {
  const short = name.replace("@opentelemetry/instrumentation-", "");
  for (const key of keys) sources.set(key, [...(sources.get(key) ?? []), `declared by ${short}`]);
}
const keys = [...sources.keys()].sort();

const EXPLANATION: Record<Action, string> = {
  dropped: "dropped, key and value",
  redacted: "value replaced with `[REDACTED]`",
  "query removed": "query string, fragment and user-info removed",
  "text masks": "kept; a text value passes the text masks",
};

const table = [
  "| Key | Where it comes from | What the standard policy does |",
  "|---|---|---|",
  ...keys.map(
    (key) => `| \`${key}\` | ${sources.get(key)!.join("; ")} | ${EXPLANATION[actionOn(key)]} |`,
  ),
].join("\n");

describe("the standard policy against the recorded attribute keys", () => {
  it("has a list to check: captured keys from all three sources, and both databases' declared ones", () => {
    const captured = Object.keys(fixture.captured);
    // one from each: the HTTP instrumentation, Express, the pino line, the resource
    expect(captured).toEqual(
      expect.arrayContaining(["http.request.method", "express.type", "userId", "service.name"]),
    );
    expect(Object.keys(fixture.declared).sort()).toEqual([
      "@opentelemetry/instrumentation-ioredis",
      "@opentelemetry/instrumentation-mongodb",
      "@opentelemetry/instrumentation-redis",
    ]);
    for (const { keys: declared } of Object.values(fixture.declared)) {
      expect(declared).toContain("db.query.text");
    }
  });

  it("acts on exactly these keys, and leaves every other one to the text masks", () => {
    const acted: Record<string, Action> = Object.fromEntries(
      keys
        .map((key): [string, Action] => [key, actionOn(key)])
        .filter(([, action]) => action !== "text masks"),
    );
    // a key that appears here after a new capture is one to decide about, in the policy or in this list
    expect(acted).toEqual({
      "client.address": "dropped",
      "network.peer.address": "dropped",
      "url.query": "dropped",
      "url.full": "query removed",
    });
  });

  it("redacts none of them: no key an instrumentation emits is taken for a secret by its name", () => {
    expect(keys.filter((key) => actionOn(key) === "redacted")).toEqual([]);
  });

  it("is the table in the README", () => {
    const readme = readFileSync(README, "utf8");
    const start = "<!-- standard-policy-table:start -->\n";
    const end = "\n<!-- standard-policy-table:end -->";
    const from = readme.indexOf(start);
    const to = readme.indexOf(end);
    expect(from, "the README has the table's start marker").toBeGreaterThan(-1);
    expect(to, "the README has the table's end marker").toBeGreaterThan(from);
    if (process.env.UPDATE_README === "1") {
      writeFileSync(README, readme.slice(0, from + start.length) + table + readme.slice(to));
      return;
    }
    expect(readme.slice(from + start.length, to)).toBe(table);
  });
});
