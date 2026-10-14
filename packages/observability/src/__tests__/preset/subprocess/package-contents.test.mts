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
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const run = promisify(execFile);

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
let manifest: { exports: Record<string, unknown>; main?: string; types?: string };

beforeAll(async () => {
  // as in preload.test.mts: built here unless the release workflow has just built dist/
  if (process.env.OBS_TEST_DIST_FRESH !== "1") {
    await run("pnpm", ["run", "build"], { cwd: PACKAGE_ROOT });
  }
  // preload.test.mts bundles a consumer app into dist/__consumer__ and removes it afterwards;
  // a stand-in shows that `files` leaves it out when it is there
  const consumer = join(PACKAGE_ROOT, "dist/__consumer__");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "consumer-app.mjs"), "");
  const destination = mkdtempSync(join(tmpdir(), "obs-pack-"));
  try {
    const { stdout } = await run("pnpm", ["pack", "--pack-destination", destination, "--json"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as { files?: unknown };
    expect(Array.isArray(parsed.files), `pnpm pack --json printed no files array: ${stdout.slice(0, 200)}`).toBe(
      true,
    );
    files = (parsed.files as { path: string }[]).map((file) => file.path);
  } finally {
    rmSync(destination, { recursive: true, force: true });
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
