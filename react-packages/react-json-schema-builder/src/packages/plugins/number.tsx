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

// A generic number constraint renderer component to reduce code duplication
const NumberConstraintRenderer = ({
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

// Reuse the generic renderer for all number constraints
export const NumberMinimumRenderer = NumberConstraintRenderer;
export const NumberMaximumRenderer = NumberConstraintRenderer;
export const NumberExclusiveMinimumRenderer = NumberConstraintRenderer;
export const NumberExclusiveMaximumRenderer = NumberConstraintRenderer;
export const NumberMultipleOfRenderer = NumberConstraintRenderer;

const plugin: BaseJSONSchemaPlugin = {
  id: "number-constraints",
  hooks: {
    registerConstraints() {
      return [
        {
          name: "minimum",
          label: "Minimum",
          appliesTo: ["number", "integer"],
          schema: {
            type: "number",
            title: "Minimum Constraint",
            description: "The minimum value for this constraint",
            examples: [0, 1, 10],
          },
          description: "Constrains a number or integer to a minimum value",
          defaultValue: 0,
        },
        {
          name: "maximum",
          label: "Maximum",
          appliesTo: ["number", "integer"],
          schema: {
            type: "number",
            title: "Maximum Constraint",
            description: "The maximum value for this constraint",
            examples: [10, 100, 1000],
          },
          description: "Constrains a number or integer to a maximum value",
          defaultValue: 100,
        },
        {
          name: "exclusiveMinimum",
          label: "Exclusive Minimum",
          appliesTo: ["number", "integer"],
          schema: {
            type: "number",
            title: "Exclusive Minimum Constraint",
            description: "The value must be strictly greater than this",
            examples: [0, 1, 10],
          },
          description:
            "Value must be strictly greater than (not equal to) this value",
          defaultValue: 0,
        },
        {
          name: "exclusiveMaximum",
          label: "Exclusive Maximum",
          appliesTo: ["number", "integer"],
          schema: {
            type: "number",
            title: "Exclusive Maximum Constraint",
            description: "The value must be strictly less than this",
            examples: [10, 100, 1000],
          },
          description:
            "Value must be strictly less than (not equal to) this value",
          defaultValue: 100,
        },
        {
          name: "multipleOf",
          label: "Multiple Of",
          appliesTo: ["number", "integer"],
          schema: {
            type: "number",
            title: "Multiple Of Constraint",
            description: "Value must be a multiple of this number",
            examples: [2, 5, 10],
            exclusiveMinimum: 0,
          },
          description:
            "Value must be divisible by this number (e.g., 5 for multiples of 5)",
          defaultValue: 1,
        },
      ];
    },
    registerRenderers() {
      return {
        minimum: NumberMinimumRenderer,
        maximum: NumberMaximumRenderer,
        exclusiveMinimum: NumberExclusiveMinimumRenderer,
        exclusiveMaximum: NumberExclusiveMaximumRenderer,
        multipleOf: NumberMultipleOfRenderer,
      };
    },
  },
};

export default plugin;
