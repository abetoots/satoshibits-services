import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONSchema7 } from "json-schema";
import { SchemaProvider } from "./context";
import { SchemaBuilder } from "./schema-builder";
import { EnumEditor } from "./enum-editor";
import { PluginsProvider } from "../constraints/context";
import { EnumConstraintPlugin } from "../plugins/enum";

window.PointerEvent = MouseEvent as typeof PointerEvent;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

it("prefixes classes across builder and portal states", async () => {
  const schema: JSONSchema7 = { type: "object", properties: {
    text: { type: "string", enum: ["one"] }, number: { type: "number" },
    integer: { type: "integer" }, boolean: { type: "boolean" },
    object: { type: "object", properties: {} }, array: { type: "array", items: { type: "string" } },
  } };
  const user = userEvent.setup();
  render(<SchemaProvider><PluginsProvider><SchemaBuilder initialSchema={schema} plugins={[EnumConstraintPlugin]} /><EnumEditor /><EnumEditor showCard={false} /></PluginsProvider></SchemaProvider>);
  expect(screen.getByRole("combobox", { name: "Select items of type" })).toHaveClass("rjsb:bg-background");
  const classes = new Set<string>();
  const collect = () => document.body.querySelectorAll("[class]").forEach((el) => el.classList.forEach((token) => classes.add(token)));
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
  // Lucide adds these icon identification classes to its SVGs.
  const lucideClasses = ["lucide", "lucide-chevron-down", "lucide-trash2", "lucide-copy", "lucide-bolt", "lucide-chevron-right", "lucide-plus", "lucide-x"];
  expect([...classes].filter((token) => token !== "rjsb-root" && !token.startsWith("rjsb:") && !lucideClasses.includes(token))).toEqual([]);
});
