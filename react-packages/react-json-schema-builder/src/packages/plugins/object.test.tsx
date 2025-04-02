import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectConstraintPlugin } from "./object";
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

describe("ObjectConstraintPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MinProperties Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinPropertiesRenderer = renderers.minProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minProperties",
        value: 1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MinPropertiesRenderer {...renderProps} />);

      expect(screen.getByText("minProperties")).toBeInTheDocument();
      expect(screen.getByLabelText("minProperties")).toHaveValue(1);
      expect(screen.getByLabelText("minProperties")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinPropertiesRenderer = renderers.minProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minProperties",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Value must be positive",
        },
      };

      render(<MinPropertiesRenderer {...renderProps} />);

      const input = screen.getByLabelText("minProperties");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinPropertiesRenderer = renderers.minProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minProperties",
        value: 1,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MinPropertiesRenderer {...renderProps} />);

      const input = screen.getByLabelText("minProperties");
      await user.clear(input);
      await user.type(input, "5");
      fireEvent.change(input, { target: { value: "5" } });

      expect(onConstraintChange).toHaveBeenCalledWith(5);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinPropertiesRenderer = renderers.minProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minProperties",
        value: 1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MinPropertiesRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("MaxProperties Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxPropertiesRenderer = renderers.maxProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxProperties",
        value: 10,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MaxPropertiesRenderer {...renderProps} />);

      expect(screen.getByText("maxProperties")).toBeInTheDocument();
      expect(screen.getByLabelText("maxProperties")).toHaveValue(10);
      expect(screen.getByLabelText("maxProperties")).toHaveAttribute(
        "type",
        "number",
      );
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxPropertiesRenderer = renderers.maxProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxProperties",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          code: "invalid",
          message: "Value must be positive",
        },
      };

      render(<MaxPropertiesRenderer {...renderProps} />);

      const input = screen.getByLabelText("maxProperties");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxPropertiesRenderer = renderers.maxProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxProperties",
        value: 10,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MaxPropertiesRenderer {...renderProps} />);

      const input = screen.getByLabelText("maxProperties");
      await user.clear(input);
      await user.type(input, "20");
      fireEvent.change(input, { target: { value: "20" } });

      expect(onConstraintChange).toHaveBeenCalledWith(20);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = ObjectConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxPropertiesRenderer = renderers.maxProperties!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxProperties",
        value: 10,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MaxPropertiesRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });
});
