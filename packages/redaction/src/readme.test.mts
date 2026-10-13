/**
 * The README's snippets run, and print what the README says they print.
 *
 * A fence opened with ```ts is run: its imports of this package are given
 * this source, each `console.log` is recorded, and the lines that start
 * `// → ` are what it must have logged, in order. A fence opened with
 * ```typescript needs another package (a logger, the observability preset)
 * and is only shown.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

import * as redaction from "./index.mjs";

const readme = readFileSync(path.join(import.meta.dirname, "../README.md"), "utf8");

interface Fence {
  language: string;
  code: string;
}
const fences: Fence[] = [...readme.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)].map(
  ([, language = "", code = ""]) => ({ language, code }),
);
const runnable = fences.filter(({ language }) => language === "ts");

const printed = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

describe("the README", () => {
  it("has snippets to run, and shows only the two that need another package", () => {
    expect(runnable.length).toBeGreaterThanOrEqual(7);
    const shown = fences.filter(({ language }) => language === "typescript");
    expect(shown.map(({ code }) => /from "(?!@satoshibits\/redaction)([^"]+)"/.exec(code)?.[1])).toEqual([
      "@satoshibits/observability/preset",
      "pino",
    ]);
    expect(fences.map(({ language }) => language).filter((language) => !["ts", "typescript", "sh"].includes(language))).toEqual([]);
  });

  const cases: [number, string, string][] = runnable.map(({ code }, index) => [
    index + 1,
    code.split("\n").find((line) => line.startsWith("console.log")) ?? "",
    code,
  ]);

  it.each(cases)(
    "snippet %i runs and prints what it says: %s",
    (_index, _first, code) => {
      const expected = [...code.matchAll(/^\/\/ → (.*)$/gm)].map(([, line]) => line);
      expect(expected.length, "the snippet says what it prints").toBeGreaterThan(0);

      const { outputText, diagnostics } = transpileModule(code, {
        reportDiagnostics: true,
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      });
      expect(diagnostics).toEqual([]);

      const logged: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the README's own code is the test
      const run = new Function("require", "exports", "console", outputText) as (
        require: (name: string) => unknown,
        exports: object,
        console: { log: (...values: unknown[]) => void },
      ) => void;
      run(
        (name) => {
          if (name !== "@satoshibits/redaction") throw new Error(`a runnable snippet imports ${name}`);
          return redaction;
        },
        {},
        { log: (...values) => logged.push(values.map(printed).join(" ")) },
      );

      expect(logged).toEqual(expected);
    },
  );

  it("every export is named in the README", () => {
    const missing = Object.keys(redaction).filter((name) => !readme.includes(name));
    expect(missing).toEqual([]);
  });
});
