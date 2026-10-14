/**
 * The two changesets G4e releases with: the observability major with its
 * migration notes for 1.x users, and the redaction package's first release.
 * What they promise is checked against the packages.
 */

import { describe, expect, it } from "vitest";
import * as redaction from "@satoshibits/redaction";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_ROOT } from "./readme-snippets.mjs";

const CHANGESETS = join(PACKAGE_ROOT, "../../.changeset");

/** a changeset's frontmatter lines and its body */
function changeset(file: string): { bumps: string[]; body: string } {
  const text = readFileSync(join(CHANGESETS, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file} has no frontmatter`);
  return { bumps: match[1]!.split("\n").map((line) => line.trim()), body: match[2]! };
}

describe("the observability changeset", () => {
  const { bumps, body } = changeset("observability-2-preset.md");
  /** the numbered migration notes, each with its own lines */
  const notes = body.split(/\n(?=\d+\. )/).filter((part) => /^\d+\. /.test(part));

  it("is a major release of @satoshibits/observability only", () => {
    expect(bumps).toEqual(['"@satoshibits/observability": major']);
  });

  it("gives the eight migration notes in order", () => {
    const KEYWORDS = [
      /localhost:4318/,
      /--import @satoshibits\/observability\/register/,
      /`redaction`/,
      /deprecated/,
      /browser/,
      /MockObservabilityClient/,
      /`@opentelemetry\/api` is now a peer dependency/,
      /COMPATIBILITY\.md/,
    ];
    expect(notes).toHaveLength(KEYWORDS.length);
    KEYWORDS.forEach((keyword, i) => expect(notes[i], `note ${i + 1}`).toMatch(keyword));
  });

  it("links COMPATIBILITY.md where npm and GitHub can both open it", () => {
    expect(body).toMatch(
      /\]\(https:\/\/github\.com\/abetoots\/satoshibits-services\/blob\/main\/packages\/observability\/COMPATIBILITY\.md\)/,
    );
  });
});

describe("the redaction changeset", () => {
  const { bumps, body } = changeset("redaction-first-release.md");

  it("is a major release of @satoshibits/redaction only", () => {
    expect(bumps).toEqual(['"@satoshibits/redaction": major']);
  });

  it("names only exports of @satoshibits/redaction", () => {
    // code spans that are words of the prose, not names of exports
    const PROSE = new Set(["Bearer", "redaction", "@satoshibits/observability"]);
    const named = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((name) => !PROSE.has(name));
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((name) => !(name in redaction))).toEqual([]);
  });
});
