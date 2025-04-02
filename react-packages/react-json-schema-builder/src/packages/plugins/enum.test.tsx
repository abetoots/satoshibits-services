import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnumConstraintPlugin } from "./enum";
import { ConstraintRendererProps } from "@/packages/constraints/context";
import { fail } from "node:assert";

// Mock hooks for context testing
vi.mock("@/packages/constraints/context", async () => {
  const actual = await vi.importActual("@/packages/constraints/context");
  return {
    ...actual,
    useConstraints: () => ({
      getConstraintDefinition: (name: string) => ({
        name,
        description: `Description for ${name}`,
      }),
    }),
  };
});

// Mock for HTMLElement extensions needed for Radix UI components
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

describe("EnumConstraintPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Enum Renderer", () => {
    it("renders with the correct title and initial values", () => {
      const renderers = EnumConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const EnumRenderer = renderers.enum!;

      const mockValue = ["red", "green", "blue"];

      const renderProps: ConstraintRendererProps<unknown[]> = {
        constraintName: "enum",
        value: mockValue,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };
      render(<EnumRenderer {...renderProps} />);

      // Check the component title is rendered
      expect(screen.getByText("Enum Values")).toBeInTheDocument();

      // Verify values are displayed
      mockValue.forEach((value) => {
        expect(screen.getByText(String(value))).toBeInTheDocument();
      });
    });

    it("displays error message when error is provided", () => {
      const renderers = EnumConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const EnumRenderer = renderers.enum!;

      const renderProps: ConstraintRendererProps<unknown[]> = {
        constraintName: "enum",
        value: [],
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Error message for testing",
        },
      };
      render(<EnumRenderer {...renderProps} />);

      // Error message should be displayed
      expect(screen.getByText("Error message for testing")).toBeInTheDocument();
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = EnumConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const EnumRenderer = renderers.enum!;

      const renderProps: ConstraintRendererProps<unknown[]> = {
        constraintName: "enum",
        value: [],
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };
      render(<EnumRenderer {...renderProps} />);

      // Click the remove constraint button
      await user.click(screen.getByRole("button", { name: /remove/i }));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });

    it("applies property type filtering when specified", () => {
      const renderers = EnumConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const EnumRenderer = renderers.enum!;

      const renderProps: ConstraintRendererProps<unknown[]> = {
        constraintName: "enum",
        value: [],
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        propertyType: "string",
      };
      render(<EnumRenderer {...renderProps} />);

      // Only string tab should be visible, number and boolean tabs should not be
      expect(screen.getByRole("tab", { name: "String" })).toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Number" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Boolean" }),
      ).not.toBeInTheDocument();
    });
  });
});
