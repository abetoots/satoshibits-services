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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Generic string constraint renderer for number-based constraints (minLength, maxLength)
const StringNumberConstraintRenderer = ({
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

// Pattern constraint renderer for regex input
const PatternConstraintRenderer = ({
  constraintName,
  value,
  onConstraintChange,
  disabled,
  error,
  onRemoveConstraint,
}: ConstraintRendererProps<string> & { disabled?: boolean }) => {
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
            type="text"
            value={value}
            onChange={(e) => onConstraintChange(e.target.value)}
            disabled={disabled}
            placeholder="Regular expression pattern"
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

// Format constraint renderer with predefined format options
const FormatConstraintRenderer = ({
  constraintName,
  value,
  onConstraintChange,
  disabled,
  error,
  onRemoveConstraint,
}: ConstraintRendererProps<string> & { disabled?: boolean }) => {
  const { getConstraintDefinition } = useConstraints();
  const constraintDef = getConstraintDefinition(constraintName);

  const formatOptions = [
    { value: "email", label: "Email" },
    { value: "uri", label: "URI" },
    { value: "url", label: "URL" },
    { value: "date", label: "Date" },
    { value: "date-time", label: "Date-Time" },
    { value: "uuid", label: "UUID" },
    { value: "hostname", label: "Hostname" },
    { value: "ipv4", label: "IPv4" },
    { value: "ipv6", label: "IPv6" },
    { value: "phone", label: "Phone" },
  ];

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
          <Select
            value={value}
            onValueChange={(newValue) => onConstraintChange(newValue)}
            disabled={disabled}
          >
            <SelectTrigger
              id={constraintDef.name}
              className={cn("flex-1", { "border-destructive": error })}
            >
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              {formatOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
export const StringMinLengthRenderer = StringNumberConstraintRenderer;
export const StringMaxLengthRenderer = StringNumberConstraintRenderer;
export const StringPatternRenderer = PatternConstraintRenderer;
export const StringFormatRenderer = FormatConstraintRenderer;

const plugin: BaseJSONSchemaPlugin = {
  id: "string-constraints",
  hooks: {
    registerConstraints() {
      return [
        {
          name: "minLength",
          label: "Min Length",
          appliesTo: ["string"],
          schema: {
            type: "integer",
            title: "Minimum Length Constraint",
            description: "The minimum length of the string",
            examples: [1, 5, 10],
            minimum: 0,
          },
          description: "Constrains a string to a minimum length",
          defaultValue: 0,
        },
        {
          name: "maxLength",
          label: "Max Length",
          appliesTo: ["string"],
          schema: {
            type: "integer",
            title: "Maximum Length Constraint",
            description: "The maximum length of the string",
            examples: [50, 100, 255],
            minimum: 0,
          },
          description: "Constrains a string to a maximum length",
          defaultValue: 100,
        },
        {
          name: "pattern",
          label: "Pattern",
          appliesTo: ["string"],
          schema: {
            type: "string",
            title: "Pattern Constraint",
            description: "Regular expression pattern the string must match",
            examples: ["^[a-zA-Z0-9]+$", "\\d{3}-\\d{2}-\\d{4}"],
          },
          description: "Regular expression that the string must match",
          defaultValue: "",
        },
        {
          name: "format",
          label: "Format",
          appliesTo: ["string"],
          schema: {
            type: "string",
            title: "Format Constraint",
            description: "Predefined format the string must follow",
            enum: [
              "email",
              "uri",
              "url",
              "date",
              "date-time",
              "uuid",
              "hostname",
              "ipv4",
              "ipv6",
              "phone",
            ],
          },
          description: "Predefined format validation for the string",
          defaultValue: "email",
        },
      ];
    },
    registerRenderers() {
      return {
        minLength: StringMinLengthRenderer,
        maxLength: StringMaxLengthRenderer,
        pattern: StringPatternRenderer,
        format: StringFormatRenderer,
      };
    },
  },
};

export default plugin;
