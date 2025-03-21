import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type PropertyComponentProps, SchemaBuilder } from "./schema-builder";
import { SchemaProvider } from "./context";
import { PluginsProvider } from "../constraints/context";
import { JSONSchema7 } from "json-schema";
import numberPlugin from "../plugins/number";
import stringPlugin from "../plugins/string";
import arrayPlugin from "../plugins/array";
import objectPlugin from "../plugins/object";
import { type PropsWithChildren } from "react";
import { fail } from "node:assert";
import { createTestSchema } from "./utils";

// Wrapper component to provide necessary context
const TestWrapper = ({
  children,
  initialSchema,
}: PropsWithChildren<{ initialSchema?: JSONSchema7 }>) => (
  <SchemaProvider initialSchema={initialSchema}>
    <PluginsProvider>{children}</PluginsProvider>
  </SchemaProvider>
);

describe("SchemaBuilder", () => {
  // Setup before each test
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Basic Rendering", () => {
    it("renders with default schema when no schema is provided", () => {
      render(
        <TestWrapper>
          <SchemaBuilder />
        </TestWrapper>,
      );

      expect(screen.getByText("Add Property")).toBeInTheDocument();
      expect(screen.getByText("Root")).toBeInTheDocument();
    });

    it("renders with provided schema to the builder", () => {
      render(
        <TestWrapper initialSchema={createTestSchema()}>
          <SchemaBuilder initialSchema={createTestSchema()} />
        </TestWrapper>,
      );

      // Check properties from test schema
      expect(screen.getByDisplayValue("name")).toBeInTheDocument();
      expect(screen.getByDisplayValue("age")).toBeInTheDocument();
      expect(screen.getByDisplayValue("address")).toBeInTheDocument();
      expect(screen.getByDisplayValue("tags")).toBeInTheDocument();
    });

    it("renders with provided schema to the provider", () => {
      render(
        <TestWrapper initialSchema={createTestSchema()}>
          <SchemaBuilder />
        </TestWrapper>,
      );

      // Check properties from test schema
      expect(screen.getByDisplayValue("name")).toBeInTheDocument();
      expect(screen.getByDisplayValue("age")).toBeInTheDocument();
      expect(screen.getByDisplayValue("address")).toBeInTheDocument();
      expect(screen.getByDisplayValue("tags")).toBeInTheDocument();
    });

    it("shows validation errors when schema is invalid", () => {
      const invalidSchema: JSONSchema7 = createTestSchema({
        properties: {
          ...createTestSchema().properties,
          invalidProp: {
            // Invalid type
            type: "invalid-type",
          },
        },
      });

      render(
        <TestWrapper>
          <SchemaBuilder initialSchema={invalidSchema} />
        </TestWrapper>,
      );

      expect(screen.getByText(/Schema validation error/i)).toBeInTheDocument();
    });
  });

  describe("Navigation", () => {
    it("navigates to nested object property", async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper>
          <SchemaBuilder initialSchema={createTestSchema()} />
        </TestWrapper>,
      );

      // Find address property's parent row
      const addressRow = screen
        .getByDisplayValue("address")
        .closest("div")?.parentElement;

      expect(addressRow).not.toBeNull();

      // Click navigate button
      const navigateButton = within(addressRow!).getByRole("button", {
        name: /navigate/i,
      });
      await user.click(navigateButton);

      // Verify breadcrumb path and nested properties
      expect(screen.getByText("Root")).toBeInTheDocument();
      expect(screen.getByText("address")).toBeInTheDocument();
      expect(screen.getByDisplayValue("street")).toBeInTheDocument();
      expect(screen.getByDisplayValue("city")).toBeInTheDocument();
    });

    it("navigates back using the back button", async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper initialSchema={createTestSchema()}>
          <SchemaBuilder initialSchema={createTestSchema()} />
        </TestWrapper>,
      );

      // Find address property's parent row
      const addressRow = screen
        .getByDisplayValue("address")
        .closest("div")?.parentElement;
      expect(addressRow).not.toBeNull();

      const navigateButton = within(addressRow!).getByRole("button", {
        name: /navigate/i,
      });
      await user.click(navigateButton);

      // Should show nested address properties
      expect(screen.getByDisplayValue("street")).toBeInTheDocument();

      // Click back button
      const backButton = screen.getByRole("button", { name: /back/i });
      await user.click(backButton);

      // Should be back at root
      expect(screen.queryByDisplayValue("street")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("name")).toBeInTheDocument();
    });

    it("navigates using breadcrumbs", async () => {
      const user = userEvent.setup();

      render(
        <TestWrapper initialSchema={createTestSchema()}>
          <SchemaBuilder initialSchema={createTestSchema()} />
        </TestWrapper>,
      );

      // Find address property's parent row
      const addressRow = screen
        .getByDisplayValue("address")
        .closest("div")?.parentElement;
      expect(addressRow).not.toBeNull();

      const navigateButton = within(addressRow!).getByRole("button", {
        name: /navigate/i,
      });
      await user.click(navigateButton);

      // Click Root breadcrumb
      await user.click(screen.getByText("Root"));

      // Should be back at root level
      expect(screen.queryByDisplayValue("street")).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("name")).toBeInTheDocument();
    });
  });

  //Fixes unable to open select
  //https://github.com/joaom00/radix-select-vitest/blob/main/src/Select.test.tsx
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
  //   window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();

  describe("Property Management", () => {
    describe("Adding Properties", () => {
      it("opens property dialog when add property button is clicked", async () => {
        const user = userEvent.setup();

        render(
          <TestWrapper>
            <SchemaBuilder />
          </TestWrapper>,
        );

        await user.click(screen.getByText("Add Property"));

        // Dialog should appear
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        // Dialog should have an add property button
        expect(
          screen.getByRole("button", { name: "Add Property" }),
        ).toBeInTheDocument();
      });

      it("adds a new property with complete details", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const onSchemaChange = vi.fn();
        const onPropertyAddSuccess = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              onSchemaChange={onSchemaChange}
              onPropertyAddSuccess={onPropertyAddSuccess}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Open dialog and fill form
        await user.click(screen.getByText("Add Property"));
        const dialog = screen.getByRole("dialog");

        const propertyKeyInput = within(dialog).getByLabelText("Property Key");
        const propertyTitleInput =
          within(dialog).getByLabelText("Property Title");
        const typeSelect = within(dialog).getByRole("combobox", {
          name: /select type/i,
        });
        const requiredSwitch = within(dialog).getByLabelText("Required");
        const descriptionInput = within(dialog).getByLabelText("Description");

        await user.type(propertyKeyInput, "email");
        await user.type(propertyTitleInput, "Email Address");

        await user.click(typeSelect);
        expect(typeSelect).toHaveAttribute("aria-expanded", "true");
        await user.click(screen.getByRole("option", { name: "string" }));
        await user.click(requiredSwitch);
        await user.type(descriptionInput, "Contact email address");

        // Advance timers to allow for a max debounce delay of 500ms
        // Any more than this and the test should fail
        act(() => {
          vi.advanceTimersByTime(500);
        });

        // Submit form
        const form = screen.getByTestId("add-property-form");
        fireEvent.submit(form);

        // Verify callbacks
        await waitFor(() => {
          expect(onPropertyAddSuccess).toHaveBeenCalled();
          expect(onSchemaChange).toHaveBeenCalled();
        });

        // Verify schema updates
        const updatedSchema = onSchemaChange.mock.calls.at(
          -1,
        )?.[0] as JSONSchema7;
        expect(updatedSchema.properties?.email).toBeDefined();
        const email = updatedSchema.properties?.email;
        if (typeof email === "boolean") {
          fail("email is a boolean when it should be an object");
        }
        expect(email?.type).toBe("string");
        expect(email?.title).toBe("Email Address");
        expect(email?.description).toBe("Contact email address");
        expect(updatedSchema.required).toContain("email");
      });

      it("validates required fields in add property form", async () => {
        const user = userEvent.setup();

        render(
          <TestWrapper>
            <SchemaBuilder />
          </TestWrapper>,
        );

        // Open dialog
        await user.click(screen.getByText("Add Property"));

        // Try to submit without filling required fields
        const form = screen.getByTestId("add-property-form");
        fireEvent.submit(form);

        // Form should have triggered
        await waitFor(() => {
          //key
          expect(
            screen.getByText(/Key must be at least 1 character long/i),
          ).toBeInTheDocument();
          //title
          expect(
            screen.getByText(/Title must be at least 1 character long/i),
          ).toBeInTheDocument();
          //type should trigger required
          const typeSection = screen
            .getByRole("combobox", { name: /select type/i })
            .closest("div");
          expect(
            within(typeSection!).getByText(/Required/i),
          ).toBeInTheDocument();
        });
      });
    });

    describe("Updating Properties", () => {
      it("changes property key", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={createTestSchema()}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Get the name input field and change it
        const nameInput = screen.getByDisplayValue("name");
        await user.clear(nameInput);
        expect(nameInput).toHaveValue("");
        await user.type(nameInput, "fullName");
        expect(nameInput).toHaveValue("fullName");
        fireEvent.blur(nameInput);

        // Verify schema update
        await waitFor(() => {
          expect(onSchemaChange).toHaveBeenCalled();
        });

        const updatedSchema = onSchemaChange.mock.calls.at(
          -1,
        )?.[0] as JSONSchema7;

        expect(updatedSchema.properties?.fullName).toBeDefined();
        expect(updatedSchema.properties?.name).toBeUndefined();
        expect(updatedSchema.required).toContain("fullName");
        expect(updatedSchema.required).not.toContain("name");
      });

      it("toggles required state of a property", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={createTestSchema()}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Toggle required state for age property
        const ageRow = screen
          .getByDisplayValue("age")
          .closest("div")?.parentElement;

        expect(ageRow).not.toBeNull();

        const requiredSwitch = within(ageRow!).getByRole("switch");

        await user.click(requiredSwitch);

        // Verify schema update
        await waitFor(() => {
          expect(onSchemaChange).toHaveBeenCalled();
        });

        const updatedSchema = onSchemaChange.mock.calls.at(
          -1,
        )?.[0] as JSONSchema7;
        expect(updatedSchema.required).toContain("age");
      });

      it("changes property type", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={createTestSchema()}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Change age property type from integer to number
        const ageRow = screen
          .getByDisplayValue("age")
          .closest("div")?.parentElement;

        expect(ageRow).not.toBeNull();

        const typeSelect = within(ageRow!).getByRole("combobox", {
          name: /select type/i,
        });

        await user.click(typeSelect);
        await user.click(screen.getByRole("option", { name: "number" }));

        // Verify schema update
        await waitFor(() => {
          expect(onSchemaChange).toHaveBeenCalled();
        });

        const updatedSchema = onSchemaChange.mock.calls.at(
          -1,
        )?.[0] as JSONSchema7;
        const ageProperty = updatedSchema.properties?.age;
        if (typeof ageProperty === "boolean") {
          fail("ageProperty is a boolean when it should be an object");
        }
        expect(ageProperty?.type).toBe("number");
      });

      it("changes property title and description", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={createTestSchema()}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Find inputs for name property
        const nameRow = screen
          .getByDisplayValue("name")
          .closest("div")?.parentElement;
        expect(nameRow).not.toBeNull();
        const inputs = within(nameRow!).getAllByRole("textbox");

        // Find title and description inputs - position depends on component layout
        const titleInput =
          inputs.find((input) =>
            input.getAttribute("name")?.includes("title"),
          ) ?? inputs[1];
        const descriptionInput =
          inputs.find((input) =>
            input.getAttribute("name")?.includes("description"),
          ) ?? inputs[2];

        expect(titleInput).toBeDefined();
        expect(descriptionInput).toBeDefined();

        // Change title
        await user.clear(titleInput!);
        await user.type(titleInput!, "Full Name");
        fireEvent.blur(titleInput!);

        // Change description
        await user.clear(descriptionInput!);
        await user.type(descriptionInput!, "The person's full name");
        fireEvent.blur(descriptionInput!);

        // Verify schema updates
        await waitFor(() => {
          expect(onSchemaChange).toHaveBeenCalledTimes(2);
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedSchema.properties.name?.title).toBe("Full Name");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedSchema.properties.name.description).toBe(
          "The person's full name",
        );
      });

      it("edits constraints using the edit dialog", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        // Create schema with a property that has a minimum constraint
        const schemaWithConstraints = createTestSchema({
          properties: {
            ...createTestSchema().properties,
            score: {
              type: "number",
              title: "Score",
              minimum: 0,
            },
          },
        });

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={schemaWithConstraints}
              plugins={[numberPlugin]}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Find the score property row
        const scoreRow = screen
          .getByDisplayValue("score")
          .closest("div")?.parentElement;
        expect(scoreRow).not.toBeNull();

        // Find and click edit constraint button (with Bolt icon)
        const editButton = within(scoreRow!).getByRole("button", {
          name: /edit constraints/i,
        });
        await user.click(editButton);

        // Dialog should appear
        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeInTheDocument();
        expect(within(dialog).getByText("Constraints")).toBeInTheDocument();

        // Find the minimum input and change its value
        await waitFor(async () => {
          const minimumInput = within(dialog).getByLabelText("minimum");
          await user.type(minimumInput, "10");
          await user.clear(minimumInput);
        });

        // Save the changes, submit the form
        const form = screen.getByTestId("edit-property-form");
        fireEvent.submit(form);

        // Verify schema update
        await waitFor(() => {
          expect(onSchemaChange).toHaveBeenCalled();
        });

        // Check that the schema was updated with the new minimum value
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const scoreProperty = updatedSchema.properties?.score;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(scoreProperty?.minimum).toBe(0);
      });
    });

    describe("Deleting Properties", () => {
      it("deletes a property when delete button is clicked and confirmed", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={createTestSchema()}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Clear the initial call that happens on mount
        onSchemaChange.mockClear();

        // Find and click delete button for age property
        const ageRow = screen
          .getByDisplayValue("age")
          .closest("div")?.parentElement;
        expect(ageRow).not.toBeNull();
        const deleteButton = within(ageRow!).getByRole("button", {
          name: /delete/i,
        });
        await user.click(deleteButton);

        // Confirmation dialog should appear
        const confirmButton = screen.getByRole("button", { name: "Delete" });
        expect(confirmButton).toBeInTheDocument();

        // Confirm deletion
        await user.click(confirmButton);

        // Verify schema update
        await waitFor(() => {
          expect(onSchemaChange).toHaveBeenCalled();
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedSchema.properties.age).toBeUndefined();
      });

      it("cancels property deletion when cancel is clicked", async () => {
        const user = userEvent.setup();
        const onSchemaChange = vi.fn();

        render(
          <TestWrapper>
            <SchemaBuilder
              initialSchema={createTestSchema()}
              onSchemaChange={onSchemaChange}
            />
          </TestWrapper>,
        );

        // Find and click delete button
        const ageRow = screen
          .getByDisplayValue("age")
          .closest("div")?.parentElement;
        expect(ageRow).not.toBeNull();
        const deleteButton = within(ageRow!).getByRole("button", {
          name: /delete/i,
        });
        await user.click(deleteButton);

        // Click cancel in confirmation dialog
        const cancelButton = screen.getByRole("button", { name: /cancel/i });
        await user.click(cancelButton);

        // Verify schema was not updated
        expect(screen.getByDisplayValue("age")).toBeInTheDocument();
      });
    });

    it("duplicates a property", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            initialSchema={createTestSchema()}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      // Clear the initial call that happens on mount
      onSchemaChange.mockClear();

      // Find and click duplicate button for name property
      const nameRow = screen
        .getByDisplayValue("name")
        .closest("div")?.parentElement;
      expect(nameRow).not.toBeNull();
      const duplicateButton = within(nameRow!).getByRole("button", {
        name: /duplicate/i,
      });
      await user.click(duplicateButton);

      // Verify schema update
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.name_copy).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.name_copy.type).toBe("string");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.name_copy.title).toBe("Name");
    });
  });

  describe("Array Items", () => {
    it("handles changes to array item type", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            initialSchema={createTestSchema()}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      // Clear the initial call that happens on mount
      onSchemaChange.mockClear();

      // Find the tags array row
      const tagsRow = screen
        .getByDisplayValue("tags")
        .closest("div")?.parentElement;

      expect(tagsRow).not.toBeNull();

      // Find the type select input. It should be the second combobox in the row
      const typeSelect = within(tagsRow!).getByRole("combobox", {
        name: /select items of type/i,
      });

      // Change item type from string to number
      await user.click(typeSelect);
      await user.click(screen.getByRole("option", { name: "number" }));

      // Verify schema update
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.tags.items.type).toBe("number");
    });

    it("configures array items as objects", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({
        delay: null,
        advanceTimers: vi.advanceTimersByTime,
      });
      const onSchemaChange = vi.fn();
      const onPropertyAddSuccess = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            initialSchema={createTestSchema()}
            onSchemaChange={onSchemaChange}
            onPropertyAddSuccess={onPropertyAddSuccess}
          />
        </TestWrapper>,
      );

      // Clear the initial call that happens on mount
      onSchemaChange.mockClear();

      // Find tags array row
      const tagsRow = screen
        .getByDisplayValue("tags")
        .closest("div")?.parentElement;
      expect(tagsRow).not.toBeNull();

      // Change item type to object. It should be the second combobox in the row
      const typeSelect = within(tagsRow!).getAllByRole("combobox")[1];
      expect(typeSelect).toBeDefined();
      await user.click(typeSelect!);
      await user.click(screen.getByRole("option", { name: "object" }));

      // Verify initial schema update
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // Reset mock to track next updates
      onSchemaChange.mockClear();

      // Navigate to configure the object items
      const configureButton = within(tagsRow!).getByRole("button", {
        name: /navigate/i,
      });
      await user.click(configureButton);

      // Verify breadcrumb path
      const breadcrumb = screen.getByLabelText("breadcrumb");
      // Should show array items breadcrumb
      expect(breadcrumb).toHaveTextContent("tags");

      // Add property to array items object
      await user.click(screen.getByText("Add Property"));
      const dialog = screen.getByRole("dialog");

      const propertyKeyInput = within(dialog).getByLabelText("Property Key");
      const propertyTitleInput =
        within(dialog).getByLabelText("Property Title");
      const itemTypeSelect = within(dialog).getByRole("combobox", {
        name: /select type/i,
      });

      await user.type(propertyKeyInput, "label");
      await user.type(propertyTitleInput, "Label");
      await user.click(itemTypeSelect);
      expect(itemTypeSelect).toHaveAttribute("aria-expanded", "true");
      await user.click(screen.getByRole("option", { name: "string" }));

      // Advance timers to allow for a max debounce delay of 500ms
      // Any more than this and the test should fail
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Submit form
      const form = screen.getByTestId("add-property-form");
      fireEvent.submit(form);

      // Verify final schema update
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const finalSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(finalSchema.properties.tags.items.properties.label).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(finalSchema.properties.tags.items.properties.label.type).toBe(
        "string",
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(finalSchema.properties.tags.items.properties.label.title).toBe(
        "Label",
      );
    });

    it("allows selecting array item type in add property dialog", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();
      const onPropertyAddSuccess = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            onSchemaChange={onSchemaChange}
            onPropertyAddSuccess={onPropertyAddSuccess}
          />
        </TestWrapper>,
      );

      // Clear the initial call that happens on mount
      onSchemaChange.mockClear();

      // Open add property dialog
      await user.click(screen.getByText("Add Property"));
      const dialog = screen.getByRole("dialog");

      // Fill in required fields
      await user.type(
        within(dialog).getByRole("textbox", { name: /property key/i }),
        "testArray",
      );
      await user.type(
        within(dialog).getByRole("textbox", { name: /property title/i }),
        "Test Array",
      );

      // Select array type
      await user.click(
        within(dialog).getByRole("combobox", { name: /select type/i }),
      );
      await user.click(screen.getByRole("option", { name: /array/i }));

      // Verify that items type selector appears when array is selected
      expect(screen.getByText(/items of type/i)).toBeInTheDocument();

      // Select string as items type
      await user.click(
        screen.getByRole("combobox", { name: /items of type/i }),
      );
      await user.click(screen.getByRole("option", { name: /string/i }));

      // Submit the form
      fireEvent.submit(screen.getByTestId("add-property-form"));

      // Verify that onSubmit was called with the correct arguments
      await waitFor(() => {
        expect(onPropertyAddSuccess).toHaveBeenCalled();
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // Check the schema contains the array with proper items type
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.testArray.type).toBe("array");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.testArray.items.type).toBe("string");
    });
  });

  describe("Plugin Integration", () => {
    it("integrates with number constraint plugins", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            plugins={[numberPlugin]}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      onSchemaChange.mockClear();

      // Open add property dialog
      await user.click(screen.getByText("Add Property"));
      const dialog = screen.getByRole("dialog");

      // Add a number property to test constraints
      const propertyKeyInput = within(dialog).getByLabelText("Property Key");
      const propertyTitleInput =
        within(dialog).getByLabelText("Property Title");
      const typeSelect = within(dialog).getByRole("combobox", {
        name: /select type/i,
      });

      await user.type(propertyKeyInput, "score");
      await user.type(propertyTitleInput, "Score");
      await user.click(typeSelect);
      await user.click(screen.getByRole("option", { name: "number" }));

      // Should now show constraint options for number type
      const constraintSection = screen.getByText("Constraints").closest("div");
      const constraintSelect = within(constraintSection!).getByRole(
        "combobox",
        { name: /select constraint/i },
      );

      // Add minimum constraint
      await user.click(constraintSelect);
      await user.click(screen.getByRole("option", { name: "Minimum" }));

      // Click add constraint button
      const addConstraintButton = screen.getByRole("button", {
        name: "Add constraint",
      });
      await user.click(addConstraintButton);

      // Set minimum value
      const minimumInput = screen.getByLabelText("minimum");
      await user.clear(minimumInput);
      await user.type(minimumInput, "10");

      // Submit form
      const form = screen.getByTestId("add-property-form");
      fireEvent.submit(form);

      // Verify schema includes constraint
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.score).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.score.minimum).toBe(10);
    });

    it("integrates with string constraint plugins", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            plugins={[stringPlugin]}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      onSchemaChange.mockClear();

      // Add a string property with minLength constraint
      await user.click(screen.getByText("Add Property"));
      const dialog = screen.getByRole("dialog");

      const propertyKeyInput = within(dialog).getByLabelText("Property Key");
      const propertyTitleInput =
        within(dialog).getByLabelText("Property Title");
      const typeSelect = within(dialog).getByRole("combobox", {
        name: /select type/i,
      });

      await user.type(propertyKeyInput, "username");
      await user.type(propertyTitleInput, "Username");
      await user.click(typeSelect);
      await user.click(screen.getByRole("option", { name: "string" }));

      // Add minLength constraint
      const constraintSection = screen.getByText("Constraints").closest("div");
      await user.click(
        within(constraintSection!).getByRole("combobox", {
          name: /select constraint/i,
        }),
      );
      await user.click(screen.getByRole("option", { name: "Min Length" }));
      await user.click(screen.getByRole("button", { name: "Add constraint" }));

      // Set value to 5
      await user.clear(screen.getByLabelText("minLength"));
      await user.type(screen.getByLabelText("minLength"), "5");

      // Submit the form
      const form = screen.getByTestId("add-property-form");
      fireEvent.submit(form);

      // Verify schema
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.username.minLength).toBe(5);
    });

    it("integrates with array constraint plugins", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            plugins={[arrayPlugin]}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      onSchemaChange.mockClear();

      // Add an array property with uniqueItems constraint
      await user.click(screen.getByText("Add Property"));
      const dialog = screen.getByRole("dialog");

      const propertyKeyInput = within(dialog).getByLabelText("Property Key");
      const propertyTitleInput =
        within(dialog).getByLabelText("Property Title");
      const typeSelect = within(dialog).getByRole("combobox", {
        name: /select type/i,
      });

      await user.type(propertyKeyInput, "categories");
      await user.type(propertyTitleInput, "Categories");
      await user.click(typeSelect);
      await user.click(screen.getByRole("option", { name: "array" }));

      const itemsTypeSelect = within(dialog).getByRole("combobox", {
        name: /select items of type/i,
      });

      await user.click(itemsTypeSelect);
      await user.click(screen.getByRole("option", { name: "string" }));

      // Add uniqueItems constraint
      const constraintSection = screen.getByText("Constraints").closest("div");
      const constraintSelect = within(constraintSection!).getByRole(
        "combobox",
        { name: /select constraint/i },
      );
      await user.click(constraintSelect);
      await user.click(screen.getByRole("option", { name: "Unique Items" }));
      await user.click(screen.getByRole("button", { name: "Add constraint" }));

      // Toggle the switch to true
      await user.click(screen.getByLabelText("uniqueItems"));

      // Submit the form
      fireEvent.submit(screen.getByTestId("add-property-form"));

      // Verify schema
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.categories.uniqueItems).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.categories.items.type).toBe("string");
    });

    it("integrates with object constraint plugins", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            plugins={[objectPlugin]}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      // Add an object property with maxProperties constraint
      await user.click(screen.getByText("Add Property"));
      const dialog = screen.getByRole("dialog");

      const propertyKeyInput = within(dialog).getByLabelText("Property Key");
      const propertyTitleInput =
        within(dialog).getByLabelText("Property Title");
      const typeSelect = within(dialog).getByRole("combobox", {
        name: /select type/i,
      });

      await user.type(propertyKeyInput, "metadata");
      await user.type(propertyTitleInput, "Metadata");
      await user.click(typeSelect);
      //select object type
      await user.click(screen.getByRole("option", { name: "object" }));

      // Add maxProperties constraint
      const constraintSection = screen.getByText("Constraints").closest("div");
      await user.click(
        within(constraintSection!).getByRole("combobox", {
          name: /select constraint/i,
        }),
      );
      await user.click(screen.getByRole("option", { name: "Max Properties" }));
      await user.click(screen.getByRole("button", { name: "Add constraint" }));

      // Set value to 5
      await user.clear(screen.getByLabelText("maxProperties"));
      await user.type(screen.getByLabelText("maxProperties"), "5");

      // Submit the form
      fireEvent.submit(screen.getByTestId("add-property-form"));

      // Verify schema
      await waitFor(() => {
        expect(onSchemaChange).toHaveBeenCalled();
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updatedSchema = onSchemaChange.mock.calls.at(-1)?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedSchema.properties.metadata.maxProperties).toBe(5);
    });

    it("combines multiple constraint plugins", async () => {
      const user = userEvent.setup();
      const onSchemaChange = vi.fn();

      render(
        <TestWrapper>
          <SchemaBuilder
            plugins={[numberPlugin, stringPlugin, arrayPlugin, objectPlugin]}
            onSchemaChange={onSchemaChange}
          />
        </TestWrapper>,
      );

      // Verify all constraint plugins are registered by checking for their constraints
      await user.click(screen.getByText("Add Property"));

      // Select number type to check number constraints
      await user.click(
        within(screen.getByRole("dialog")).getByRole("combobox", {
          name: /select type/i,
        }),
      );
      await user.click(screen.getByRole("option", { name: "number" }));

      // Open constraint dropdown and check for number constraints
      const constraintSection = screen.getByText("Constraints").closest("div");
      await user.click(
        within(constraintSection!).getByRole("combobox", {
          name: /select constraint/i,
        }),
      );

      // Should show options from number plugin
      expect(
        screen.getByRole("option", { name: "Minimum" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Maximum" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Multiple Of" }),
      ).toBeInTheDocument();
    });
  });

  describe("Custom Components", () => {
    it("renders with custom property components", () => {
      // Define custom component
      const CustomPropertyComponent = ({
        property,
      }: PropertyComponentProps) => {
        return <div data-testid="custom-property">{property.key} (Custom)</div>;
      };

      render(
        <TestWrapper initialSchema={createTestSchema()}>
          <SchemaBuilder
            initialSchema={createTestSchema()}
            propertyComponent={CustomPropertyComponent}
          />
        </TestWrapper>,
      );

      // Should use custom components
      const customProperties = screen.getAllByTestId("custom-property");
      expect(customProperties.length).toBeGreaterThan(0);
      expect(customProperties[0]).toHaveTextContent("name (Custom)");
    });

    it("passes correct props to custom components", () => {
      // Define spying component
      const customPropSpy = vi.fn().mockImplementation(() => <div>Custom</div>);

      render(
        <TestWrapper initialSchema={createTestSchema()}>
          <SchemaBuilder
            initialSchema={createTestSchema()}
            propertyComponent={customPropSpy}
          />
        </TestWrapper>,
      );

      // Verify component was called with correct props
      expect(customPropSpy).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const callProps = customPropSpy.mock.calls[0]?.[0];

      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      expect(callProps.property).toBeDefined();
      expect(callProps.onPropertyChange).toBeDefined();
      expect(callProps.onKeyChange).toBeDefined();
      expect(callProps.onDelete).toBeDefined();
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */
    });
  });
});
