/**
 * The browser entry is deleted in 2.0.0 (plan, decision 5): no `exports` entry,
 * source file, test project or dependency exists only for the browser, and the
 * shared modules keep no browser branch. What the published tarball holds is
 * pinned in subprocess/package-contents.test.mts.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(PACKAGE, "src");
const THIS_FILE = relative(PACKAGE, fileURLToPath(import.meta.url));

interface PackageJson {
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as PackageJson;

/** every file under `dir`, relative to the package */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(PACKAGE, join(entry.parentPath, entry.name)));
}

// packages that exist only for a browser runtime or a browser test runner
const WEB_ONLY_DEPENDENCY = [
  /^@opentelemetry\/auto-instrumentations-web$/,
  /^@opentelemetry\/sdk-trace-web$/,
  /^@opentelemetry\/context-zone/,
  /^@opentelemetry\/instrumentation-(fetch|xml-http-request|document-load|user-interaction)$/,
  /^zone\.js$/,
  /^web-vitals$/,
  /^@vitest\/browser/,
  /^(@playwright\/test|playwright)$/,
  /^(@types\/)?jsdom$/,
  /^@sentry\//,
];

describe("the browser removal", () => {
  it("has no browser entry in the exports map", () => {
    expect(Object.keys(pkg.exports).filter((key) => /browser/i.test(key))).toEqual([]);
  });

  it("depends on no web-only package, and on no unused optional Sentry SDK", () => {
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    expect(names.filter((name) => WEB_ONLY_DEPENDENCY.some((rule) => rule.test(name)))).toEqual([]);
  });

  it("has no source or test file for the browser", () => {
    const browserFiles = filesUnder(SRC).filter(
      (file) => file !== THIS_FILE && /browser|zone\.d\.ts/i.test(file),
    );
    expect(browserFiles).toEqual([]);
  });

  it("has no browser test project, browser runner or browser script", async () => {
    // imported by url: the config is outside the compiled sources
    const { default: config } = (await import(pathToFileURL(join(PACKAGE, "vitest.config.mts")).href)) as {
      default: { test?: { projects?: { test?: Record<string, unknown> }[]; setupFiles?: string[] } };
    };
    const projects = config.test?.projects ?? [];
    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) {
      const name = String(project.test?.name);
      expect(name, "a project named for the browser").not.toMatch(/browser/i);
      expect(project.test?.browser, `${name} runs in a browser`).toBeUndefined();
      expect(project.test?.environment, `${name} runs in a DOM`).toBe("node");
    }
    expect(config.test?.setupFiles ?? [], "a browser setup file").not.toContainEqual(
      expect.stringMatching(/browser/i),
    );
    expect(Object.entries(pkg.scripts).filter(([name, script]) => /browser/i.test(`${name} ${script}`))).toEqual(
      [],
    );
    expect(readFileSync(join(PACKAGE, "vitest.config.mts"), "utf8")).not.toMatch(/zone\.js|jsdom|playwright/);
  });

  it("leaves no browser branch, DOM global or web-only import in the shared modules", () => {
    const BROWSER_CODE = [
      /typeof (window|document|navigator|self)\b/,
      /globalThis\.(window|document|navigator)\b/,
      /\b(window|document|navigator)\./,
      /\bisBrowser\b/,
      /["']browser["']/,
      /from ["'](zone\.js|web-vitals|@opentelemetry\/(sdk-trace-web|auto-instrumentations-web|context-zone[^"']*|instrumentation-fetch|instrumentation-xml-http-request))["']/,
      /import\(["'][^"']*browser[^"']*["']\)/,
    ];
    const found: string[] = [];
    for (const file of filesUnder(SRC).filter((name) => !name.includes("__tests__"))) {
      const lines = readFileSync(join(PACKAGE, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (BROWSER_CODE.some((rule) => rule.test(line))) found.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
