import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, renderHook } from "@testing-library/react";
import {
  PluginsProvider,
  usePluginSystem,
  useConstraints,
  BaseJSONSchemaPlugin,
} from "./context";
import * as React from "react";
import { ajv } from "@/packages/builder/utils";

// Create proper mocks
vi.mock("@/packages/builder/utils", () => ({
  ajv: {
    compile: vi.fn(),
  },
}));

// Test helpers
const createMockPlugin = (overrides = {}) => {
  const defaultConstraint = {
    name: "minimum" as const,
    label: "Minimum",
    appliesTo: ["number"],
    schema: { type: "number" },
    defaultValue: 0,
  };

  const defaultRenderer = () => (
    <div data-testid="mock-renderer">Mock Renderer</div>
  );

  return {
    id: "test-plugin",
    hooks: {
      registerConstraints: vi.fn().mockReturnValue([defaultConstraint]),
      registerRenderers: vi.fn().mockReturnValue({
        minimum: defaultRenderer,
      }),
    },
    ...overrides,
  } as BaseJSONSchemaPlugin;
};

// Wrapper component for hooks testing
const TestWrapper = ({
  children,
  plugins = [],
}: {
  children: React.ReactNode;
  plugins?: BaseJSONSchemaPlugin[];
}) => (
  <PluginsProvider>
    {plugins.length > 0 ? (
      <PluginInitializer plugins={plugins}>{children}</PluginInitializer>
    ) : (
      children
    )}
  </PluginsProvider>
);

// Helper component to initialize plugins
const PluginInitializer = ({
  children,
  plugins,
}: {
  children: React.ReactNode;
  plugins: BaseJSONSchemaPlugin[];
}) => {
  usePluginSystem(plugins);
  return <>{children}</>;
};

describe("Constraint Context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("PluginsProvider", () => {
    it("renders children correctly", () => {
      render(
        <PluginsProvider>
          <div data-testid="child">Test Child</div>
        </PluginsProvider>,
      );

      expect(screen.getByTestId("child")).toHaveTextContent("Test Child");
    });

    it("throws an error when context is accessed outside provider", () => {
      // Spy on console.error to prevent it from cluttering the test output
      const consoleErrorSpy = vi.spyOn(console, "error");
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      consoleErrorSpy.mockImplementation(() => {});

      expect(() => {
        renderHook(() => usePluginSystem([]));
      }).toThrow("usePluginSystem must be used within a PluginsProvider");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("usePluginSystem", () => {
    it("registers plugins and makes them available", () => {
      const mockPlugin = createMockPlugin();
      const mockPlugin2 = createMockPlugin({ id: "second-plugin" });

      const { result } = renderHook(
        () => usePluginSystem([mockPlugin, mockPlugin2]),
        {
          wrapper: PluginsProvider,
        },
      );

      expect(result.current.hasPlugin("test-plugin")).toBe(true);
      expect(result.current.hasPlugin("second-plugin")).toBe(true);
      expect(result.current.hasPlugin("non-existent")).toBe(false);
      expect(result.current.getPlugin("test-plugin")).toBe(mockPlugin);
    });

    it("calls plugin hook methods during registration", () => {
      const mockPlugin = createMockPlugin();

      renderHook(() => usePluginSystem([mockPlugin]), {
        wrapper: PluginsProvider,
      });

      expect(mockPlugin.hooks.registerConstraints).toHaveBeenCalled();
      expect(mockPlugin.hooks.registerRenderers).toHaveBeenCalled();
    });
  });

  describe("useConstraints", () => {
    it("returns empty definitions when no plugins are registered", () => {
      const { result } = renderHook(() => useConstraints(), {
        wrapper: TestWrapper,
      });

      expect(result.current.getAllDefinitions()).toEqual([]);
      expect(result.current.getConstraintDefinitionsForType("number")).toEqual(
        [],
      );
      expect(
        result.current.getRendererForConstraint("minimum"),
      ).toBeUndefined();
    });

    it("returns constraint definitions registered by plugins", () => {
      const mockPlugin = createMockPlugin();

      const { result } = renderHook(() => useConstraints(), {
        wrapper: (props) => <TestWrapper plugins={[mockPlugin]} {...props} />,
      });

      expect(result.current.getAllDefinitions()).toHaveLength(1);
      expect(result.current.getAllDefinitions()[0]?.name).toBe("minimum");
      expect(result.current.getConstraintDefinition("minimum")).toBeDefined();
      expect(result.current.getConstraintDefinition("minimum")?.name).toBe(
        "minimum",
      );
    });

    it("filters constraints by type correctly", () => {
      const stringConstraint = {
        name: "pattern" as const,
        label: "Pattern",
        appliesTo: ["string"],
        schema: { type: "string" },
        defaultValue: "",
      };

      const mockPlugin = createMockPlugin({
        hooks: {
          registerConstraints: vi.fn().mockReturnValue([
            {
              name: "minimum" as const,
              label: "Minimum",
              appliesTo: ["number"],
              schema: { type: "number" },
              defaultValue: 0,
            },
            stringConstraint,
          ]),
          registerRenderers: vi.fn().mockReturnValue({
            minimum: () => <div>Minimum</div>,
            pattern: () => <div>Pattern</div>,
          }),
        },
      });

      const { result } = renderHook(() => useConstraints(), {
        wrapper: (props) => <TestWrapper plugins={[mockPlugin]} {...props} />,
      });

      expect(
        result.current.getConstraintDefinitionsForType("number"),
      ).toHaveLength(1);
      expect(
        result.current.getConstraintDefinitionsForType("number")[0]?.name,
      ).toBe("minimum");

      expect(
        result.current.getConstraintDefinitionsForType("string"),
      ).toHaveLength(1);
      expect(
        result.current.getConstraintDefinitionsForType("string")[0]?.name,
      ).toBe("pattern");

      expect(result.current.getConstraintDefinitionsForType("boolean")).toEqual(
        [],
      );
    });

    it("returns the correct renderer for a constraint", () => {
      const mockPlugin = createMockPlugin();

      const { result } = renderHook(() => useConstraints(), {
        wrapper: (props) => <TestWrapper plugins={[mockPlugin]} {...props} />,
      });

      const renderer = result.current.getRendererForConstraint("minimum");
      expect(renderer).toBeDefined();

      // Test the renderer itself
      const { getByTestId } = render(React.createElement(renderer as React.FC));
      expect(getByTestId("mock-renderer")).toBeInTheDocument();
    });

    describe("validateConstraintValue", () => {
      it("validates a constraint value successfully", () => {
        // Setup mock for successful validation
        const mockValidate = vi.fn().mockReturnValue(true);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (ajv.compile as any).mockReturnValue(mockValidate);

        const mockPlugin = createMockPlugin();

        const { result } = renderHook(() => useConstraints(), {
          wrapper: (props) => <TestWrapper plugins={[mockPlugin]} {...props} />,
        });

        const validationResult = result.current.validateConstraintValue(
          "minimum",
          5,
        );

        expect(mockValidate).toHaveBeenCalledWith(5);
        expect(validationResult).toEqual({ status: "success" });
      });

      it("returns an error for invalid constraint values", () => {
        // Setup mock for failed validation
        const mockValidate = vi.fn().mockReturnValue(false);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        mockValidate.errors = [{ message: "Must be a number" }];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (ajv.compile as any).mockReturnValue(mockValidate);

        const mockPlugin = createMockPlugin();

        const { result } = renderHook(() => useConstraints(), {
          wrapper: (props) => <TestWrapper plugins={[mockPlugin]} {...props} />,
        });

        const validationResult = result.current.validateConstraintValue(
          "minimum",
          "not a number",
        );

        expect(validationResult.status).toBe("error");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        expect(validationResult.code).toBe("invalid");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        expect(validationResult.error).toEqual(mockValidate.errors);
      });

      it("returns an error for non-existent constraint", () => {
        const mockPlugin = createMockPlugin();

        const { result } = renderHook(() => useConstraints(), {
          wrapper: (props) => <TestWrapper plugins={[mockPlugin]} {...props} />,
        });

        const validationResult = result.current.validateConstraintValue(
          "nonExistentConstraint",
          5,
        );

        expect(validationResult.status).toBe("error");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        expect(validationResult.code).toBe("constraint-def-missing");
      });
    });

    it("throws error when used outside provider", () => {
      const consoleErrorSpy = vi.spyOn(console, "error");
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      consoleErrorSpy.mockImplementation(() => {});

      expect(() => {
        renderHook(() => useConstraints());
      }).toThrow("useConstraints must be used within a ConstraintsProvider");

      consoleErrorSpy.mockRestore();
    });
  });
});
