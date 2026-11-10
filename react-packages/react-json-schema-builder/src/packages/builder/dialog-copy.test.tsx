import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchemaBuilder } from "./schema-builder";
import { SchemaProvider } from "./context";
import { PluginsProvider } from "../constraints/context";

beforeEach(() => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
});

const schema = {
  type: "object",
  properties: { name: { type: "string", title: "Name" }, code: { type: "string" } },
} as const;
const renderBuilder = () => render(<SchemaProvider initialSchema={schema}><PluginsProvider><SchemaBuilder /></PluginsProvider></SchemaProvider>);

it("names the Add dialog, its buttons and the Type placeholder", async () => {
  const user = userEvent.setup();
  renderBuilder();
  await user.click(screen.getByRole("button", { name: "Add property" }));
  const dialog = screen.getByRole("dialog", { name: "Add property" });
  expect(dialog).toHaveAccessibleDescription("Set the key, type and title. You can add constraints now or after it's created.");
  expect(within(dialog).getByRole("button", { name: "Add property" })).toBeInTheDocument();
  expect(within(dialog).getByRole("combobox", { name: "Select type" })).toHaveTextContent("Select a type");
});

it("names the Edit dialog after the property title, or its key", async () => {
  const user = userEvent.setup();
  renderBuilder();
  await user.click(screen.getAllByRole("button", { name: "Edit constraints" })[0]!);
  expect(screen.getByRole("dialog", { name: "Edit Name" })).toHaveAccessibleDescription("Set a default value and constraints.");
  await user.keyboard("{Escape}");
  await user.click(screen.getAllByRole("button", { name: "Edit constraints" })[1]!);
  expect(screen.getByRole("dialog", { name: "Edit code" })).toBeInTheDocument();
});

it("names a missing Items of type", async () => {
  const user = userEvent.setup();
  renderBuilder();
  await user.click(screen.getByRole("button", { name: /^add property$/i }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name: "Select type" }));
  await user.click(screen.getByRole("option", { name: "array" }));
  fireEvent.submit(screen.getByTestId("add-property-form"));
  const section = within(dialog).getByRole("combobox", { name: "Select items of type" }).closest("div");
  expect(await within(section!).findByText("Type is required")).toBeInTheDocument();
});
