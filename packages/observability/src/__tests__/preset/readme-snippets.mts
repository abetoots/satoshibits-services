/**
 * The README's code blocks, read the way its tests need them.
 *
 * Every fenced block in README.md sits right under a marker comment:
 *
 *   <!-- snippet: name -->         run by subprocess/readme-examples.test.mts
 *   <!-- illustrative: reason -->  not run, and the README says why
 *
 * readme.test.mts checks that every block is marked and that the snippet
 * names are exactly the ones the runner runs (EXECUTED).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const README = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");

/** the snippets subprocess/readme-examples.test.mts runs, by name */
export const EXECUTED = ["quick-start", "env-file", "custom-preload", "custom-preload-run", "test-kit"] as const;
export type SnippetName = (typeof EXECUTED)[number];

export interface Block {
  /** the 1-based line of the opening fence */
  line: number;
  lang: string;
  code: string;
  marker?: { kind: "snippet" | "illustrative"; value: string };
}

const MARKER = /^<!--\s*(snippet|illustrative):\s*(.*?)\s*-->$/;

/** every fenced block of the README, with the marker on the line above it */
export function readmeBlocks(text = README): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\S*)\s*$/.exec(lines[i]!);
    if (!open) continue;
    const end = lines.findIndex((line, j) => j > i && /^```\s*$/.test(line));
    if (end === -1) throw new Error(`README.md: the code block at line ${i + 1} is not closed`);
    let above = i - 1;
    while (above >= 0 && lines[above]!.trim() === "") above--;
    const marker = above >= 0 ? MARKER.exec(lines[above]!.trim()) : null;
    blocks.push({
      line: i + 1,
      lang: open[1] ?? "",
      code: lines.slice(i + 1, end).join("\n") + "\n",
      ...(marker && { marker: { kind: marker[1] as "snippet" | "illustrative", value: marker[2]! } }),
    });
    i = end;
  }
  return blocks;
}

/** the code of the snippet of this name; throws when the README has none */
export function snippet(name: SnippetName, text = README): string {
  const found = readmeBlocks(text).filter((b) => b.marker?.kind === "snippet" && b.marker.value === name);
  if (found.length !== 1) throw new Error(`README.md has ${found.length} snippets named "${name}"`);
  return found[0]!.code;
}

export interface Command {
  /** the `NAME=value` assignments before the command */
  env: Record<string, string>;
  /** the program, e.g. `node` */
  program: string;
  args: string[];
}

/** a one-command shell snippet (`\` continuations, `NAME=value` prefixes, no quoting) as data */
export function parseCommand(code: string): Command {
  const words = code
    .replace(/\\\n/g, " ")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.some((word) => /["'`$;&|<>]/.test(word))) {
    throw new Error(`a command snippet must be plain words: ${code}`);
  }
  const env: Record<string, string> = {};
  while (words.length > 0 && /^[A-Z][A-Z0-9_]*=/.test(words[0]!)) {
    const [name, ...value] = words.shift()!.split("=");
    env[name!] = value.join("=");
  }
  const program = words.shift();
  if (program === undefined) throw new Error(`a command snippet runs nothing: ${code}`);
  return { env, program, args: words };
}
