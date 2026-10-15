/**
 * What the published package holds: `pnpm pack` (what `pnpm publish` uploads)
 * run on a freshly built `dist/`. Every file must match the allow-list below;
 * no browser file, test file, test harness or esbuild consumer bundle may ship;
 * and every target of the `exports` map must be in the tarball.
 *
 * It lives with the child-process tests because it rebuilds `dist/`, which
 * preload.test.mts also builds and runs; the project runs its files one at a time.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDist, PACKAGE_ROOT, packPackage } from "./packed.mjs";

// the only shapes a file in the tarball may have: the manifest, the readme,
// changelog and licence npm always adds, the 1.x compatibility table the readme
// links to, and compiled modules, their declarations and source maps at the
// top of dist/ or in one of its folders
const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^COMPATIBILITY\.md$/,
  /^CHANGELOG\.md$/,
  /^LICEN[CS]E(\.md)?$/,
  // a new folder under dist/ fails this test until it is added here, on purpose
  /^dist\/((config|enrichment|internal|preset|testing|utils)\/)?[a-z][a-z0-9-]*\.(mjs|d\.mts)(\.map)?$/,
];

// named separately so a failure says which forbidden kind shipped
const FORBIDDEN = {
  browser: /browser/i,
  "test file": /\.test\./,
  "test directory": /(^|\/)__tests__\//,
  "consumer bundle": /(^|\/)__consumer__\//,
  "test harness": /(^|\/)(test-setup|test-utils|fixtures)\/|harness\./,
};

let files: string[];
let manifest: {
  exports: Record<string, unknown>;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

beforeAll(async () => {
  await buildDist();
  // preload.test.mts bundles a consumer app into dist/__consumer__ and removes it afterwards;
  // a stand-in shows that `files` leaves it out when it is there
  const consumer = join(PACKAGE_ROOT, "dist/__consumer__");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "consumer-app.mjs"), "");
  try {
    const packed = await packPackage();
    files = packed.files;
    packed.dispose();
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
  manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as typeof manifest;
}, 120_000);

/** every string target under an `exports` entry, conditions included */
function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(targetsOf);
  return [];
}

describe("the packed tarball", () => {
  it("holds compiled modules", () => {
    expect(files).toContain("package.json");
    expect(files).toContain("dist/preset.mjs");
  });

  it("holds the 1.x compatibility table", () => {
    expect(files).toContain("COMPATIBILITY.md");
  });

  it("holds only files the allow-list names", () => {
    expect(files.filter((file) => !ALLOWED.some((rule) => rule.test(file)))).toEqual([]);
  });

  it.each(Object.entries(FORBIDDEN))("holds no %s", (_kind, rule) => {
    expect(files.filter((file) => rule.test(file))).toEqual([]);
  });

  it("holds every target of the exports map, and main and types", () => {
    const targets = [
      ...Object.values(manifest.exports).flatMap(targetsOf),
      ...[manifest.main, manifest.types].filter((target): target is string => target !== undefined),
    ].map((target) => target.replace(/^\.\//, ""));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !files.includes(target))).toEqual([]);
  });
});

type Version = [number, number, number];

/** a version range as [lowest accepted, lowest refused); only the `^x.y.z` and `>=a.b.c <x.y.z` forms */
function interval(range: string): [Version, Version] {
  const version = (text: string): Version => {
    const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
    if (!parts) throw new Error(`not a plain version: ${text}`);
    return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  };
  const caret = /^\^(\S+)$/.exec(range.trim());
  if (caret) {
    const low = version(caret[1]!);
    // ^1.y.z stops at the next major; this package's peers are all 1.x
    if (low[0] === 0) throw new Error(`a ^0.x range is not handled here: ${range}`);
    return [low, [low[0] + 1, 0, 0]];
  }
  const bounded = /^>=\s*(\S+)\s+<\s*(\S+)$/.exec(range.trim());
  if (bounded) return [version(bounded[1]!), version(bounded[2]!)];
  throw new Error(`a range of a form this check does not read: ${range}`);
}

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const packageOf = (name: string) =>
  JSON.parse(readFileSync(join(PACKAGE_ROOT, "node_modules", name, "package.json"), "utf8")) as {
    version: string;
    peerDependencies?: Record<string, string>;
  };

describe("the manifest", () => {
  // two copies of the API would split context and the registered providers between the app and the library
  it("takes @opentelemetry/api as a peer, never as a dependency of its own", () => {
    expect(manifest.peerDependencies).toHaveProperty("@opentelemetry/api");
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@opentelemetry/api");
  });

  // every dependency of ours that takes the api as a peer, read from the installed packages
  const API_PEERS = Object.keys(
    (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> })
      .dependencies,
  ).filter((name) => packageOf(name).peerDependencies?.["@opentelemetry/api"] !== undefined);

  it("finds the dependencies that take the api as a peer", () => {
    expect(API_PEERS).toEqual(expect.arrayContaining(["@opentelemetry/sdk-node", "@opentelemetry/sdk-metrics"]));
  });

  // an api a dependency refuses makes it install a copy of its own: the split the peer exists to prevent
  it.each(API_PEERS)(
    "accepts no @opentelemetry/api that %s refuses",
    (sdk) => {
      const [ourLow, ourHigh] = interval(manifest.peerDependencies!["@opentelemetry/api"]!);
      const theirs = packageOf(sdk).peerDependencies?.["@opentelemetry/api"];
      expect(theirs, `${sdk} names no @opentelemetry/api peer`).toBeDefined();
      const [theirLow, theirHigh] = interval(theirs!);
      expect(compare(ourLow, theirLow), `our lowest ${ourLow.join(".")} against ${theirs}`).toBeGreaterThanOrEqual(0);
      expect(compare(ourHigh, theirHigh), `our upper bound ${ourHigh.join(".")} against ${theirs}`).toBeLessThanOrEqual(0);
    },
  );

  it("accepts the @opentelemetry/api the package is tested with", () => {
    const [low, high] = interval(manifest.peerDependencies!["@opentelemetry/api"]!);
    const installed = interval(`>=${packageOf("@opentelemetry/api").version} <999.0.0`)[0];
    expect(compare(installed, low)).toBeGreaterThanOrEqual(0);
    expect(compare(installed, high)).toBeLessThan(0);
  });
});
