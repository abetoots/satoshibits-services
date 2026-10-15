/**
 * The release notes G4e ships with: the observability major with its
 * migration notes for 1.x users, and the redaction package's first release.
 *
 * They live in two places over a release. Before it, in the `.changeset`
 * files. The release PR's `changeset version` deletes those and writes the
 * same text into each package's CHANGELOG.md under the new version; the
 * publish runs this suite after that. So the notes are read from the
 * changeset when it exists, otherwise from the CHANGELOG section of the
 * version, and with neither the test fails: a deleted changeset must not
 * pass before release. The second path is proved on the output of a real
 * `changeset version` run in a copy of the repository.
 */

import { beforeAll, describe, expect, it } from "vitest";
import * as redaction from "@satoshibits/redaction";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PACKAGE_ROOT } from "./readme-snippets.mjs";

const REPO_ROOT = join(PACKAGE_ROOT, "../..");

interface Release {
  /** the package as the frontmatter names it */
  name: string;
  /** the version the release produces */
  version: string;
  changeset: string;
  /** the package's directory, relative to the repository */
  dir: string;
}

const OBSERVABILITY: Release = {
  name: "@satoshibits/observability",
  version: "2.0.0",
  changeset: "observability-2-preset.md",
  dir: "packages/observability",
};
const REDACTION: Release = {
  name: "@satoshibits/redaction",
  version: "1.0.0",
  changeset: "redaction-first-release.md",
  dir: "packages/redaction",
};

/** a release's notes, from its changeset or else from its CHANGELOG section; throws with neither */
function releaseNotes(root: string, release: Release): { from: "changeset" | "changelog"; body: string } {
  const changesetPath = join(root, ".changeset", release.changeset);
  if (existsSync(changesetPath)) {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(changesetPath, "utf8"));
    if (!match) throw new Error(`${release.changeset} has no frontmatter`);
    const bumps = match[1]!.split("\n").map((line) => line.trim());
    if (bumps.join("\n") !== `"${release.name}": major`) {
      throw new Error(`${release.changeset} bumps ${bumps.join(", ")}, not "${release.name}": major only`);
    }
    return { from: "changeset", body: match[2]! };
  }
  const changelogPath = join(root, release.dir, "CHANGELOG.md");
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  const heading = `\n## ${release.version}\n`;
  const at = changelog.indexOf(heading);
  if (at === -1) {
    throw new Error(
      `neither .changeset/${release.changeset} nor a ${release.version} section in ${release.dir}/CHANGELOG.md`,
    );
  }
  const section = changelog.slice(at + heading.length).split(/\n## /)[0]!;
  // `changeset version` files a major bump under this heading
  const major = /### Major Changes\n\n- ([\s\S]*?)(?=\n### |$)/.exec(section);
  if (!major) throw new Error(`the ${release.version} section of ${release.dir}/CHANGELOG.md has no major change`);
  // the entry is a list item: its later lines are indented by two spaces
  return { from: "changelog", body: major[1]!.replace(/^ {2}/gm, "") };
}

/** what is wrong with the observability notes */
function observabilityProblems(body: string): string[] {
  const notes = body.split(/\n(?=\d+\. )/).filter((part) => /^\d+\. /.test(part));
  const NOTES: [string, RegExp[]][] = [
    ["localhost default", [/localhost:4318/]],
    ["preload", [/--import @satoshibits\/observability\/register/]],
    ["redaction", [/`redaction` is required/]],
    ["deprecated facade", [/root entry is deprecated/, /removed in 3\.0\.0/]],
    ["browser entry", [/`@satoshibits\/observability\/browser`/, /browser entry is removed/]],
    ["mock client", [/`MockObservabilityClient` is removed/]],
    ["api peer", [/`@opentelemetry\/api` is now a peer dependency/]],
    [
      "COMPATIBILITY.md link",
      [/\]\(https:\/\/github\.com\/abetoots\/satoshibits-services\/blob\/main\/packages\/observability\/COMPATIBILITY\.md\)/],
    ],
  ];
  const problems: string[] = [];
  if (notes.length !== NOTES.length) problems.push(`${notes.length} migration notes, not ${NOTES.length}`);
  NOTES.forEach(([label, patterns], i) => {
    for (const pattern of patterns) {
      if (!pattern.test(notes[i] ?? "")) problems.push(`note ${i + 1} (${label}) does not match ${pattern}`);
    }
  });
  return problems;
}

/** what is wrong with the redaction notes: a name that is not an export */
function redactionProblems(body: string): string[] {
  // code spans that are words of the prose, not names of exports
  const PROSE = new Set(["Bearer", "redaction", "@satoshibits/observability"]);
  const named = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((name) => !PROSE.has(name));
  if (named.length < 10) return [`only ${named.length} names`];
  return named.filter((name) => !(name in redaction)).map((name) => `${name} is not an export`);
}

describe("the release notes in this repository", () => {
  it("are complete for @satoshibits/observability", () => {
    expect(observabilityProblems(releaseNotes(REPO_ROOT, OBSERVABILITY).body)).toEqual([]);
  });

  it("are complete for @satoshibits/redaction", () => {
    expect(redactionProblems(releaseNotes(REPO_ROOT, REDACTION).body)).toEqual([]);
  });
});

describe("the release notes after `changeset version`", () => {
  let copy: string;

  beforeAll(async () => {
    // only what `changeset version` reads: the workspace's manifests, the changesets and the changelogs
    copy = mkdtempSync(join(tmpdir(), "obs-changeset-version-"));
    for (const file of ["package.json", "pnpm-workspace.yaml"]) copyFileSync(join(REPO_ROOT, file), join(copy, file));
    for (const group of ["packages", "react-packages", "tooling"]) {
      for (const name of readdirSync(join(REPO_ROOT, group))) {
        const manifest = join(REPO_ROOT, group, name, "package.json");
        if (!existsSync(manifest)) continue;
        mkdirSync(join(copy, group, name), { recursive: true });
        copyFileSync(manifest, join(copy, group, name, "package.json"));
        const changelog = join(REPO_ROOT, group, name, "CHANGELOG.md");
        if (existsSync(changelog)) copyFileSync(changelog, join(copy, group, name, "CHANGELOG.md"));
      }
    }
    mkdirSync(join(copy, ".changeset"));
    for (const file of ["config.json", OBSERVABILITY.changeset, REDACTION.changeset]) {
      copyFileSync(join(REPO_ROOT, ".changeset", file), join(copy, ".changeset", file));
    }
    await promisify(execFile)(join(REPO_ROOT, "node_modules/.bin/changeset"), ["version"], { cwd: copy });
    return () => rmSync(copy, { recursive: true, force: true });
  }, 60_000);

  it("are read from the CHANGELOGs, the changesets being gone", () => {
    expect(existsSync(join(copy, ".changeset", OBSERVABILITY.changeset))).toBe(false);
    expect(releaseNotes(copy, OBSERVABILITY).from).toBe("changelog");
    expect(releaseNotes(copy, REDACTION).from).toBe("changelog");
  });

  it("are complete for both packages", () => {
    expect(observabilityProblems(releaseNotes(copy, OBSERVABILITY).body)).toEqual([]);
    expect(redactionProblems(releaseNotes(copy, REDACTION).body)).toEqual([]);
  });

  it("fail when a migration note is missing from the CHANGELOG", () => {
    const path = join(copy, OBSERVABILITY.dir, "CHANGELOG.md");
    const original = readFileSync(path, "utf8");
    try {
      writeFileSync(path, original.replace(/\n {2}6\. \*\*`MockObservabilityClient`[^\n]*/, ""));
      expect(observabilityProblems(releaseNotes(copy, OBSERVABILITY).body)).toContain("7 migration notes, not 8");
    } finally {
      writeFileSync(path, original);
    }
  });

  it("fail, rather than pass, with neither the changeset nor the CHANGELOG section", () => {
    const empty = mkdtempSync(join(tmpdir(), "obs-no-release-notes-"));
    try {
      expect(() => releaseNotes(empty, OBSERVABILITY)).toThrow(/neither \.changeset\/observability-2-preset\.md/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
