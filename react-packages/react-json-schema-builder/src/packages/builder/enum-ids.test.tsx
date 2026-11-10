import { expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnumEditor } from "@/packages/builder/enum-editor";

it("gives each enum editor its own label targets (N2)", async () => {
  const user = userEvent.setup();
  const { container, getAllByTestId } = render(<><div data-testid="editor"><EnumEditor /></div><div data-testid="editor"><EnumEditor /></div></>);
  const editors = getAllByTestId("editor");
  const ids: string[] = [];
  for (const [tab, labels] of [
    ["String", ["String Value"]], ["Number", ["Number Value"]],
    ["Boolean", ["true", "false"]], ["Null", ["Include null value"]],
    ["Object", ["Object Value (JSON)"]], ["Array", ["Array Value (JSON)"]],
  ] as const) {
    for (const editor of editors) {
      await user.click(within(editor).getByRole("tab", { name: tab }));
      for (const label of labels) ids.push(within(editor).getByLabelText(label).id);
    }
    const mountedIds = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(mountedIds).size).toBe(mountedIds.length);
  }
  expect(ids).toHaveLength(14);
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(14);
});
