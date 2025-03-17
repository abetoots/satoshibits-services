import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { SchemaProvider, SchemaContext, useSchema } from "./context";
import { JSONSchema7 } from "json-schema";
import React, { PropsWithChildren, useContext } from "react";
import { fail } from "node:assert";

// Test Utilities
const createBaseSchema = (overrides = {}): JSONSchema7 => ({
  type: "object",
  properties: {},
  ...overrides,
});

const TestWrapper = ({
  children,
  initialSchema = createBaseSchema(),
}: PropsWithChildren<{ initialSchema?: JSONSchema7 }>) => (
  <SchemaProvider initialSchema={initialSchema}>{children}</SchemaProvider>
);

describe("Schema Context", () => {
  describe("SchemaProvider", () => {
    it("renders children correctly", () => {
      render(
        <SchemaProvider>
          <div data-testid="test-child">Test Child</div>
        </SchemaProvider>,
      );

      expect(screen.getByTestId("test-child")).toBeInTheDocument();
      expect(screen.getByTestId("test-child")).toHaveTextContent("Test Child");
    });

    it("provides default schema context", () => {
      const TestConsumer = () => {
        const context = React.useContext(SchemaContext);
        return (
          <>
            <div data-testid="schema-type">
              {context?.schema.type as string}
            </div>
            <div data-testid="path-length">{context?.path.length}</div>
          </>
        );
      };

      render(
        <SchemaProvider>
          <TestConsumer />
        </SchemaProvider>,
      );

      expect(screen.getByTestId("schema-type")).toHaveTextContent("object");
      expect(screen.getByTestId("path-length")).toHaveTextContent("0");
    });

    it("accepts custom initial schema", () => {
      const customSchema = createBaseSchema({
        title: "Custom Schema",
        description: "Test description",
      });

      const TestConsumer = () => {
        const context = useContext(SchemaContext);
        return <div data-testid="schema-title">{context?.schema.title}</div>;
      };

      render(
        <SchemaProvider initialSchema={customSchema}>
          <TestConsumer />
        </SchemaProvider>,
      );

      expect(screen.getByTestId("schema-title")).toHaveTextContent(
        "Custom Schema",
      );
    });
  });

  describe("useSchema hook", () => {
    it("throws error when used outside SchemaProvider", () => {
      // Spy on console.error to prevent test output clutter
      const consoleErrorSpy = vi.spyOn(console, "error");
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      consoleErrorSpy.mockImplementation(() => {});

      expect(() => renderHook(() => useSchema())).toThrow(
        "useSchema must be used within a SchemaProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("returns the context when used within a SchemaProvider", () => {
      const { result } = renderHook(() => useSchema(), {
        wrapper: TestWrapper,
      });

      expect(result.current.schema).toBeDefined();
      expect(result.current.schema.type).toBe("object");
      expect(result.current.path).toEqual([]);
      expect(typeof result.current.setSchema).toBe("function");
      expect(typeof result.current.setPath).toBe("function");
    });

    describe("path navigation", () => {
      it("allows setting and updating path", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: TestWrapper,
        });

        act(() => {
          result.current.setPath(["level1"]);
        });

        expect(result.current.path).toEqual(["level1"]);

        act(() => {
          result.current.setPath([...result.current.path, "level2"]);
        });

        expect(result.current.path).toEqual(["level1", "level2"]);
      });
    });

    describe("getCurrentProperty", () => {
      it("navigates to correct property based on the current path", () => {
        const nestedSchema = createBaseSchema({
          properties: {
            testProp: {
              type: "object",
              title: "Test Property",
              properties: {},
            },
          },
        });

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={nestedSchema} {...props} />
          ),
        });

        act(() => {
          result.current.setPath(["testProp"]);
        });

        const currentSchema = result.current.getCurrentProperty();
        expect(currentSchema?.title).toBe("Test Property");
        expect(currentSchema?.type).toBe("object");
      });

      it("navigates to correct property nested under array types based on current path", () => {
        const arraySchema = createBaseSchema({
          properties: {
            testArray: {
              type: "array",
              items: {
                type: "object",
                title: "Array Item",
                properties: {
                  testProp: {
                    type: "string",
                    title: "Test Property",
                  },
                },
              },
            },
          },
        });

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={arraySchema} {...props} />
          ),
        });

        act(() => {
          result.current.setPath(["testArray", "testProp"]);
        });

        const currentSchema = result.current.getCurrentProperty();
        expect(currentSchema?.title).toBe("Test Property");
        expect(currentSchema?.type).toBe("string");
      });
    });

    describe("handleAddProperty", () => {
      it("adds property to current schema", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: TestWrapper,
        });

        const newProperty: JSONSchema7 = {
          type: "string",
          title: "New Property",
        };

        act(() => {
          result.current.handleAddProperty("newProp", newProperty, false);
        });

        expect(result.current.schema.properties?.newProp).toEqual(newProperty);
        expect(result.current.schema.required).toBeUndefined();
      });

      it("adds required property to current schema", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: TestWrapper,
        });

        const newProperty: JSONSchema7 = {
          type: "string",
          title: "New Required Property",
        };

        act(() => {
          result.current.handleAddProperty("requiredProp", newProperty, true);
        });

        expect(result.current.schema.properties?.requiredProp).toEqual(
          newProperty,
        );
        expect(result.current.schema.required).toContain("requiredProp");
      });

      it("creates required array if it doesn't exist", () => {
        const schemaWithoutRequired = createBaseSchema();
        delete schemaWithoutRequired.required;

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={schemaWithoutRequired} {...props} />
          ),
        });

        act(() => {
          result.current.handleAddProperty(
            "requiredProp",
            { type: "string" },
            true,
          );
        });

        expect(Array.isArray(result.current.schema.required)).toBe(true);
        expect(result.current.schema.required).toContain("requiredProp");
      });

      it("returns error when property key already exists", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: TestWrapper,
        });

        act(() => {
          result.current.handleAddProperty(
            "existingProp",
            { type: "string" },
            false,
          );
        });

        const response = result.current.handleAddProperty(
          "existingProp",
          { type: "number" },
          false,
        );

        expect(response.status).toBe("error");
        if (response.status === "error") {
          expect(response.code).toBe("key-exists");
          expect(response.message).toBeDefined();
        }
      });

      it("creates properties object if not exists", () => {
        const emptySchema: JSONSchema7 = { type: "object" };

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={emptySchema} {...props} />
          ),
        });

        const property: JSONSchema7 = { type: "string" };

        act(() => {
          result.current.handleAddProperty("newProp", property, false);
        });

        expect(result.current.schema.properties).toBeDefined();
        expect(result.current.schema.properties?.newProp).toEqual(property);
      });
    });

    describe("handlePropertyChange", () => {
      const initialSchemaWithProperty = createBaseSchema({
        properties: {
          existingProp: {
            type: "string",
            title: "Original Title",
          },
        },
      });

      it("updates property attributes", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={initialSchemaWithProperty} {...props} />
          ),
        });

        act(() => {
          result.current.handlePropertyChange("existingProp", {
            title: "Updated Title",
            description: "New description",
          });
        });

        const property = result.current.schema.properties?.existingProp;
        expect(property).toBeDefined();
        if (typeof property === "boolean") {
          fail("property is a boolean when it should be an object");
        }
        expect(property?.title).toBe("Updated Title");
        expect(property?.description).toBe("New description");
        expect(property?.type).toBe("string"); // Original value preserved
      });

      it("adds property to required list when isRequired is true", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={initialSchemaWithProperty} {...props} />
          ),
        });

        act(() => {
          result.current.handlePropertyChange("existingProp", {
            isRequired: true,
          });
        });

        expect(Array.isArray(result.current.schema.required)).toBe(true);
        expect(result.current.schema.required).toContain("existingProp");
      });

      it("removes property from required list when isRequired is false", () => {
        const schemaWithRequiredProperty = createBaseSchema({
          properties: {
            existingProp: {
              type: "string",
            },
          },
          required: ["existingProp"],
        });

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper
              initialSchema={schemaWithRequiredProperty}
              {...props}
            />
          ),
        });

        act(() => {
          result.current.handlePropertyChange("existingProp", {
            isRequired: false,
          });
        });

        expect(result.current.schema.required).not.toContain("existingProp");
      });
    });

    describe("handleKeyChange", () => {
      it("renames property key without changing the property value", () => {
        const schemaWithProperty = createBaseSchema({
          properties: {
            oldKey: {
              type: "string",
              title: "Property Title",
            },
          },
        });

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={schemaWithProperty} {...props} />
          ),
        });

        act(() => {
          result.current.handleKeyChange("oldKey", "newKey");
        });

        expect(result.current.schema.properties?.oldKey).toBeUndefined();
        expect(result.current.schema.properties?.newKey).toBeDefined();

        const property = result.current.schema.properties?.newKey;
        if (typeof property === "boolean") {
          fail("property is a boolean when it should be an object");
        }
        expect(property?.type).toBe("string");
        expect(property?.title).toBe("Property Title");
      });

      it("updates required list when renaming a required property", () => {
        const schemaWithRequiredProperty = createBaseSchema({
          properties: {
            oldKey: {
              type: "string",
            },
          },
          required: ["oldKey"],
        });

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper
              initialSchema={schemaWithRequiredProperty}
              {...props}
            />
          ),
        });

        act(() => {
          result.current.handleKeyChange("oldKey", "newKey");
        });

        expect(result.current.schema.required).not.toContain("oldKey");
        expect(result.current.schema.required).toContain("newKey");
      });

      it("renames properties in nested schemas when path is set", () => {
        const nestedSchema = createBaseSchema({
          properties: {
            parent: {
              type: "object",
              properties: {
                oldChildKey: {
                  type: "string",
                },
              },
            },
          },
        });

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={nestedSchema} {...props} />
          ),
        });

        act(() => {
          result.current.setPath(["parent"]);
        });

        act(() => {
          result.current.handleKeyChange("oldChildKey", "newChildKey");
        });

        const parent = result.current.schema.properties?.parent;
        if (typeof parent === "boolean") {
          fail("parent is a boolean when it should be an object");
        }

        expect(parent?.properties?.oldChildKey).toBeUndefined();
        expect(parent?.properties?.newChildKey).toBeDefined();
      });
    });

    describe("navigateToCorrectNesting", () => {
      it("navigates through nested object properties", () => {
        const nestedSchema: JSONSchema7 = {
          type: "object",
          properties: {
            level1: {
              type: "object",
              properties: {
                level2: {
                  type: "object",
                  properties: {
                    level3: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        };

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={nestedSchema} {...props} />
          ),
        });

        let parentSchema: JSONSchema7 | undefined;

        act(() => {
          // Using the private method for testing
          const res = result.current.navigateToCorrectNesting(
            result.current.schema,
            ["level1", "level2", "level3"],
          );
          parentSchema = res.parentSchema ?? undefined;
        });

        expect(parentSchema?.properties?.level3).toBeDefined();
        const level3 = parentSchema?.properties?.level3;
        if (typeof level3 === "boolean") {
          fail("level3 is a boolean when it should be an object");
        }
        expect(level3?.type).toBe("string");
      });

      it("navigates through array items", () => {
        const arraySchema: JSONSchema7 = {
          type: "object",
          properties: {
            arrayProp: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  itemProp: {
                    type: "string",
                  },
                },
              },
            },
          },
        };

        const level1Match = arraySchema.properties?.arrayProp as JSONSchema7;

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={arraySchema} {...props} />
          ),
        });

        let parentSchema: JSONSchema7 | undefined;
        let propertySchema: JSONSchema7 | undefined;

        act(() => {
          const res = result.current.navigateToCorrectNesting(
            result.current.schema,
            ["arrayProp", "itemProp"],
          );
          parentSchema = res.parentSchema ?? undefined;
          propertySchema = res.propertySchema ?? undefined;
        });

        expect(parentSchema).toStrictEqual(level1Match.items);
        expect(propertySchema?.type).toBe("string");
      });

      it("handles invalid paths by returning null", () => {
        const { result } = renderHook(() => useSchema(), {
          wrapper: TestWrapper,
        });

        let res:
          | ReturnType<typeof result.current.navigateToCorrectNesting>
          | undefined;

        act(() => {
          res = result.current.navigateToCorrectNesting(result.current.schema, [
            "nonExistentPath",
          ]);
        });

        expect(res?.parentSchema).toBeNull();
        expect(res?.propertySchema).toBeNull();
      });

      it("navigates through mixed path with objects and arrays", () => {
        const mixedSchema: JSONSchema7 = {
          type: "object",
          properties: {
            objProp: {
              type: "object",
              properties: {
                arrayProp: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      deepProp: {
                        type: "string",
                        title: "Deep Property",
                      },
                    },
                  },
                },
              },
            },
          },
        };

        const level1Match = mixedSchema.properties?.objProp as JSONSchema7;
        const level2Match = level1Match.properties?.arrayProp as JSONSchema7;

        const { result } = renderHook(() => useSchema(), {
          wrapper: (props) => (
            <TestWrapper initialSchema={mixedSchema} {...props} />
          ),
        });

        let res:
          | ReturnType<typeof result.current.navigateToCorrectNesting>
          | undefined;

        act(() => {
          res = result.current.navigateToCorrectNesting(result.current.schema, [
            "objProp",
            "arrayProp",
            "deepProp",
          ]);
        });

        expect(res?.parentSchema).toStrictEqual(level2Match.items);
        expect(res?.propertySchema?.title).toBe("Deep Property");
      });
    });
  });
});
