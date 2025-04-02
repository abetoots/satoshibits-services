import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StringConstraintPlugin } from "./string";
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

describe("StringConstraintPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MinLength Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinLengthRenderer = renderers.minLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minLength",
        value: 5,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MinLengthRenderer {...renderProps} />);

      expect(screen.getByText("minLength")).toBeInTheDocument();
      expect(screen.getByLabelText("minLength")).toHaveValue(5);
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinLengthRenderer = renderers.minLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minLength",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          message: "Value must be non-negative",
          code: "invalid",
        },
      };

      render(<MinLengthRenderer {...renderProps} />);

      const input = screen.getByLabelText("minLength");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinLengthRenderer = renderers.minLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minLength",
        value: 5,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MinLengthRenderer {...renderProps} />);

      const input = screen.getByLabelText("minLength");
      await user.clear(input);
      await user.type(input, "10");
      fireEvent.change(input, { target: { value: "10" } });

      expect(onConstraintChange).toHaveBeenCalledWith(10);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MinLengthRenderer = renderers.minLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "minLength",
        value: 5,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MinLengthRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("MaxLength Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxLengthRenderer = renderers.maxLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxLength",
        value: 50,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<MaxLengthRenderer {...renderProps} />);

      expect(screen.getByText("maxLength")).toBeInTheDocument();
      expect(screen.getByLabelText("maxLength")).toHaveValue(50);
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxLengthRenderer = renderers.maxLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxLength",
        value: -1,
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          message: "Value must be non-negative",
          code: "invalid",
        },
      };

      render(<MaxLengthRenderer {...renderProps} />);

      const input = screen.getByLabelText("maxLength");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxLengthRenderer = renderers.maxLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxLength",
        value: 50,
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<MaxLengthRenderer {...renderProps} />);

      const input = screen.getByLabelText("maxLength");
      await user.clear(input);
      await user.type(input, "100");
      fireEvent.change(input, { target: { value: "100" } });

      expect(onConstraintChange).toHaveBeenCalledWith(100);
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const MaxLengthRenderer = renderers.maxLength!;

      const renderProps: ConstraintRendererProps<number> = {
        constraintName: "maxLength",
        value: 50,
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<MaxLengthRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("Pattern Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const PatternRenderer = renderers.pattern!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "pattern",
        value: "^[a-z]+$",
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<PatternRenderer {...renderProps} />);

      expect(screen.getByText("pattern")).toBeInTheDocument();
      expect(screen.getByLabelText("pattern")).toHaveValue("^[a-z]+$");
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const PatternRenderer = renderers.pattern!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "pattern",
        value: "[", // Invalid regex pattern
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          message: "Invalid regular expression",
          code: "invalid",
        },
      };

      render(<PatternRenderer {...renderProps} />);

      const input = screen.getByLabelText("pattern");
      expect(input).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when value changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const PatternRenderer = renderers.pattern!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "pattern",
        value: "^[a-z]+$",
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<PatternRenderer {...renderProps} />);

      const input = screen.getByLabelText("pattern");
      await user.clear(input);
      //https://stackoverflow.com/questions/76790750/ignore-braces-as-special-characters-in-userevent-type
      await user.type(input, "{^}[[A-Z]+$");
      fireEvent.change(input, { target: { value: "^[A-Z]+$" } });

      expect(onConstraintChange).toHaveBeenCalledWith("^[A-Z]+$");
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const PatternRenderer = renderers.pattern!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "pattern",
        value: "^[a-z]+$",
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<PatternRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });

  describe("Format Renderer", () => {
    it("renders with the correct value", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const FormatRenderer = renderers.format!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "format",
        value: "email",
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
      };

      render(<FormatRenderer {...renderProps} />);

      expect(screen.getByLabelText("format")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveTextContent(/email/i);
      expect(screen.getByRole("button")).toBeInTheDocument(); // Remove button
    });

    it("shows error styling when error is present", () => {
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const FormatRenderer = renderers.format!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "format",
        value: "invalid-format",
        onConstraintChange: vi.fn(),
        onRemoveConstraint: vi.fn(),
        error: {
          message: "Invalid format value",
          code: "invalid",
        },
      };

      render(<FormatRenderer {...renderProps} />);

      const trigger = screen.getByRole("combobox");
      expect(trigger).toHaveClass("border-destructive");
    });

    it("calls onConstraintChange when selection changes", async () => {
      const user = userEvent.setup();
      const onConstraintChange = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const FormatRenderer = renderers.format!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "format",
        value: "email",
        onConstraintChange,
        onRemoveConstraint: vi.fn(),
      };

      render(<FormatRenderer {...renderProps} />);

      await user.click(screen.getByRole("combobox"));
      await user.click(screen.getByText("URL"));

      expect(onConstraintChange).toHaveBeenCalledWith("url");
    });

    it("calls onRemoveConstraint when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemoveConstraint = vi.fn();
      const renderers = StringConstraintPlugin.hooks.registerRenderers?.();
      if (!renderers) {
        fail("Renderers should not be undefined");
      }
      const FormatRenderer = renderers.format!;

      const renderProps: ConstraintRendererProps<string> = {
        constraintName: "format",
        value: "email",
        onConstraintChange: vi.fn(),
        onRemoveConstraint,
      };

      render(<FormatRenderer {...renderProps} />);

      await user.click(screen.getByRole("button"));

      expect(onRemoveConstraint).toHaveBeenCalled();
    });
  });
});
