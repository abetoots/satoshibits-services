import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnumEditor } from "@/packages/builder/enum-editor";

// Mock PointerEvent for Radix UI components
class MockPointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  pointerType: string;
  constructor(type: string, props: PointerEventInit) {
    super(type, props);
    this.button = props.button ?? 0;
    this.ctrlKey = props.ctrlKey ?? false;
    this.pointerType = props.pointerType ?? "mouse";
  }
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
window.PointerEvent = MockPointerEvent as any;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

describe("EnumEditor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Basic Rendering", () => {
    it("renders with default empty values", () => {
      render(<EnumEditor />);
      expect(screen.getByText("Enum Values Editor")).toBeInTheDocument();
      expect(screen.getByText("No values added yet")).toBeInTheDocument();
    });

    it("renders with initial values", async () => {
      render(<EnumEditor initialValues={["test", 123, true]} />);

      // Wait for the values to be rendered
      await waitFor(() => {
        expect(screen.getByText("string")).toBeInTheDocument();
        expect(screen.getByText("test")).toBeInTheDocument();
        expect(screen.getByText("number")).toBeInTheDocument();
        expect(screen.getByText("123")).toBeInTheDocument();
        expect(screen.getByText("boolean")).toBeInTheDocument();
        expect(screen.getByText("true")).toBeInTheDocument();
      });
    });

    it("renders without card wrapper when showCard is false", () => {
      render(<EnumEditor showCard={false} />);
      expect(screen.queryByText("Enum Values Editor")).not.toBeInTheDocument();
      expect(screen.getByText("Current Enum Values")).toBeInTheDocument();
    });

    it("hides generated schema section when showGeneratedSchema is false", () => {
      render(<EnumEditor showGeneratedSchema={false} />);
      expect(screen.queryByText("Generated Schema")).not.toBeInTheDocument();
    });

    it("shows generated schema section by default", () => {
      render(<EnumEditor />);
      expect(screen.getByText("Generated Schema")).toBeInTheDocument();
    });

    it("displays error message when error prop is provided", () => {
      const error = { code: "ERROR_CODE", message: "This is an error message" };
      render(<EnumEditor error={error} />);
      expect(screen.getByText("This is an error message")).toBeInTheDocument();
    });

    it("disables all interactive elements when disabled prop is true", async () => {
      const user = userEvent.setup();
      render(<EnumEditor disabled={true} />);

      // Check that inputs are disabled
      expect(screen.getByLabelText("String Value")).toBeDisabled();

      // Check that buttons are disabled
      const addButton = screen.getByRole("button", { name: /add enum/i });
      expect(addButton).toBeDisabled();

      // Check clear all button is disabled
      expect(screen.getByText("Clear All").closest("button")).toBeDisabled();

      // Try to add a value (this should fail)
      await user.type(screen.getByLabelText("String Value"), "test");
      await user.click(addButton);

      // Value should not be added
      expect(screen.queryByText("test")).not.toBeInTheDocument();
      expect(screen.getByText("No values added yet")).toBeInTheDocument();
    });
  });

  describe("Tab Filtering", () => {
    it("shows only string tab when propertyType is string", () => {
      render(<EnumEditor propertyType="string" />);
      // Should only see string tab
      expect(screen.getByRole("tab", { name: "String" })).toBeInTheDocument();
      // Other tabs should not be present
      expect(
        screen.queryByRole("tab", { name: "Number" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Boolean" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Null" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Object" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Array" }),
      ).not.toBeInTheDocument();
    });

    it("shows only number tab when propertyType is number", () => {
      render(<EnumEditor propertyType="number" />);
      // Should only see number tab
      expect(screen.getByRole("tab", { name: "Number" })).toBeInTheDocument();
      // Other tabs should not be present
      expect(
        screen.queryByRole("tab", { name: "String" }),
      ).not.toBeInTheDocument();
    });

    it("shows only boolean tab when propertyType is boolean", () => {
      render(<EnumEditor propertyType="boolean" />);
      // Should only see boolean tab
      expect(screen.getByRole("tab", { name: "Boolean" })).toBeInTheDocument();
      // Other tabs should not be present
      expect(
        screen.queryByRole("tab", { name: "String" }),
      ).not.toBeInTheDocument();
    });

    it("shows all tabs when no propertyType is provided", () => {
      render(<EnumEditor />);
      // All tabs should be present
      expect(screen.getByRole("tab", { name: "String" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Number" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Boolean" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Null" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Object" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Array" })).toBeInTheDocument();
    });
  });

  describe("Value Management", () => {
    it("adds string values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // String tab is default
      const input = screen.getByLabelText("String Value");
      await user.type(input, "test string");
      const addButton = screen.getByRole("button", { name: /add enum/i });
      await user.click(addButton);
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      await waitFor(() => {
        expect(
          within(currentEnumValues!).getByText("test string"),
        ).toBeInTheDocument();
      });
    });

    it("adds number values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to number tab
      await user.click(screen.getByRole("tab", { name: "Number" }));
      const input = screen.getByLabelText("Number Value");
      await user.type(input, "42");
      const addButton = screen.getByRole("button", { name: /add enum/i });
      await user.click(addButton);
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      await waitFor(() => {
        expect(within(currentEnumValues!).getByText("42")).toBeInTheDocument();
      });
    });

    it("adds boolean values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to boolean tab
      await user.click(screen.getByRole("tab", { name: "Boolean" }));
      // Toggle true value
      const trueSwitch = screen.getByLabelText("true");
      await user.click(trueSwitch);
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      await waitFor(() => {
        // Check if true value is added, it should be the second one
        expect(
          within(currentEnumValues!).getByText("true"),
        ).toBeInTheDocument();
      });
    });

    it("adds null value", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to null tab
      await user.click(screen.getByRole("tab", { name: "Null" }));
      // Toggle null value
      const nullSwitch = screen.getByLabelText("Include null value");
      await user.click(nullSwitch);
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      await waitFor(() => {
        expect(
          within(currentEnumValues!).getAllByText("null")[1],
        ).toBeInTheDocument();
      });
    });

    it("adds object values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to object tab
      await user.click(screen.getByRole("tab", { name: "Object" }));
      const textarea = screen.getByLabelText("Object Value (JSON)");
      await user.clear(textarea);
      //https://stackoverflow.com/questions/76790750/ignore-braces-as-special-characters-in-userevent-type
      await user.type(textarea, `{{"key":"value"}`);
      const addButton = screen.getByText("Add Object");
      await user.click(addButton);
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      await waitFor(() => {
        expect(
          within(currentEnumValues!).getByText('{"key":"value"}'),
        ).toBeInTheDocument();
      });
    });

    it("adds array values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to array tab
      await user.click(screen.getByRole("tab", { name: "Array" }));
      const textarea = screen.getByLabelText("Array Value (JSON)");
      await user.clear(textarea);
      //https://stackoverflow.com/questions/76790750/ignore-braces-as-special-characters-in-userevent-type
      await user.type(textarea, "[[1,2,3]");
      const addButton = screen.getByText("Add Array");
      await user.click(addButton);
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      await waitFor(() => {
        expect(
          within(currentEnumValues!).getByText("[1,2,3]"),
        ).toBeInTheDocument();
      });
    });

    it("removes values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor initialValues={["test"]} />);
      // Wait for value to be rendered
      await waitFor(() => {
        expect(screen.getByText("test")).toBeInTheDocument();
      });
      const currentEnumValues = screen.getByText(
        "Current Enum Values",
      ).parentElement;
      // Find and click the delete button
      const deleteButton = within(currentEnumValues!).getByRole("button", {
        name: "Remove value",
      });
      await user.click(deleteButton);
      await waitFor(() => {
        expect(screen.queryByText("test")).not.toBeInTheDocument();
        expect(screen.getByText("No values added yet")).toBeInTheDocument();
      });
    });

    it("calls onChange when values change", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<EnumEditor onChange={onChange} />);
      // Add a string value
      const input = screen.getByLabelText("String Value");
      await user.type(input, "test string");
      const addButton = screen.getByRole("button", { name: /add enum/i });
      await user.click(addButton);
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(["test string"]);
      });
    });

    it("calls onSave when save button is clicked", async () => {
      const onSave = vi.fn();
      const user = userEvent.setup();
      render(
        <EnumEditor initialValues={["value1", "value2"]} onSave={onSave} />,
      );
      // Save button should be visible instead of Copy button
      const saveButton = screen.getByRole("button", { name: /save/i });
      await user.click(saveButton);
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({ enum: ["value1", "value2"] });
      });
    });

    it("clears all values", async () => {
      const user = userEvent.setup();
      render(<EnumEditor initialValues={["value1", "value2"]} />);
      await waitFor(() => {
        expect(screen.getByText("value1")).toBeInTheDocument();
        expect(screen.getByText("value2")).toBeInTheDocument();
      });
      const clearButton = screen.getByRole("button", { name: /clear all/i });
      await user.click(clearButton);
      await waitFor(() => {
        expect(screen.queryByText("value1")).not.toBeInTheDocument();
        expect(screen.queryByText("value2")).not.toBeInTheDocument();
        expect(screen.getByText("No values added yet")).toBeInTheDocument();
      });
    });

    it("shows validation errors for invalid object JSON", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to object tab
      await user.click(screen.getByRole("tab", { name: "Object" }));
      // Type invalid JSON
      const textarea = screen.getByLabelText("Object Value (JSON)");
      await user.clear(textarea);
      //https://stackoverflow.com/questions/76790750/ignore-braces-as-special-characters-in-userevent.type
      await user.type(textarea, "{{invalid}");
      const addButton = screen.getByText("Add Object");
      await user.click(addButton);
      // Should show error message
      await waitFor(() => {
        expect(screen.getByText(/invalid json/gi)).toBeInTheDocument();
      });
    });

    it("shows validation errors for invalid array JSON", async () => {
      const user = userEvent.setup();
      render(<EnumEditor />);
      // Switch to array tab
      await user.click(screen.getByRole("tab", { name: "Array" }));
      // Type invalid JSON
      const textarea = screen.getByLabelText("Array Value (JSON)");
      await user.clear(textarea);
      //https://stackoverflow.com/questions/76790750/ignore-braces-as-special-characters-in-userevent.type
      await user.type(textarea, "[[1,2,");
      const addButton = screen.getByText("Add Array");
      await user.click(addButton);
      // Should show error message
      await waitFor(() => {
        expect(screen.getByText(/invalid json/gi)).toBeInTheDocument();
      });
    });
  });
});
