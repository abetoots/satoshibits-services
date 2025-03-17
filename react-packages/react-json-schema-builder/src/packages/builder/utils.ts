/* eslint-disable @typescript-eslint/no-explicit-any */
import { faker } from "@faker-js/faker";
import Ajv from "ajv";

import type { JSONSchema7 } from "json-schema";

// Export AJV instance for reuse
export const ajv = new Ajv({ allErrors: true });

/**
 * Validates a JSON schema against the JSON Schema Draft 7 specification
 * @param schema Schema to validate
 * @throws Error if the schema is invalid
 */
export function validateSchema(schema: JSONSchema7) {
  const validate = ajv.getSchema("http://json-schema.org/draft-07/schema#");
  const valid = validate?.(schema);

  if (!valid) {
    const errorMessages = validate?.errors
      ?.map((err) => `${err.instancePath} ${err.message}`)
      .join(", ");

    throw new Error(`Schema validation error: ${errorMessages}`);
  }
}

// Test helpers
export const createTestSchema = (overrides = {}): JSONSchema7 => ({
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "Test Schema",
  properties: {
    name: {
      type: "string",
      title: "Name",
    },
    age: {
      type: "integer",
      title: "Age",
    },
    address: {
      type: "object",
      title: "Address",
      properties: {
        street: {
          type: "string",
          title: "Street",
        },
        city: {
          type: "string",
          title: "City",
        },
      },
    },
    tags: {
      type: "array",
      title: "Tags",
      items: {
        type: "string",
      },
    },
  },
  required: ["name"],
  ...overrides,
});

type SampleDataType =
  | string
  | number
  | boolean
  | undefined
  | null
  | Record<string, any>;

/**
 * Generate sample data for a JSON schema
 * @param schema JSON Schema to generate data for
 * @returns Sample data that conforms to the schema
 */
export const generateSampleData = (
  schema: JSONSchema7,
): SampleDataType | SampleDataType[] => {
  if (!schema) return undefined;

  // Handle schema references (not implemented in this basic version)
  if (schema.$ref) {
    // In a complete implementation, this would resolve the reference
    return "Reference not resolved";
  }

  // Handle different types
  switch (schema.type) {
    case "object":
      return generateObjectData(schema);
    case "array":
      return generateArrayData(schema);
    case "string":
      return generateStringData(schema);
    case "number":
    case "integer":
      return generateNumberData(schema);
    case "boolean":
      return generateBooleanData();
    case "null":
      return null;
    default:
      // Handle schemas with multiple types or no type specified
      if (Array.isArray(schema.type) && schema.type.length > 0) {
        // Use the first type as default
        const primaryType = schema.type[0];
        const newSchema = { ...schema, type: primaryType };
        return generateSampleData(newSchema);
      }
      // If no type is specified, default to object
      if (schema.properties) {
        return generateObjectData({ ...schema, type: "object" });
      }
      // Fall back to a string if we can't determine the type
      return faker.lorem.word();
  }
};

/**
 * Generate sample data for an object schema
 */
const generateObjectData = (schema: JSONSchema7): Record<string, any> => {
  const result: Record<string, any> = {};

  if (!schema.properties) return result;

  // Process each property in the schema
  Object.entries(schema.properties).forEach(([key, propSchema]) => {
    // Only include required fields and some random non-required fields
    const isRequired =
      Array.isArray(schema.required) && schema.required.includes(key);
    const includeField = isRequired ?? Math.random() > 0.3; // 70% chance to include non-required fields

    if (includeField && typeof propSchema !== "boolean") {
      // Handle default values
      if (propSchema.default !== undefined) {
        result[key] = propSchema.default;
      } else {
        result[key] = generateSampleData(propSchema);
      }
    }
  });

  return result;
};

/**
 * Generate sample data for an array schema
 */
const generateArrayData = (schema: JSONSchema7) => {
  if (!schema.items) return [];

  // Determine array length
  const minItems = schema.minItems ?? 1;
  const maxItems = schema.maxItems ?? minItems + 3;
  const count = faker.number.int({ min: minItems, max: maxItems });

  const result = [];
  const itemSchema = Array.isArray(schema.items)
    ? schema.items[0]
    : schema.items;

  // Generate items
  if (typeof itemSchema !== "boolean" && itemSchema) {
    for (let i = 0; i < count; i++) {
      result.push(generateSampleData(itemSchema));
    }
  }

  return result;
};

/**
 * Generate sample data for a string schema
 */
const generateStringData = (schema: JSONSchema7): string => {
  if (schema.enum && Array.isArray(schema.enum)) {
    // Pick a random value from the enum
    return schema.enum[
      Math.floor(Math.random() * schema.enum.length)
    ] as string;
  }

  // Handle string formats
  if (schema.format) {
    switch (schema.format) {
      case "email":
        return faker.internet.email();
      case "uri":
      case "url":
        return faker.internet.url();
      case "date":
        return faker.date.past().toISOString().split("T")[0]!;
      case "date-time":
        return faker.date.past().toISOString();
      case "uuid":
        return faker.string.uuid();
      case "hostname":
        return faker.internet.domainName();
      case "ipv4":
        return faker.internet.ip();
      case "ipv6":
        return faker.internet.ipv6();
      case "phone":
        return faker.phone.number();
      default:
        return faker.lorem.word();
    }
  }

  // Handle patterns
  if (schema.pattern) {
    try {
      // Basic implementation for simple patterns
      // For complex patterns, consider using a library like randexp
      if (schema.pattern.includes("\\d")) {
        return faker.string.alphanumeric(10);
      }
      return faker.lorem.word();
    } catch {
      return faker.lorem.word();
    }
  }

  // Handle length constraints
  const minLength = schema.minLength ?? 3;
  const maxLength = schema.maxLength ?? 12;

  return faker.string.alphanumeric({
    length: { min: minLength, max: maxLength },
  });
};

/**
 * Generate sample data for a number schema
 */
const generateNumberData = (schema: JSONSchema7): number => {
  if (schema.enum && Array.isArray(schema.enum)) {
    return schema.enum[
      Math.floor(Math.random() * schema.enum.length)
    ] as number;
  }

  const isInteger = schema.type === "integer";
  const minimum =
    typeof schema.minimum === "number" ? schema.minimum : isInteger ? 0 : 0.0;
  const maximum =
    typeof schema.maximum === "number"
      ? schema.maximum
      : isInteger
        ? 100
        : 100.0;

  if (isInteger) {
    return faker.number.int({ min: minimum, max: maximum });
  }

  return faker.number.float({ min: minimum, max: maximum, fractionDigits: 2 });
};

/**
 * Generate sample data for a boolean schema
 */
const generateBooleanData = (): boolean => {
  return faker.datatype.boolean();
};
