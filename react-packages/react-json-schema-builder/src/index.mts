//export plugins
import arrayPlugin from "./packages/plugins/array";
import numberPlugin from "./packages/plugins/number";
import objectPlugin from "./packages/plugins/object";
import stringPlugin from "./packages/plugins/string";

export {
  SchemaContext,
  SchemaProvider,
  useSchema,
} from "./packages/builder/context";
export { SchemaBuilder } from "./packages/builder/schema-builder";
export type { PropertyComponentProps } from "./packages/builder/schema-builder";
export {
  useConstraints,
  usePluginSystem,
  PluginsProvider,
} from "./packages/constraints/context";
export type {
  BaseJSONSchemaPlugin,
  Constraint,
  ConstraintDefinition,
  ConstraintRendererProps,
} from "./packages/constraints/context";

export { arrayPlugin, numberPlugin, objectPlugin, stringPlugin };
