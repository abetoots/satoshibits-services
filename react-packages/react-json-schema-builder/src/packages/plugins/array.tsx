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
import { Switch } from "@/components/ui/switch";

// Generic numeric constraint renderer for arrays (minItems, maxItems)
const ArrayNumberConstraintRenderer = ({
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

// Boolean constraint renderer for uniqueItems
const ArrayBooleanConstraintRenderer = ({
  constraintName,
  value,
  onConstraintChange,
  disabled,
  error,
  onRemoveConstraint,
}: ConstraintRendererProps<boolean> & { disabled?: boolean }) => {
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
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor={constraintDef.name}>{constraintDef.name}</Label>
          <div className="flex items-center gap-2">
            <Switch
              id={constraintDef.name}
              checked={value}
              onCheckedChange={(checked) => onConstraintChange(checked)}
              disabled={disabled}
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
export const ArrayMinItemsRenderer = ArrayNumberConstraintRenderer;
export const ArrayMaxItemsRenderer = ArrayNumberConstraintRenderer;
export const ArrayUniqueItemsRenderer = ArrayBooleanConstraintRenderer;

export const ArrayConstraintPlugin: BaseJSONSchemaPlugin = {
  id: "array-constraints",
  hooks: {
    registerConstraints() {
      return [
        {
          name: "minItems",
          label: "Min Items",
          appliesTo: ["array"],
          schema: {
            type: "integer",
            title: "Minimum Items Constraint",
            description: "The minimum number of items the array must contain",
            examples: [1, 2, 5],
            minimum: 0,
          },
          description: "Specifies the minimum number of items in the array",
          defaultValue: 0,
        },
        {
          name: "maxItems",
          label: "Max Items",
          appliesTo: ["array"],
          schema: {
            type: "integer",
            title: "Maximum Items Constraint",
            description: "The maximum number of items the array can contain",
            examples: [10, 20, 100],
            minimum: 0,
          },
          description: "Specifies the maximum number of items in the array",
          defaultValue: 10,
        },
        {
          name: "uniqueItems",
          label: "Unique Items",
          appliesTo: ["array"],
          schema: {
            type: "boolean",
            title: "Unique Items Constraint",
            description: "Whether array items must be unique",
          },
          description: "When true, all items in the array must be unique",
          defaultValue: false,
        },
      ];
    },
    registerRenderers() {
      return {
        minItems: ArrayMinItemsRenderer,
        maxItems: ArrayMaxItemsRenderer,
        uniqueItems: ArrayUniqueItemsRenderer,
      };
    },
  },
};
