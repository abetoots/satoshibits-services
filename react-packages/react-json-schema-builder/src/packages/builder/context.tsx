import { createContext, useContext, useState } from "react";

import type { PropsWithChildren, SetStateAction } from "react";
import type { JSONSchema7, JSONSchema7Definition } from "json-schema";
import { clone } from "remeda";
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

function useSchema() {
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
  const getCurrentProperty = () => {
    const { propertySchema } = navigateToCorrectNesting(schema, path);

    return propertySchema;
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
          //if updates changes the type of the property,
          //only the  title, description, and default properties should remain
          //from the original property
          if (updates.type && updates.type !== originalProperty.type) {
            updates = {
              title: originalProperty.title,
              description: originalProperty.description,
              default: originalProperty.default,
              ...updates,
            };
          } else if (updates.enum) {
            //if the property is an enum, only the title and description should remain
            //from the original property
            delete updates.type;
            delete updates.items;
            delete updates.properties;
            updates = {
              title: originalProperty.title,
              description: originalProperty.description,
              ...updates,
            };
          } else {
            updates = { ...originalProperty, ...updates };
          }

          current.properties[key] = updates;
        }
      }
      isUpdated = true;
    }

    setSchema(newSchema);

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

    if (propertyToAdd.enum) {
      //ensure that only the enum property is present
      delete propertyToAdd.type;
      delete propertyToAdd.items;
      delete propertyToAdd.properties;
    }

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
  };

  //   const handleDuplicateProperty = (key: string) => {
  //     const currentProperties = getCurrentSchema().properties;
  //     if (!currentProperties || typeof currentProperties[key] === "boolean") {
  //       return;
  //     }

  //     const propertyToDuplicate = currentProperties[key]!;
  //     const newKey = `${key}_copy`;
  //     const newProperty = clone(propertyToDuplicate);

  //     // Add the duplicated property
  //     const result = handleAddProperty(
  //       newKey,
  //       newProperty,
  //       isPropertyRequired(key),
  //     );

  //     // Notify if needed
  //     if (result.status === "error") {
  //       props.onPropertyAddError?.(result);
  //     } else {
  //       props.onPropertyAddSuccess?.(result);
  //     }
  //   };

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

  return {
    ...context,
    getCurrentSchema,
    getCurrentProperty,
    handlePropertyChange,
    handleAddProperty,
    handleKeyChange,
    navigateToCorrectNesting,
    handleDeleteProperty,
    isPropertyRequired,
  };
}

export { SchemaProvider, useSchema };
