# React JSON Schema Builder

A powerful React component for visually building and editing [JSON Schema](https://json-schema.org/) definitions.

Demo: https://abetoots.github.io/react-json-schema-builder-demo/

## Features

- 🧰 Visual interface for building JSON Schema documents
- 🔄 Real-time schema updates
- 📊 Support for nested objects and arrays
- ⚙️ Property constraints for different data types
- 🧩 Extensible plugin system for custom constraints
- 🎨 Customizable property rendering
- 🧠 Built-in schema validation
- 🌲 Navigation through nested object structures
- ✨ Customizable UI elements (navigation, property list, add button)
- 🔒 Support for read-only properties and disabled mode

## Installation

```bash
npm install @satoshibits/react-json-schema-builder
# or
yarn add @satoshibits/react-json-schema-builder
# or
pnpm add @satoshibits/react-json-schema-builder
```

## Basic Usage

Here's a simple example of how to use the SchemaBuilder component:

```tsx
import {
  SchemaBuilder,
  SchemaProvider,
  PluginsProvider,
} from "@satoshibits/react-json-schema-builder";
import { useState } from "react";
import type { JSONSchema7 } from "json-schema";

// Import the styles
import "@satoshibits/react-json-schema-builder/index.css";

// Import plugins for constraint support
import { NumberConstraintPlugin } from "@satoshibits/react-json-schema-builder/plugins/number";
import { StringConstraintPlugin } from "@satoshibits/react-json-schema-builder/plugins/string";
import { ArrayConstraintPlugin } from "@satoshibits/react-json-schema-builder/plugins/array";
import { ObjectConstraintPlugin } from "@satoshibits/react-json-schema-builder/plugins/object";
import { EnumConstraintPlugin } from "@satoshibits/react-json-schema-builder/plugins/enum";

function SchemaEditorApp() {
  const [currentSchema, setCurrentSchema] = useState<JSONSchema7>();

  const initialSchema = useMemo(() => {
    return {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          description: "The user's full name",
        },
        age: {
          type: "integer",
          title: "Age",
          description: "The user's age in years",
        },
      },
      required: ["name"],
    } satisfies JSONSchema7;
  }, []);

  const handleSchemaChange = (newSchema: JSONSchema7) => {
    setCurrentSchema(newSchema);
    console.log("Schema updated:", newSchema);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">JSON Schema Builder</h1>

      <div className="border rounded p-4">
        <SchemaProvider>
          <PluginsProvider>
            <SchemaBuilder
              initialSchema={initialSchema}
              onSchemaChange={handleSchemaChange}
              plugins={[
                NumberConstraintPlugin,
                StringConstraintPlugin,
                ArrayConstraintPlugin,
                ObjectConstraintPlugin,
                EnumConstraintPlugin,
              ]}
            />
          </PluginsProvider>
        </SchemaProvider>
      </div>

      <div className="mt-4">
        <h2 className="text-lg font-semibold">Generated Schema:</h2>
        <pre className="bg-gray-100 p-4 rounded">
          {JSON.stringify(schema, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default SchemaEditorApp;
```

## API Reference

### `SchemaBuilder` Component Props

| Prop                         | Type                                          | Description                                                      |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `schema`                     | `JSONSchema7`                                 | The JSON Schema to edit. Should be an object schema.             |
| `plugins`                    | `BaseJSONSchemaPlugin[]`                      | Array of constraint plugins to support different property types. |
| `propertyComponent`          | `React.ComponentType<PropertyComponentProps>` | Optional custom component to render properties.                  |
| `onSchemaChange`             | `(schema: JSONSchema7) => void`               | Called whenever the schema changes.                              |
| `onPropertyAddSuccess`       | `(props: PropertyAddSuccess) => void`         | Called when a property is successfully added.                    |
| `onPropertyAddError`         | `(props: PropertyAddError) => void`           | Called when there's an error adding a property.                  |
| `onPropertyChangeError`      | `(prop: Error) => void`                       | Called when there's an error changing a property.                |
| `onPropertyChangeSuccess`    | `() => void`                                  | Called when a property is successfully changed.                  |
| `backButtonClassName`        | `string`                                      | Class name for the navigation bar's back button.                 |
| `propertiesListClassName`    | `string`                                      | Class name for the properties list container.                    |
| `addPropertyButtonClassName` | `string`                                      | Class name for the Add Property button.                          |
| `navigationComponent`        | `React.ComponentType<NavigationProps>`        | Custom component for the navigation bar.                         |
| `addPropertyButtonComponent` | `React.ComponentType<AddPropertyButtonProps>` | Custom component for the Add Property button.                    |
| `disabledProperties`         | `string[]`                                    | Array of property keys that should be disabled (read-only).      |
| `disabled`                   | `boolean`                                     | Whether all properties should be disabled (read-only).           |

### Navigation and Add Button Props

When providing custom navigation or add button components, they will receive these props:

```tsx
// For custom navigation
interface NavigationProps {
  currentPath: string[];
  onNavigateUp: () => void;
  onNavigateTo: (newPath: string[]) => void;
  isRootPath: boolean;
}

// For custom add property button
interface AddPropertyButtonProps {
  onClick: () => void;
}
```

### PropertyComponentProps Interface

When providing a custom property component, it will receive these props:

```tsx
interface PropertyComponentProps {
  property: {
    key: string;
    schema: JSONSchema7;
    isRequired: boolean;
  };
  onPropertyChange: (key: string, changes: Partial<JSONSchema7>) => void;
  onKeyChange: (oldKey: string, newKey: string) => void;
  onDelete: (key: string) => void;
  onDuplicate?: (key: string) => void;
  onNavigate?: (key: string) => void;
  disabled?: boolean;
}
```

### Plugins

The SchemaBuilder supports different types of constraints for properties through plugins:

- `NumberConstraintPlugin`: Adds constraints like minimum, maximum, and multipleOf for number properties
- `StringConstraintPlugin`: Adds constraints like minLength, maxLength, pattern for string properties
- `ArrayConstraintPlugin`: Adds constraints like minItems, maxItems, uniqueItems for array properties
- `ObjectConstraintPlugin`: Adds constraints like minProperties, maxProperties for object properties
- `EnumConstraintPlugin`: Adds enum constraints

## Advanced Usage

### Customizing UI Elements

You can customize the appearance or completely replace key UI elements:

```tsx
import { SchemaBuilder } from "@satoshibits/react-json-schema-builder";
import type {
  NavigationProps,
  AddPropertyButtonProps,
} from "@satoshibits/react-json-schema-builder";

// Custom navigation component
const CustomNavigation = ({
  currentPath,
  onNavigateUp,
  onNavigateTo,
  isRootPath,
}: NavigationProps) => (
  <div className="my-custom-nav">
    <button onClick={onNavigateUp} disabled={isRootPath}>
      Go Back
    </button>
    <div className="breadcrumbs">
      <span onClick={() => onNavigateTo([])}>Root</span>
      {currentPath.map((path, index) => (
        <span
          key={index}
          onClick={() => onNavigateTo(currentPath.slice(0, index + 1))}
        >
          / {path}
        </span>
      ))}
    </div>
  </div>
);

// Custom add property button
const CustomAddButton = ({ onClick }: AddPropertyButtonProps) => (
  <button className="my-add-button" onClick={onClick}>
    Add New Property
  </button>
);

// Using custom components and class names
function CustomizedSchemaBuilder() {
  return (
    <SchemaBuilder
      schema={initialSchema}
      onSchemaChange={handleSchemaChange}
      // Custom class names
      backButtonClassName="my-back-button"
      propertiesListClassName="my-properties-container"
      addPropertyButtonClassName="my-add-btn"
      // Custom components
      navigationComponent={CustomNavigation}
      addPropertyButtonComponent={CustomAddButton}
    />
  );
}
```

### Custom Property Component

You can provide a custom component to render properties:

```tsx
import {
  SchemaBuilder,
  PropertyComponentProps,
} from "@satoshibits/react-json-schema-builder";

const CustomPropertyComponent = ({
  property,
  onPropertyChange,
  onKeyChange,
  onDelete,
  onDuplicate,
  onNavigate,
  disabled,
}: PropertyComponentProps) => {
  return (
    <div className="my-custom-property">
      <div className="flex justify-between">
        <h3>
          {property.key} ({property.schema.type})
        </h3>
        <div>
          {onNavigate && (
            <button
              onClick={() => onNavigate(property.key)}
              disabled={disabled}
            >
              Navigate
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={() => onDuplicate(property.key)}
              disabled={disabled}
            >
              Duplicate
            </button>
          )}
          <button onClick={() => onDelete(property.key)} disabled={disabled}>
            Delete
          </button>
        </div>
      </div>
      <input
        value={property.key}
        onChange={(e) => onKeyChange(property.key, e.target.value)}
        disabled={disabled}
      />
      <input
        value={property.schema.title as string}
        onChange={(e) =>
          onPropertyChange(property.key, { title: e.target.value })
        }
        placeholder="Title"
        disabled={disabled}
      />
      {/* Add more custom inputs as needed */}
    </div>
  );
};

function CustomSchemaBuilder() {
  // ...
  return (
    <SchemaBuilder
      schema={schema}
      onSchemaChange={handleSchemaChange}
      propertyComponent={CustomPropertyComponent}
    />
  );
}
```

For more advanced scenarios, you can use the included context providers:

```tsx
import {
  SchemaProvider,
  PluginsProvider,
  SchemaBuilder,
} from "@satoshibits/react-json-schema-builder";

function App() {
  return (
    <SchemaProvider initialSchema={initialSchema}>
      <PluginsProvider>
        <SchemaBuilder
          plugins={[numberPlugin, stringPlugin, arrayPlugin, objectPlugin]}
          onSchemaChange={handleSchemaChange}
        />
        {/* Other components that might need schema access */}
      </PluginsProvider>
    </SchemaProvider>
  );
}
```

### Read-only Properties

You can make specific properties read-only using the `disabledProperties` prop:

```tsx
<SchemaBuilder
  initialSchema={schema}
  onSchemaChange={handleSchemaChange}
  // These properties will be non-editable
  disabledProperties={["id", "createdAt", "updatedAt"]}
/>
```

Or make the entire schema builder read-only:

```tsx
<SchemaBuilder
  initialSchema={schema}
  onSchemaChange={handleSchemaChange}
  disabled={true}
/>
```

## Features in Detail

### Property Management

The SchemaBuilder allows you to:

- Add new properties with various types (string, number, integer, boolean, object, array)
- Edit property details (key, title, description)
- Make properties required or optional
- Delete properties
- Duplicate properties
- Configure constraints based on property type

### Nested Structures

You can create and navigate complex nested structures:

- Objects with nested properties
- Arrays with typed items (string, number, object, etc.)
- Navigate through the schema hierarchy with breadcrumb navigation
- Edit deeply nested properties

### Constraints

With the appropriate plugins, you can configure various constraints:

- **String**: minLength, maxLength, pattern, format
- **Number/Integer**: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
- **Array**: minItems, maxItems, uniqueItems
- **Object**: required properties, minProperties, maxProperties

### UI Customization

Customize the appearance of key UI elements:

- Change styles of the navigation back button with `backButtonClassName`
- Customize the properties container with `propertiesListClassName`
- Style the Add Property button with `addPropertyButtonClassName`
- Replace the entire navigation UI with a custom component via `navigationComponent`
- Replace the Add Property button with a custom component via `addPropertyButtonComponent`
- Customize how properties are rendered with the `propertyComponent` prop
- Make specific properties read-only with `disabledProperties` array
- Make the entire schema builder read-only with `disabled` prop

## License

Apache 2.0
