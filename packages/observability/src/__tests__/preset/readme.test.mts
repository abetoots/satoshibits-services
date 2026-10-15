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
  peerDependencies: Record<string, string>;
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

// the signals' parts of a variable name, as config.mts's SIGNAL_VAR spells them
const SIGNAL_PARTS = ["TRACES", "METRICS", "LOGS"];

/**
 * every `OTEL_*` name the package's own code reads: `process.env.NAME`, a
 * string literal that is the whole name (what `read(env, …)` and the name
 * lists take), and a name built from a signal's part. A name inside a
 * sentence (a warning's text) or a comment is not a read.
 */
function variablesInSource(): Set<string> {
  const names = new Set<string>();
  const src = join(PACKAGE_ROOT, "src");
  for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
    const file = join(entry.parentPath, entry.name);
    if (!entry.isFile() || relative(src, file).startsWith("__tests__")) continue;
    for (const name of variablesRead(readFileSync(file, "utf8"))) names.add(name);
  }
  return names;
}

/** the `OTEL_*` names one source file reads */
function variablesRead(source: string): Set<string> {
  const names = new Set<string>();
  // block comments, then line comments (a `//` after a colon is a URL's)
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of code.matchAll(/process\.env\.(OTEL_[A-Z0-9_]+)/g)) names.add(m[1]!);
  for (const m of code.matchAll(/["'](OTEL_[A-Z0-9_]+)["']/g)) names.add(m[1]!);
  for (const m of code.matchAll(/`(OTEL_[A-Z0-9_]*)\$\{SIGNAL_VAR\[signal\]\}([A-Z0-9_]*)`/g)) {
    for (const part of SIGNAL_PARTS) names.add(`${m[1]}${part}${m[2]}`);
  }
  return names;
}

// read by OpenTelemetry's OTLP exporters themselves, which the preset constructs
const UPSTREAM_NAMES = ["OTEL_EXPORTER_OTLP_HEADERS"];

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

  it("counts as read the names built from a signal's, and not the names in a warning's text", () => {
    const read = variablesInSource();
    expect(read).toContain("OTEL_TRACES_EXPORTER");
    expect(read).toContain("OTEL_EXPORTER_OTLP_LOGS_PROTOCOL");
    expect(read).toContain("OTEL_SERVICE_NAME");
  });

  it("does not count a name in a comment or a sentence as read", () => {
    const read = variablesRead(
      [
        "// process.env.OTEL_NONEXISTENT",
        '// "OTEL_NONEXISTENT"',
        '/* read(env, "OTEL_NONEXISTENT") */',
        'warn("set OTEL_NONEXISTENT to turn it on");',
        'const url = "https://example.com"; // "OTEL_NONEXISTENT"',
      ].join("\n"),
    );
    expect([...read]).toEqual([]);
    expect([...variablesRead('read(env, "OTEL_REAL"); process.env.OTEL_ALSO_REAL;')].sort()).toEqual([
      "OTEL_ALSO_REAL",
      "OTEL_REAL",
    ]);
  });

  it("names only OTEL_* variables the package reads", () => {
    const known = new Set([...variablesInSource(), ...UPSTREAM_NAMES]);
    const named = new Set(README.match(/OTEL_[A-Z0-9_]+/g) ?? []);
    expect(named.size).toBeGreaterThan(0);
    expect([...named].filter((name) => !known.has(name))).toEqual([]);
  });

  // a version the peer range refuses would make the SDK install a copy of the api of its own
  it("installs @opentelemetry/api at a version the peer range accepts, and never 1.10", () => {
    type Version = [number, number, number];
    const version = (text: string): Version => {
      const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
      if (!parts) throw new Error(`not a plain version: ${text}`);
      return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    };
    const compare = (x: Version, y: Version) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    /** [lowest accepted, lowest refused) of a `~x.y.z` spec or a `>=a.b.c <x.y.z` range */
    const interval = (range: string): [Version, Version] => {
      const tilde = /^~(\S+)$/.exec(range);
      if (tilde) {
        const low = version(tilde[1]!);
        return [low, [low[0], low[1] + 1, 0]];
      }
      const bounded = /^>=\s*(\S+)\s+<\s*(\S+)$/.exec(range);
      if (bounded) return [version(bounded[1]!), version(bounded[2]!)];
      throw new Error(`a range of a form this check does not read: ${range}`);
    };

    const install = /pnpm add [^\n]*/.exec(README)?.[0] ?? "";
    const word = install.split(/\s+/).find((w) => w.startsWith("@opentelemetry/api"));
    expect(word, `the install command adds @opentelemetry/api: ${install}`).toBeDefined();
    const spec = /^@opentelemetry\/api@(.+)$/.exec(word!)?.[1];
    expect(spec, `the install command gives @opentelemetry/api a version: ${word}`).toBeDefined();
    const [specLow, specHigh] = interval(spec!);
    const [peerLow, peerHigh] = interval(
      manifest.peerDependencies["@opentelemetry/api"]!,
    );
    expect(compare(specLow, peerLow), "the spec's lowest version is in the peer range").toBeGreaterThanOrEqual(0);
    expect(compare(specLow, peerHigh), "the spec's lowest version is in the peer range").toBeLessThan(0);
    expect(compare(specHigh, peerHigh), "the spec allows nothing the peer range refuses").toBeLessThanOrEqual(0);
    expect(compare(specHigh, [1, 10, 0]), "the spec allows no 1.10").toBeLessThanOrEqual(0);
  });

  it("links only to files that exist and are published", () => {
    const links = [...README.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map((m) => m[1]!);
    expect(links).toContain("COMPATIBILITY.md");
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
    expect(to, "the departures list's end marker").toBeGreaterThan(from);
    const list = README.slice(from, to);
    expect(list.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
    expect(list).toMatch(/localhost/);
    expect(list).toMatch(/OTEL_TRACES_SAMPLER/);
    expect(list).toMatch(/OTEL_SDK_DISABLED[^\n]*propagat/);
    expect(list).toMatch(/OTEL_LOGS_EXPORTER=otlp/);
    expect(list).toMatch(/`otlp`[^\n]*`none`/);
  });

  it("that metric attributes are not redacted, and why", () => {
    expect(prose).toMatch(/metrics are not redacted[^\n]*series/i);
    expect(prose).toMatch(/never put user data in a metric attribute/i);
  });

  it("that Prisma's instrumentation is the project's to add", () => {
    expect(prose).toMatch(
      /Prisma publishes its own instrumentation, `@prisma\/instrumentation`; a project that wants Prisma's spans adds it itself\./,
    );
  });

  it("that a logs endpoint alone does not export logs", () => {
    expect(prose).not.toMatch(/OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` set one signal's, and turn that signal on by themselves/);
    expect(prose).toMatch(/OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`[^\n]*logs also need `OTEL_LOGS_EXPORTER=otlp`/);
  });

  it("that start() after shutdown() is refused", () => {
    expect(prose).toMatch(/`start\(\)` after `shutdown\(\)`[^\n]*refused/);
  });

  it("that preloads read process.env, so .env files need --env-file", () => {
    expect(prose).toMatch(/A preload runs before your application's code, and it reads `process\.env` directly\./);
    expect(prose).toMatch(/`--env-file` needs Node\.js 20\.6 or later/);
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
