import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const built = existsSync("dist/index.es.js");
const inCI = !!process.env.CI && !["false", "0"].includes(process.env.CI.toLowerCase());

// radix is bundled: dialog and tooltip must share one dismissable layer, or escape breaks
it.skipIf(!built && !inCI)("the bundle has one dismissable layer, shared by dialog and tooltip", () => {
  const files = readdirSync("dist").filter((file) => /^index\.es.*\.js$/.test(file));
  const containing = (needle: string) => files.filter((file) => readFileSync(`dist/${file}`, "utf8").includes(needle));
  const layers = containing("dismissableLayer.update");
  expect(layers).toHaveLength(1);
  for (const needle of ["tooltip.open", "DialogDescriptionWarning"]) {
    const matches = containing(needle);
    expect(matches).toHaveLength(1);
    expect(readFileSync(`dist/${matches[0]}`, "utf8")).toContain(`from "./${layers[0]}"`);
  }
});
