import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONSchema7 } from "json-schema";
import { describe, expect, it, vi } from "vitest";
import { PluginsProvider } from "../constraints/context";
import { SchemaProvider } from "./context";
import { SchemaBuilder } from "./schema-builder";

describe("Edit dialog lifecycle", () => {
  it.each([
    ["missing", { type: "string" }],
    ["empty", { type: "string", title: "" }],
  ] as const)("saves the Edit dialog for a property whose title is %s", async (_title, property) => {
    const user = userEvent.setup();
    const onSchemaChange = vi.fn();
    const schema: JSONSchema7 = { type: "object", properties: { code: property } };
    render(
      <SchemaProvider initialSchema={schema}>
        <PluginsProvider>
          <SchemaBuilder onSchemaChange={onSchemaChange} />
        </PluginsProvider>
      </SchemaProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Edit constraints" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Default Value"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const updated = onSchemaChange.mock.calls.at(-1)?.[0] as JSONSchema7;
    expect(updated.properties?.code).toMatchObject({ ...property, default: "x" });
    if (_title === "missing") expect(updated.properties?.code).not.toHaveProperty("title");
  });
});
