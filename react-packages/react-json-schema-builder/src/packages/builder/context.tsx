import { createContext, useContext, useState } from "react";

import type { PropsWithChildren, SetStateAction } from "react";
import type { JSONSchema7, JSONSchema7Definition } from "json-schema";
import { clone, isEmpty } from "remeda";
import type { OperationError } from "./shared-types";

interface ContextState<T extends JSONSchema7> {
  schema: T;
  setSchema: React.Dispatch<T>;
  path: string[];
  setPath: React.Dispatch<SetStateAction<string[]>>;
}

export const SchemaContext = createContext<
  ContextState<JSONSchema7> | undefined
>(undefined);

const defaultSchema: JSONSchema7 = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "title",
  description: "",
  properties: {},
  required: [],
};

function SchemaProvider({
  children,
  initialSchema,
}: PropsWithChildren<{ initialSchema?: JSONSchema7 }>) {
  const [schema, setSchema] = useState<JSONSchema7>(
    initialSchema ?? defaultSchema,
  );

  /**
   * Path represents the path to a nested property in the schema.
   * It should only contain property keys.
   * An empty path means the current schema is the root schema since
   * the path only represents nested properties.
   */
  const [path, setPath] = useState<string[]>([]);

  // NOTE: you *might* need to memoize your values
  // Learn more in http://kcd.im/optimize-context

  return (
    <SchemaContext.Provider value={{ schema, setSchema, path, setPath }}>
      {children}
    </SchemaContext.Provider>
  );
}

export type PropertyAddError = OperationError & {
  status: "error";
};

export interface PropertyAddSuccess {
  status: "success";
  property: JSONSchema7;
}

export interface PropertyChangeSuccess {
  status: "success";
  property: JSONSchema7Definition;
}

/**
 * Coerces a value to the specified JSON Schema type
 */
const coerceValueToType = (
  value: unknown,
  type: string | string[] | undefined,
): unknown => {
  if (value === undefined || value === null || type === undefined) {
    return value;
  }

  // Handle if type is an array of possible types
  if (Array.isArray(type)) {
    // Try the first type in the array
    return type.length > 0 ? coerceValueToType(value, type[0]) : value;
  }

  // For string default values, try to coerce to the correct type
  if (typeof value === "string") {
    const strValue = value.trim();

    switch (type) {
      case "number": {
        const num = Number(strValue);
        return !isNaN(num) ? num : value;
      }
      case "integer": {
        const int = parseInt(strValue, 10);
        return !isNaN(int) ? int : value;
      }
      case "boolean":
        if (strValue.toLowerCase() === "true") return true;
        if (strValue.toLowerCase() === "false") return false;
        return value;
      case "null":
        if (strValue.toLowerCase() === "null") return null;
        return value;
      case "object":
        try {
          return strValue ? JSON.parse(strValue) : value;
        } catch {
          return value;
        }
      case "array":
        try {
          return strValue ? JSON.parse(strValue) : value;
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  return value;
};

function useSchema({
  onSchemaChange,
}: {
  onSchemaChange?: (schema: JSONSchema7) => void;
} = {}) {
  const context = useContext(SchemaContext);

  if (context === undefined) {
    throw new Error("useSchema must be used within a SchemaProvider");
  }

  const { path, schema, setSchema } = context;

  /**
   * Navigates to the correct property schema of the latest key in the provided path.
   *
   * It will traverse both "properties" and "items" to find the correct property schema.
   *
   * It will only return a property schema if the provided path is valid i.e. it
   * correctly follows the schema's nesting structure.
   *
   * It will only return a parent schema if the provided path is valid i.e. it
   * correctly follows the schema's nesting structure.
   */
  const navigateToCorrectNesting = (
    providedSchema: JSONSchema7,
    providedPath: string[],
  ) => {
    let current = providedSchema;
    let propertySchema: JSONSchema7 | null = null;
    // Should be the schema of type "object" containing the property in its properties key
    let parentSchema: JSONSchema7 | null = null;

    for (const p of providedPath) {
      if (
        current.type === "array" &&
        current.items &&
        !Array.isArray(current.items) &&
        typeof current.items === "object" &&
        current.items.type === "object" &&
        typeof current.items.properties?.[p] === "object"
      ) {
        parentSchema = current.items;
        propertySchema = current.items.properties[p];
        current = current.items;
      } else if (
        current.type === "object" &&
        current.properties &&
        !Array.isArray(current.properties) &&
        typeof current.properties[p] === "object"
      ) {
        parentSchema = current;
        propertySchema = current.properties[p];
        current = current.properties[p];
      }
    }

    return { propertySchema, parentSchema };
  };

  /**
   * Gets the current schema of the latest key in the path.
   * If path is empty, it will return the root schema.
   *
   * It should always return the "object" schema of the current path.
   */
  const getCurrentSchema = (initialSchema?: JSONSchema7) => {
    // Gets the correct object schema if under nesting
    // Otherwise, return the root schema
    const { propertySchema } = navigateToCorrectNesting(
      initialSchema ?? schema,
      path,
    );

    if (propertySchema) {
      if (propertySchema.type === "array") {
        return propertySchema.items as JSONSchema7;
      }

      return propertySchema;
    }

    return initialSchema ?? schema;
  };

  /**
   * Gets the correct property schema of the latest key in the path.
   * If no path is provided, it will return null.
   */
  const getCurrentPropertyOfPath = () => {
    const { propertySchema } = navigateToCorrectNesting(schema, path);

    return propertySchema;
  };

  /**
   * Resolves the property from the current schema's properties.
   * It will return null if the property is not found or if type is not object.
   */
  const getCurrentProperty = (propertyKey: string) => {
    const currentSchema = getCurrentSchema();

    if (currentSchema.type !== "object") {
      return null;
    }

    const currentProperties = currentSchema.properties;
    if (!currentProperties) {
      return null;
    }
    const currentProperty = currentProperties[propertyKey];
    if (currentProperty === undefined) {
      return null;
    }
    if (typeof currentProperty === "boolean") {
      return null;
    }
    return currentProperty;
  };

  /**
   * Change the key of a property in the schema. It expects
   * the find the key at the current path.
   */
  const handleKeyChange = (key: string, newKey: string) => {
    const newSchema = clone(schema);

    // The current schema containing the property to change
    const current: JSONSchema7 = getCurrentSchema(newSchema);

    if (current.properties?.[key]) {
      //Important: maintain order as to not confuse users
      const newProperties = Object.entries(current.properties).map(
        ([k, val]) => {
          return [k === key ? newKey : k, val];
        },
      );

      current.properties = Object.fromEntries(
        newProperties,
      ) as JSONSchema7["properties"];
    }

    if (current.required?.includes(key)) {
      current.required = current.required.map((item) =>
        item === key ? newKey : item,
      );
    }

    setSchema(newSchema);
    onSchemaChange?.(newSchema);
  };

  const handlePropertyChange = (
    key: string,
    updates: Partial<JSONSchema7Definition> & { isRequired?: boolean },
  ): PropertyChangeSuccess | undefined => {
    const newSchema = clone(schema);

    // The current schema containing the property to change
    const current: JSONSchema7 = getCurrentSchema(newSchema);

    // Handle required field updates
    if (typeof updates === "object" && "isRequired" in updates) {
      if (current.type === "object") {
        if (!current.required) {
          current.required = [];
        }
        if (updates.isRequired) {
          if (!current.required.includes(key)) {
            current.required.push(key);
          }
        } else {
          current.required = current.required.filter((item) => item !== key);
        }
      }
      delete updates.isRequired;
    }

    let isUpdated = false;

    // Update the property
    if (current.type === "object" && current.properties) {
      const originalProperty = current.properties[key];
      // Ensure the property exists and is not a boolean
      if (typeof originalProperty !== "boolean" && originalProperty) {
        if (typeof updates !== "boolean") {
          // If updates has a default value, coerce it to the correct type
          if ("default" in updates && updates.default !== undefined) {
            const targetType = updates.type ?? originalProperty.type;
            updates.default = coerceValueToType(
              updates.default,
              targetType,
            ) as JSONSchema7["default"];
          }

          //if updates changes the type of the property or is empty,
          //only the  title, description, and default properties should remain
          //from the original property
          if (updates.type !== originalProperty.type) {
            // If we're changing the type and there's a default value in original property,
            // try to coerce it to the new type
            const defaultValue =
              "default" in updates
                ? updates.default
                : originalProperty.default !== undefined
                  ? coerceValueToType(originalProperty.default, updates.type)
                  : undefined;

            updates = {
              title: originalProperty.title,
              description: originalProperty.description,
              default: defaultValue as JSONSchema7["default"],
              type: originalProperty.type,
              ...updates,
            };
          } else if (typeof updates === "object" && isEmpty(updates)) {
            // If updates is an empty object, keep the original property's
            // title, description, type, and default
            updates = {
              title: originalProperty.title,
              description: originalProperty.description,
              default: originalProperty.default,
              type: originalProperty.type,
            };
          } else {
            // If updates contains properties that are undefined,
            // then delete them from the updates object and delete
            // them from the original property. This is our implementation
            // for "delete" functionality
            Object.entries(updates).forEach(([key, value]) => {
              if (value === undefined) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                delete updates[key];
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                delete originalProperty[key];
              }
            });

            updates = {
              ...originalProperty,
              ...updates,
            };
          }

          current.properties[key] = updates;
        }
      }
      isUpdated = true;
    }

    setSchema(newSchema);
    onSchemaChange?.(newSchema);

    if (isUpdated) {
      return { status: "success", property: current.properties![key]! };
    }
  };

  /**
   * Adds a sibling property to the current schema.
   */
  const handleAddProperty = (
    key: string,
    propertyToAdd: JSONSchema7,
    isRequired: boolean,
  ) => {
    const newSchema = clone(schema);

    // The current schema containing the property to add
    const current: JSONSchema7 = getCurrentSchema(newSchema);

    // Ensure the current schema has a properties object
    if (current.type !== "object") {
      current.type = "object";
    }
    if (!current.properties) {
      current.properties = {};
    }

    //Ensure there's no existing property with the same key
    if (current.properties[key]) {
      return {
        status: "error",
        code: "key-exists" as const,
        message: `Property with key ${key} already exists`,
      } satisfies PropertyAddError;
    }

    // Coerce default value to the correct type if it exists
    if ("default" in propertyToAdd && propertyToAdd.default !== undefined) {
      propertyToAdd.default = coerceValueToType(
        propertyToAdd.default,
        propertyToAdd.type,
      ) as JSONSchema7["default"];
    }

    // Clean the propertyToAdd object ensuring it doesn't contain
    //keys with undefined values
    propertyToAdd = Object.fromEntries(
      Object.entries(propertyToAdd).filter(([, value]) => value !== undefined),
    );

    // Add the new property
    current.properties[key] = propertyToAdd;

    // Handle required field
    if (isRequired) {
      if (!current.required) {
        current.required = [];
      }
      if (!current.required.includes(key)) {
        current.required.push(key);
      }
    }

    setSchema(newSchema);
    onSchemaChange?.(newSchema);

    return {
      status: "success" as const,
      property: current.properties[key],
    } satisfies PropertyAddSuccess;
  };

  const handleDeleteProperty = (key: string) => {
    const newSchema = clone(schema);

    // The current schema containing the property to delete
    const current: JSONSchema7 = getCurrentSchema(newSchema);

    // Handle required field updates
    if (current.type === "object") {
      if (current.required) {
        current.required = current.required.filter((item) => item !== key);
      }
    }

    // Delete the property
    if (current.type === "object" && current.properties) {
      delete current.properties[key];
    }

    setSchema(newSchema);
    onSchemaChange?.(newSchema);
  };

  const handleDuplicateProperty = (key: string) => {
    const currentProperties = getCurrentSchema().properties;
    if (
      !currentProperties ||
      isEmpty(currentProperties) ||
      typeof currentProperties[key] === "boolean"
    ) {
      return;
    }

    const propertyToDuplicate = currentProperties[key]!;
    const newKey = `${key}_copy`;
    const newProperty = clone(propertyToDuplicate);

    // Add the duplicated property
    return handleAddProperty(newKey, newProperty, isPropertyRequired(key));
  };

  const isPropertyRequired = (key: string) => {
    if (path.length) {
      const { propertySchema } = navigateToCorrectNesting(schema, path);

      if (
        propertySchema?.type === "array" &&
        propertySchema.items &&
        typeof propertySchema.items !== "boolean" &&
        !Array.isArray(propertySchema.items) &&
        propertySchema.items?.type === "object"
      ) {
        return Boolean(propertySchema.items?.required?.includes(key));
      } else {
        return Boolean(propertySchema?.required?.includes(key));
      }
    }

    return Boolean(schema?.required?.includes(key));
  };

  /**
   * Programatically get the current schema value
   */
  const getValue = () => {
    return schema;
  };

  return {
    ...context,
    getCurrentSchema,
    getCurrentPropertyOfPath,
    handlePropertyChange,
    handleAddProperty,
    handleKeyChange,
    navigateToCorrectNesting,
    handleDeleteProperty,
    isPropertyRequired,
    getValue,
    handleDuplicateProperty,
    getCurrentProperty,
  };
}

export { SchemaProvider, useSchema };
