import { createContext, useContext, useMemo, useRef } from "react";
import type { PropsWithChildren, ComponentType } from "react";

import type { JSONSchema7 } from "json-schema";
import { ajv } from "@/packages/builder/utils";
import type { OperationError } from "../builder/shared-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ConstraintRendererProps<T = any> {
  value: T;
  onConstraintChange: (newValue: T) => void;
  onRemoveConstraint: () => void;
  constraintName: string;
  // Is this constraint disabled/readonly
  disabled?: boolean;
  error?: OperationError;
}

export interface ConstraintDefinition {
  /**
   * The unique identifier for the constraint
   */
  name: keyof JSONSchema7;
  label: string;
  /**
   * Types this constraint applies to.
   */
  appliesTo: string[];
  /**
   * Apply JSON schema principles to the constraint.
   */
  schema: JSONSchema7;
  description?: string;
  defaultValue: unknown;
}

export interface Constraint {
  name: ConstraintDefinition["name"];
  value: unknown;
}

export interface BaseJSONSchemaPlugin {
  id: string;
  hooks: {
    registerConstraints?: () => ConstraintDefinition[];
    registerRenderers?: () => Record<
      string,
      ComponentType<ConstraintRendererProps>
    >;
  };
}

interface ContextState {
  constraintDefinitionsMap: Map<string, ConstraintDefinition>;
  constraintRenderersMap: Map<string, ComponentType<ConstraintRendererProps>>;
}

const PluginsContext = createContext<ContextState | undefined>(undefined);

export const PluginsProvider = ({ children }: PropsWithChildren) => {
  // Store references. If you need to trigger a re-render,
  //use the methods in usePluginSystem hook instead
  const constraintDefinitionsRef = useRef<Map<string, ConstraintDefinition>>(
    new Map(),
  );
  const constraintRenderersRef = useRef<
    Map<string, ComponentType<ConstraintRendererProps>>
  >(new Map());

  return (
    <PluginsContext.Provider
      value={{
        constraintDefinitionsMap: constraintDefinitionsRef.current,
        constraintRenderersMap: constraintRenderersRef.current,
      }}
    >
      {children}
    </PluginsContext.Provider>
  );
};

// The main plugin system hook
export function usePluginSystem<TPlugin extends BaseJSONSchemaPlugin>(
  plugins: TPlugin[],
) {
  const context = useContext(PluginsContext);
  if (!context) {
    throw new Error("usePluginSystem must be used within a PluginsProvider");
  }

  const { constraintDefinitionsMap, constraintRenderersMap } = context;

  const memoizedPluginValues = useMemo(() => {
    // Register all plugins
    plugins.forEach((plugin) => {
      // Register constraints
      if (plugin.hooks.registerConstraints) {
        const constraints = plugin.hooks.registerConstraints();
        constraints.forEach((constraint) => {
          constraintDefinitionsMap.set(constraint.name, constraint);
        });
      }

      // Register renderers
      if (plugin.hooks.registerRenderers) {
        const renderers = plugin.hooks.registerRenderers();
        Object.entries(renderers).forEach(([name, component]) => {
          constraintRenderersMap.set(name, component);
        });
      }
    });

    return {
      // Check if a plugin with given ID exists
      hasPlugin(id: string): boolean {
        return plugins.some((plugin) => plugin.id === id);
      },

      // Get a plugin by ID
      getPlugin(id: string): BaseJSONSchemaPlugin | undefined {
        return plugins.find((plugin) => plugin.id === id);
      },
    };
  }, [plugins]);

  return memoizedPluginValues;
}

export const useConstraints = () => {
  const context = useContext(PluginsContext);
  if (!context) {
    throw new Error("useConstraints must be used within a ConstraintsProvider");
  }

  const { constraintDefinitionsMap, constraintRenderersMap } = context;

  const getAllDefinitions = (): ConstraintDefinition[] => {
    return Array.from(constraintDefinitionsMap.values());
  };

  const getConstraintDefinitionsForType = (
    type: string,
  ): ConstraintDefinition[] => {
    const definitions = getAllDefinitions();
    return definitions.filter((definition) =>
      definition.appliesTo.includes(type),
    );
  };

  const getConstraintDefinition = (constraintName: string) => {
    return constraintDefinitionsMap.get(constraintName);
  };

  const getRendererForConstraint = (constraintName: string) => {
    return constraintRenderersMap.get(constraintName);
  };

  const validateConstraintValue = (constraintName: string, value: unknown) => {
    const constraintDefinition = getConstraintDefinition(constraintName);

    if (constraintDefinition) {
      const schema = constraintDefinition.schema;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const validate = ajv.compile<any>(schema);
      const valid = validate(value);

      if (valid) {
        return { status: "success" as const };
      }

      const obj = {
        status: "error" as const,
        code: "invalid" as const,
        message: "Invalid value",
        error: validate.errors,
      };

      return obj satisfies OperationError;
    }

    const obj = {
      status: "error" as const,
      code: "constraint-def-missing" as const,
      message: "Constraint not found",
    };

    return obj satisfies OperationError;
  };

  return {
    getConstraintDefinitionsForType,
    getAllDefinitions,
    getRendererForConstraint,
    getConstraintDefinition,
    validateConstraintValue,
  };
};
