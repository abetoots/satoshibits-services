import { Input } from "@/components/ui/input";
import { InputErrorWrapper } from "@/components/input-error";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  BaseJSONSchemaPlugin,
  ConstraintRendererProps,
  useConstraints,
} from "@/packages/constraints/context";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

// Number constraint renderer for minProperties and maxProperties
const ObjectNumberConstraintRenderer = ({
  constraintName,
  value,
  onConstraintChange,
  disabled,
  error,
  onRemoveConstraint,
}: ConstraintRendererProps<number> & { disabled?: boolean }) => {
  const { getConstraintDefinition } = useConstraints();
  const constraintDef = getConstraintDefinition(constraintName);

  if (!constraintDef) {
    return null;
  }

  return (
    <InputErrorWrapper
      errorCode={error?.code}
      errorDescription={error?.message}
      showError={!!error}
    >
      <div>
        <Label className="mb-2" htmlFor={constraintDef.name}>
          {constraintDef.name}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={constraintDef.name}
            type="number"
            value={value}
            onChange={(e) => onConstraintChange(Number(e.target.value))}
            disabled={disabled}
            min={0}
            className={cn({ "border-destructive": error })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemoveConstraint()}
          >
            <X className="size-4" />
          </Button>
        </div>
        {constraintDef.description && (
          <div className="mt-2 text-sm text-gray-500">
            {constraintDef.description}
          </div>
        )}
      </div>
    </InputErrorWrapper>
  );
};

// Export the renderers
export const ObjectMinPropertiesRenderer = ObjectNumberConstraintRenderer;
export const ObjectMaxPropertiesRenderer = ObjectNumberConstraintRenderer;

const plugin: BaseJSONSchemaPlugin = {
  id: "object-constraints",
  hooks: {
    registerConstraints() {
      return [
        {
          name: "minProperties",
          label: "Min Properties",
          appliesTo: ["object"],
          schema: {
            type: "integer",
            title: "Minimum Properties Constraint",
            description:
              "The minimum number of properties the object must have",
            examples: [1, 2, 5],
            minimum: 0,
          },
          description:
            "Specifies the minimum number of properties in the object",
          defaultValue: 0,
        },
        {
          name: "maxProperties",
          label: "Max Properties",
          appliesTo: ["object"],
          schema: {
            type: "integer",
            title: "Maximum Properties Constraint",
            description: "The maximum number of properties the object can have",
            examples: [5, 10, 20],
            minimum: 0,
          },
          description:
            "Specifies the maximum number of properties in the object",
          defaultValue: 10,
        },
      ];
    },
    registerRenderers() {
      return {
        minProperties: ObjectMinPropertiesRenderer,
        maxProperties: ObjectMaxPropertiesRenderer,
      };
    },
  },
};

export default plugin;
