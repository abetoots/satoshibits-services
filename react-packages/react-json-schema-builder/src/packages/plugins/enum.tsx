import {
  BaseJSONSchemaPlugin,
  ConstraintRendererProps,
  useConstraints,
} from "@/packages/constraints/context";
import { EnumEditor } from "@/packages/builder/enum-editor";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

const EnumConstraintRenderer = ({
  constraintName,
  value,
  onConstraintChange,
  disabled,
  error,
  onRemoveConstraint,
  propertyType,
}: ConstraintRendererProps) => {
  const { getConstraintDefinition } = useConstraints();
  const constraintDef = getConstraintDefinition(constraintName);

  if (!constraintDef) {
    return null;
  }

  return (
    <div className="rjsb:space-y-4">
      <div className="rjsb:flex rjsb:justify-between rjsb:items-center">
        <h3 className="rjsb:text-lg rjsb:font-medium">Enum Values</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemoveConstraint}
          className="rjsb:flex rjsb:items-center rjsb:gap-1 rjsb:text-muted-foreground rjsb:hover:text-destructive"
          disabled={disabled}
        >
          <Trash2 className="rjsb:h-4 rjsb:w-4" />
          <span>Remove Constraint</span>
        </Button>
      </div>

      <EnumEditor
        initialValues={Array.isArray(value) ? value : []}
        showCard={false}
        showGeneratedSchema={false}
        onChange={(values) => onConstraintChange(values)}
        error={error}
        propertyType={propertyType}
        disabled={disabled}
        showFooter={false}
      />
    </div>
  );
};

/**
 * The EnumConstraintPlugin integrates the EnumEditor with SchemaBuilder
 * and provides support for editing enum values for all property types.
 */
export const EnumConstraintPlugin: BaseJSONSchemaPlugin = {
  id: "enum-constraints",
  hooks: {
    registerConstraints() {
      return [
        {
          name: "enum",
          label: "Enum Values",
          // Enum constraints can be applied to any property type
          // TODO Enum constraint can also be applied to a property without a type
          // but we need to handle that case in the editor
          appliesTo: [
            "string",
            "number",
            "integer",
            "boolean",
            "array",
            "object",
            "null",
          ],
          schema: {
            type: "array",
            title: "Enum Constraint",
            description: "List of allowed values for this property",
          },
          description:
            "Define a fixed list of values that this property can have",
          defaultValue: [],
        },
      ];
    },
    registerRenderers() {
      return {
        enum: EnumConstraintRenderer,
      };
    },
  },
};
