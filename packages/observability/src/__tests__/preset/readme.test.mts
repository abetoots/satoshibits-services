/**
 * README.md, checked without running it (the snippets run in
 * subprocess/readme-examples.test.mts): every code block is run or says why
 * not; the README names nothing the package does not have; and it states
 * what a consumer must know.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { EXECUTED, PACKAGE_ROOT, README, readmeBlocks } from "./readme-snippets.mjs";

const COMPATIBILITY = readFileSync(join(PACKAGE_ROOT, "COMPATIBILITY.md"), "utf8");
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  files: string[];
};

/** the prose: the README less its code blocks and marker comments */
const prose = README.replace(/^```[\s\S]*?^```$/gm, "").replace(/<!--[\s\S]*?-->/g, "");

/** the cells of a COMPATIBILITY.md table, rows only */
function rowsOf(table: string): string[][] {
  const from = COMPATIBILITY.indexOf(`<!-- ${table}:start -->`);
  const to = COMPATIBILITY.indexOf(`<!-- ${table}:end -->`);
  if (from === -1 || to <= from) throw new Error(`COMPATIBILITY.md has no ${table} table`);
  return COMPATIBILITY.slice(from, to)
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .slice(2)
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim().replace(/^`|`$/g, "")));
}

/** every `OTEL_*` name the package's own code reads, as written there */
function variablesInSource(): Set<string> {
  const names = new Set<string>();
  const src = join(PACKAGE_ROOT, "src");
  for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
    const file = join(entry.parentPath, entry.name);
    if (!entry.isFile() || relative(src, file).startsWith("__tests__")) continue;
    for (const name of readFileSync(file, "utf8").match(/OTEL_[A-Z0-9_]+/g) ?? []) names.add(name);
  }
  return names;
}

// read by the preset under a name it builds from the signal's, so not written out in the source
const BUILT_NAMES = ["OTEL_TRACES_EXPORTER", "OTEL_METRICS_EXPORTER"];

describe("the README's code blocks", () => {
  const blocks = readmeBlocks();

  it("are each run by a test or marked illustrative with a reason", () => {
    expect(blocks.length).toBeGreaterThan(0);
    const unmarked = blocks.filter((block) => block.marker === undefined).map((block) => `line ${block.line}`);
    expect(unmarked, "code blocks with no snippet or illustrative marker").toEqual([]);
    for (const block of blocks.filter((b) => b.marker?.kind === "illustrative")) {
      expect(block.marker!.value, `the illustrative block at line ${block.line} gives no reason`).not.toBe("");
    }
  });

  it("name exactly the snippets the runner runs", () => {
    const names = blocks.filter((b) => b.marker?.kind === "snippet").map((b) => b.marker!.value);
    expect([...names].sort()).toEqual([...EXECUTED].sort());
  });
});

describe("the README names nothing the package does not have", () => {
  it("mentions no entry or export that COMPATIBILITY.md lists as removed", () => {
    const removed = [
      ...rowsOf("removed-exports").flatMap(([entry, name, kind]) => (kind === "entry" ? [entry!] : [name!])),
      ...rowsOf("root-exports")
        .filter((cells) => cells[2] === "removed")
        .map(([name]) => name!),
    ];
    expect(removed).toContain("/browser");
    expect(removed).toContain("MockObservabilityClient");
    const found = removed.filter((name) =>
      name.startsWith("/") ? README.includes(`observability${name}`) : new RegExp(`\\b${name}\\b`).test(README),
    );
    expect(found).toEqual([]);
  });

  it("mentions no browser support", () => {
    expect(README).not.toMatch(/browser/i);
  });

  it("imports only from entries the exports map has", () => {
    const used = [...README.matchAll(/@satoshibits\/observability(\/[a-z-]+)?/g)].map((m) => `.${m[1] ?? ""}`);
    expect(used.length).toBeGreaterThan(0);
    expect([...new Set(used)].filter((entry) => !(entry in manifest.exports))).toEqual([]);
  });

  it("names only OTEL_* variables the package reads", () => {
    const known = new Set([...variablesInSource(), ...BUILT_NAMES]);
    const named = new Set(README.match(/OTEL_[A-Z0-9_]+/g) ?? []);
    expect(named.size).toBeGreaterThan(0);
    expect([...named].filter((name) => !known.has(name))).toEqual([]);
  });

  it("links only to files that exist and are published", () => {
    const links = [...README.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map((m) => m[1]!);
    for (const link of links) {
      expect(existsSync(join(PACKAGE_ROOT, link)), link).toBe(true);
      expect(manifest.files, `${link} is not in package.json files`).toContain(link);
    }
  });
});

describe("the README states", () => {
  it("the setup: install, one --import flag, the standard variables", () => {
    expect(README).toMatch(/--import @satoshibits\/observability\/register/);
    expect(README).toMatch(/OTEL_SERVICE_NAME/);
    expect(README).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it("the redaction policy: the standard one, a link to its table, and how to name your own", () => {
    expect(prose).toMatch(/standard (redaction )?policy/i);
    expect(README).toMatch(/\]\(https:\/\/github\.com\/abetoots\/satoshibits-services\/[^)]*packages\/redaction[^)]*\)/);
    expect(README).toMatch(/redaction: /);
  });

  it("the five deliberate departures from the specification, together", () => {
    const from = README.indexOf("<!-- departures:start -->");
    const to = README.indexOf("<!-- departures:end -->");
    expect(from, "a departures list between markers").toBeGreaterThan(-1);
    const list = README.slice(from, to);
    expect(list.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
    expect(list).toMatch(/localhost/);
    expect(list).toMatch(/OTEL_TRACES_SAMPLER/);
    expect(list).toMatch(/OTEL_SDK_DISABLED[^\n]*propagat/);
    expect(list).toMatch(/OTEL_LOGS_EXPORTER=otlp/);
    expect(list).toMatch(/`otlp`[^\n]*`none`/);
  });

  it("that metric attributes are not passed to the policy, and why", () => {
    expect(prose).toMatch(/metric attributes are not passed to the policy[^\n]*series/i);
  });

  it("that Prisma's instrumentation is the project's to add", () => {
    expect(prose).toMatch(/@prisma\/instrumentation/);
  });

  it("that start() after shutdown() is refused", () => {
    expect(prose).toMatch(/`start\(\)` after `shutdown\(\)`[^\n]*refused/);
  });

  it("that preloads read process.env, so .env files need --env-file", () => {
    expect(prose).toMatch(/process\.env/);
    expect(README).toMatch(/--env-file/);
  });

  it("the test kit", () => {
    expect(README).toMatch(/@satoshibits\/observability\/testing/);
  });

  it("the deprecated facade, with a link to COMPATIBILITY.md and its removal in 3.0.0", () => {
    expect(prose).toMatch(/deprecated/i);
    expect(prose).toMatch(/\]\(COMPATIBILITY\.md\)/);
    expect(prose).toMatch(/3\.0\.0/);
  });
});
