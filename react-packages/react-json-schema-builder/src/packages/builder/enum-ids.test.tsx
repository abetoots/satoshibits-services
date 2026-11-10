import { expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EnumEditor } from "@/packages/builder/enum-editor";

it("gives each enum editor its own label targets (N2)", () => {
  const { container } = render(<><EnumEditor /><EnumEditor /></>);
  const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  expect(ids.length).toBeGreaterThan(0);
  expect(duplicates).toEqual([]);
});
