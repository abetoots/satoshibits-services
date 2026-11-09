import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONSchema7 } from "json-schema";
import { SchemaProvider } from "./context";
import { SchemaBuilder } from "./schema-builder";
import { EnumEditor } from "./enum-editor";
import { PluginsProvider } from "../constraints/context";
import { EnumConstraintPlugin } from "../plugins/enum";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";

window.PointerEvent = MouseEvent as typeof PointerEvent;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

const classes = new Set<string>();
const sheetPath = resolve(process.cwd(), "dist/style.css");
const sheetExists = existsSync(sheetPath);

beforeAll(async () => {
  const schema: JSONSchema7 = { type: "object", properties: {
    text: { type: "string", enum: ["one"] }, number: { type: "number" },
    integer: { type: "integer" }, boolean: { type: "boolean" },
    object: { type: "object", properties: {} }, array: { type: "array", items: { type: "string" } },
  } };
  const user = userEvent.setup();
  render(<SchemaProvider><PluginsProvider><SchemaBuilder initialSchema={schema} plugins={[EnumConstraintPlugin]} /><EnumEditor /><EnumEditor showCard={false} /></PluginsProvider></SchemaProvider>);
  expect(screen.getByRole("combobox", { name: "Select items of type" })).toHaveClass("rjsb:bg-background");
  const collect = () => document.body.querySelectorAll("[class]").forEach((el) => {
    el.classList.forEach((token) => {
      if (!el.closest("svg.lucide") || (token !== "lucide" && !token.startsWith("lucide-"))) classes.add(token);
    });
  });
  collect();
  await user.click(screen.getByText("Add Property"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  collect();
  await user.click(within(screen.getByRole("dialog")).getByRole("combobox", { name: /select type/i }));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  collect();
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  const row = screen.getByDisplayValue("text").closest("div")?.parentElement;
  if (!row) throw new Error("property row missing");
  await user.click(within(row).getByRole("button", { name: /edit constraints/i }));
  expect(within(screen.getByRole("dialog")).getByText("Enum Values")).toBeInTheDocument();
  collect();
  await user.keyboard("{Escape}");
  await user.click(within(row).getByRole("button", { name: /delete/i }));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  collect();
});

it("prefixes classes across builder and portal states", () => {
  expect([...classes].filter((token) => token !== "rjsb-root" && !token.startsWith("rjsb:"))).toEqual([]);
});

it.skipIf(!sheetExists && !process.env.CI)(`built stylesheet covers collected classes${sheetExists ? "" : " (dist/style.css missing; run pnpm test:css first)"}`, () => {
  if (!existsSync(sheetPath)) throw new Error("dist/style.css is missing; run pnpm test:css first.");
  const selectors: string[] = [];
  postcss.parse(readFileSync(sheetPath, "utf8")).walkRules((rule) => { selectors.push(...rule.selectors); });
  const missing = [...classes].filter((token) => {
    if (!token.startsWith("rjsb:")) return false;
    const escaped = `.${token.replace(/[:[\]/.=&>(),%#!*@'"]/g, "\\$&")}`;
    return !selectors.some((selector) => {
      const index = selector.indexOf(escaped);
      return index >= 0 && selector[index - 1] !== "\\" && !/[\w\\-]/.test(selector[index + escaped.length] ?? "");
    });
  });
  expect(missing).toEqual([]);
});
