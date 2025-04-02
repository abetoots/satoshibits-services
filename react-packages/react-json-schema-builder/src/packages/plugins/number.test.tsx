import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberConstraintPlugin } from "./number";
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

describe("NumberConstraintPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Minimum Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinimumRenderer = renderers.minimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minimum",
        value: 5,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MinimumRenderer {...renderProps} />);

      expect(screen.getByText("minimum")).toBeInTheDocument();
      expect(screen.getByLabelText("minimum")).toHaveValue(5);
      expect(screen.getByLabelText("minimum")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinimumRenderer = renderers.minimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minimum",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Error message for testing",
        },
      };

      render(<MinimumRenderer {...renderProps} />);

      const input = screen.getByLabelText("minimum");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinimumRenderer = renderers.minimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minimum",
        value: 5,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MinimumRenderer {...renderProps} />);

      const input = screen.getByLabelText("minimum");
      await user.clear(input);
      await user.type(input, "10");
      fireEvent.change(input, { target: { value: "10" } });

      expect(onConstraintChange).toHaveBeenCalledWith(10);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinimumRenderer = renderers.minimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minimum",
        value: 5,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MinimumRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("Maximum Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaximumRenderer = renderers.maximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maximum",
        value: 100,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MaximumRenderer {...renderProps} />);

      expect(screen.getByText("maximum")).toBeInTheDocument();
      expect(screen.getByLabelText("maximum")).toHaveValue(100);
      expect(screen.getByLabelText("maximum")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaximumRenderer = renderers.maximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maximum",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Error message for testing",
        },
      };

      render(<MaximumRenderer {...renderProps} />);

      const input = screen.getByLabelText("maximum");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaximumRenderer = renderers.maximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maximum",
        value: 100,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MaximumRenderer {...renderProps} />);

      const input = screen.getByLabelText("maximum");
      await user.clear(input);
      await user.type(input, "200");
      fireEvent.change(input, { target: { value: "200" } });

      expect(onConstraintChange).toHaveBeenCalledWith(200);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaximumRenderer = renderers.maximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maximum",
        value: 100,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MaximumRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("ExclusiveMinimum Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMinimumRenderer = renderers.exclusiveMinimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMinimum",
        value: 0,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<ExclusiveMinimumRenderer {...renderProps} />);

      expect(screen.getByText("exclusiveMinimum")).toBeInTheDocument();
      expect(screen.getByLabelText("exclusiveMinimum")).toHaveValue(0);
      expect(screen.getByLabelText("exclusiveMinimum")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMinimumRenderer = renderers.exclusiveMinimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMinimum",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Error message for testing",
        },
      };

      render(<ExclusiveMinimumRenderer {...renderProps} />);

      const input = screen.getByLabelText("exclusiveMinimum");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMinimumRenderer = renderers.exclusiveMinimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMinimum",
        value: 0,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<ExclusiveMinimumRenderer {...renderProps} />);

      const input = screen.getByLabelText("exclusiveMinimum");
      await user.clear(input);
      await user.type(input, "5");
      fireEvent.change(input, { target: { value: "5" } });

      expect(onConstraintChange).toHaveBeenCalledWith(5);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMinimumRenderer = renderers.exclusiveMinimum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMinimum",
        value: 0,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<ExclusiveMinimumRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("ExclusiveMaximum Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMaximumRenderer = renderers.exclusiveMaximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMaximum",
        value: 50,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<ExclusiveMaximumRenderer {...renderProps} />);

      expect(screen.getByText("exclusiveMaximum")).toBeInTheDocument();
      expect(screen.getByLabelText("exclusiveMaximum")).toHaveValue(50);
      expect(screen.getByLabelText("exclusiveMaximum")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMaximumRenderer = renderers.exclusiveMaximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMaximum",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Error message for testing",
        },
      };

      render(<ExclusiveMaximumRenderer {...renderProps} />);

      const input = screen.getByLabelText("exclusiveMaximum");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMaximumRenderer = renderers.exclusiveMaximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMaximum",
        value: 50,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<ExclusiveMaximumRenderer {...renderProps} />);

      const input = screen.getByLabelText("exclusiveMaximum");
      await user.clear(input);
      await user.type(input, "100");
      fireEvent.change(input, { target: { value: "100" } });

      expect(onConstraintChange).toHaveBeenCalledWith(100);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const ExclusiveMaximumRenderer = renderers.exclusiveMaximum!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "exclusiveMaximum",
        value: 50,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<ExclusiveMaximumRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("MultipleOf Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MultipleOfRenderer = renderers.multipleOf!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "multipleOf",
        value: 2,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MultipleOfRenderer {...renderProps} />);

      expect(screen.getByText("multipleOf")).toBeInTheDocument();
      expect(screen.getByLabelText("multipleOf")).toHaveValue(2);
      expect(screen.getByLabelText("multipleOf")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MultipleOfRenderer = renderers.multipleOf!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "multipleOf",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Value must be positive",
        },
      };

      render(<MultipleOfRenderer {...renderProps} />);

      const input = screen.getByLabelText("multipleOf");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MultipleOfRenderer = renderers.multipleOf!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "multipleOf",
        value: 2,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MultipleOfRenderer {...renderProps} />);

      const input = screen.getByLabelText("multipleOf");
      await user.clear(input);
      await user.type(input, "5");
      fireEvent.change(input, { target: { value: "5" } });

      expect(onConstraintChange).toHaveBeenCalledWith(5);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = NumberConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MultipleOfRenderer = renderers.multipleOf!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "multipleOf",
        value: 2,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MultipleOfRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });
});
