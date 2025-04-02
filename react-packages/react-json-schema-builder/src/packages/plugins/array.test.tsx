// filepath: /home/anon/satoshibits-services/react-packages/react-json-schema-builder/src/packages/plugins/array.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayConstraintPlugin } from "./array";
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

describe("ArrayConstraintPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MinItems Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinItemsRenderer = renderers.minItems!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minItems",
        value: 3,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MinItemsRenderer {...renderProps} />);

      expect(screen.getByLabelText("minItems")).toHaveValue(3);
      expect(screen.getByLabelText("minItems")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }

      const MinItemsRenderer = renderers.minItems!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minItems",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Value must be positive",
        },
      };

      render(<MinItemsRenderer {...renderProps} />);

      const input = screen.getByLabelText("minItems");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinItemsRenderer = renderers.minItems!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minItems",
        value: 0,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MinItemsRenderer {...renderProps} />);

      const input = screen.getByLabelText("minItems");
      await user.clear(input);
      await user.type(input, "5");
      fireEvent.change(input, { target: { value: "5" } });

      expect(onConstraintChange).toHaveBeenCalledWith(5);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinItemsRenderer = renderers.minItems!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minItems",
        value: 3,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MinItemsRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("MaxItems Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }

      const MaxItemsRenderer = renderers.maxItems!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxItems",
        value: 10,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MaxItemsRenderer {...renderProps} />);

      expect(screen.getByLabelText("maxItems")).toHaveValue(10);
    });
  });

  describe("UniqueItems Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const UniqueItemsRenderer = renderers.uniqueItems!;

      const renderProps: ConstraintRendererProps<boolean> = {
        constraintName: "uniqueItems",
        value: true,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<UniqueItemsRenderer {...renderProps} />);

      expect(screen.getByLabelText("uniqueItems")).toBeChecked();
    });

    it("calls onConstraintChange when toggled", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = ArrayConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const UniqueItemsRenderer = renderers.uniqueItems!;

      const renderProps: ConstraintRendererProps<boolean> = {
        constraintName: "uniqueItems",
        value: false,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<UniqueItemsRenderer {...renderProps} />);

      await user.click(screen.getByLabelText("uniqueItems"));

      expect(onConstraintChange).toHaveBeenCalledWith(true);
    });
  });
});
