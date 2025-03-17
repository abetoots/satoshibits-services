import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { JSONSchema7, JSONSchema7TypeName } from "json-schema";
import { DebouncedInput } from "@/components/depounced-input";
import { clone } from "remeda";
import MultiInput from "@/components/multi-input";
import { Constraint, useConstraints } from "@/packages/constraints/context";
import ConstraintsAdd from "@/packages/constraints/constraint-add";
import { Separator } from "@/components/ui/separator";
import { z } from "zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { OperationError } from "./shared-types";

export interface AddPropertyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (key: string, property: JSONSchema7, required: boolean) => void;
}

const zodJsonTypes = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

export const AddFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, { message: "Key must be at least 1 character long" }),
  property: z.object({
    title: z
      .string()
      .trim()
      .min(1, { message: "Title must be at least 1 character long" }),
    type: zodJsonTypes.or(z.array(zodJsonTypes)),
    description: z.string().optional(),
    enum: z
      .array(
        z
          .string()
          .or(z.number())
          .or(z.null())
          .or(z.boolean())
          .or(z.record(z.string(), z.any())),
      )
      .optional(),
    items: z
      .object({
        type: zodJsonTypes.or(z.array(zodJsonTypes)),
      })
      //only to satisfy the other types but we actually don't handle it
      .or(
        z.array(
          z
            .object({ type: zodJsonTypes.or(z.array(zodJsonTypes)) })
            .or(z.boolean()),
        ),
      )
      .or(z.boolean())
      .optional(),
  }),
  required: z.boolean().default(false),
  constraints: z
    .array(
      z.custom<Constraint>(() => ({
        name: z.string().trim().min(1),
        value: z.any(),
      })),
    )
    .optional(),
});

/**
 * Handles adding a property to a parent JSON schema's "properties".
 * This means you are working under a child property.
 */
export function AddPropertyDialog({
  open,
  onOpenChange,
  onSubmit,
}: AddPropertyDialogProps) {
  const form = useForm<z.infer<typeof AddFormSchema>>({
    resolver: zodResolver(AddFormSchema),
    defaultValues: {
      key: "",
      property: {
        title: "",
      },
    },
  });

  const currentConstraints = form.watch("constraints");
  const currentProperty = form.watch("property");
  const currentEnum = form.watch("property.enum");
  const currentType = form.watch("property.type");

  const {
    getConstraintDefinitionsForType,
    getRendererForConstraint,
    validateConstraintValue,
  } = useConstraints();

  const handleSubmit = (data: z.infer<typeof AddFormSchema>) => {
    const { key, property, required, constraints } = data;
    const propertyToSubmit: JSONSchema7 = {
      ...property,
      ...constraints?.reduce((acc, constraint) => {
        return {
          ...acc,
          [constraint.name]: constraint.value,
        } satisfies JSONSchema7;
      }, {}),
    };
    onSubmit(key, propertyToSubmit, required);
    form.reset();
  };

  const handleConstraintChange = (
    index: number,
    newVal: Constraint["value"],
  ) => {
    const constraintsCopy = clone(currentConstraints);

    const constraintToChange = constraintsCopy?.[index];

    if (!constraintToChange) {
      form.setError(`constraints.${index}`, {
        message: "The constraint was not found",
        type: "constraint_not_found",
      });
      return;
    }

    const validationResult = validateConstraintValue(
      constraintToChange.name,
      newVal,
    );

    if (validationResult.status === "error") {
      let message = validationResult.message;
      if (validationResult.code === "invalid") {
        message = `${message}: ${validationResult.error?.map((i) => i.message).join(", ")}`;
      }
      form.setError(`constraints.${index}`, {
        type: validationResult.code,
        message,
      });
      return;
    }

    //edit reference
    constraintToChange.value = newVal;
    form.setValue("constraints", constraintsCopy);
    form.clearErrors(`constraints.${index}`);
  };

  const handleRemoveConstraint = (constraintName: Constraint["name"]) => {
    if (!currentConstraints) return;
    const copy = clone(currentConstraints);
    const newConstraints = copy.filter((c) => c.name !== constraintName);
    form.setValue("constraints", newConstraints);
  };

  const availableDefinitions = getConstraintDefinitionsForType(
    typeof currentProperty?.type === "string" ? currentProperty.type : "",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-property-dialog">
        <DialogHeader>
          <DialogTitle>Add</DialogTitle>
          <DialogDescription>
            Required property values and constraints
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
            data-testid="add-property-form"
          >
            <div className="space-y-2">
              <FormField
                control={form.control}
                name="key"
                render={({ field }) => {
                  // Pull the onChange since debounced input should
                  // be calling onDebounce instead
                  const { onChange, ...rest } = field;

                  return (
                    <FormItem>
                      <FormLabel>Property Key</FormLabel>
                      <FormControl>
                        <DebouncedInput
                          {...rest}
                          onDebounce={(newVal) => onChange(newVal)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            <div className="space-y-2">
              <FormField
                control={form.control}
                name="property.title"
                render={({ field }) => {
                  const { onChange, ...rest } = field;
                  return (
                    <FormItem>
                      <FormLabel>Property Title</FormLabel>
                      <FormControl>
                        <DebouncedInput
                          {...rest}
                          onDebounce={(newVal) => onChange(newVal)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            <div className="space-y-2">
              <FormField
                control={form.control}
                name="property.type"
                render={({ field }) => {
                  return (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <FormControl>
                        <Select
                          value={
                            !Array.isArray(field.value)
                              ? field.value
                              : undefined
                          }
                          onValueChange={(newVal) => {
                            if (newVal === "enum") {
                              form.setValue("property.enum", []);
                            } else {
                              form.setValue("property.enum", undefined);
                            }

                            // If changing away from array, clear any array item errors
                            if (field.value === "array" && newVal !== "array") {
                              form.clearErrors("property.items");
                              form.setValue("property.items", undefined);
                            }

                            field.onChange(newVal);
                          }}
                        >
                          <SelectTrigger
                            className="w-full"
                            aria-label="Select type"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value={"string" satisfies JSONSchema7TypeName}
                            >
                              string
                            </SelectItem>
                            <SelectItem
                              value={"number" satisfies JSONSchema7TypeName}
                            >
                              number
                            </SelectItem>
                            <SelectItem
                              value={"integer" satisfies JSONSchema7TypeName}
                            >
                              integer
                            </SelectItem>
                            <SelectItem
                              value={"boolean" satisfies JSONSchema7TypeName}
                            >
                              boolean
                            </SelectItem>
                            <SelectItem
                              value={"object" satisfies JSONSchema7TypeName}
                            >
                              object
                            </SelectItem>
                            <SelectItem
                              value={"array" satisfies JSONSchema7TypeName}
                            >
                              array
                            </SelectItem>
                            <SelectItem
                              value={"null" satisfies JSONSchema7TypeName}
                            >
                              null
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>

            {/* Array Items Type selector */}
            {currentType === "array" && (
              <div className="space-y-2">
                <FormField
                  control={form.control}
                  name="property.items.type"
                  render={({ field }) => {
                    return (
                      <FormItem>
                        <FormLabel>Items of type</FormLabel>
                        <FormControl>
                          <Select
                            value={
                              !Array.isArray(field.value)
                                ? field.value
                                : undefined
                            }
                            onValueChange={(newVal) => {
                              form.clearErrors("property.items.type");
                              form.setValue(
                                "property.items.type",
                                newVal as JSONSchema7TypeName,
                              );
                            }}
                          >
                            <SelectTrigger
                              className="w-full"
                              aria-label="Select items of type"
                            >
                              <SelectValue placeholder="Select item type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem
                                value={"string" satisfies JSONSchema7TypeName}
                              >
                                string
                              </SelectItem>
                              <SelectItem
                                value={"number" satisfies JSONSchema7TypeName}
                              >
                                number
                              </SelectItem>
                              <SelectItem
                                value={"integer" satisfies JSONSchema7TypeName}
                              >
                                integer
                              </SelectItem>
                              <SelectItem
                                value={"boolean" satisfies JSONSchema7TypeName}
                              >
                                boolean
                              </SelectItem>
                              <SelectItem
                                value={"object" satisfies JSONSchema7TypeName}
                              >
                                object
                              </SelectItem>
                              <SelectItem
                                value={"array" satisfies JSONSchema7TypeName}
                              >
                                array
                              </SelectItem>
                              <SelectItem
                                value={"null" satisfies JSONSchema7TypeName}
                              >
                                null
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>
            )}

            <div className="flex items-center space-x-2">
              <FormField
                control={form.control}
                name="required"
                render={({ field }) => {
                  return (
                    <FormItem>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked)}
                        />
                      </FormControl>
                      <FormLabel>Required</FormLabel>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            <div className="space-y-2">
              <FormField
                control={form.control}
                name="property.description"
                render={({ field }) => {
                  return (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            {currentEnum ? (
              <FormField
                control={form.control}
                name="property.enum"
                render={({ field }) => {
                  return (
                    <FormItem>
                      <FormLabel>Enum</FormLabel>
                      <FormControl>
                        <MultiInput
                          values={
                            field.value?.filter((i) => typeof i === "string") ??
                            []
                          }
                          onAddValue={(newVal) => {
                            const updates = [];
                            if (field.value) {
                              updates.push(...field.value);
                            }
                            updates.push(newVal);
                            field.onChange(updates);
                          }}
                          onRemoveValue={(index) => {
                            const newEnums = clone(field.value ?? []);
                            newEnums.splice(index, 1);
                            field.onChange(newEnums);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            ) : null}

            {availableDefinitions.length ? (
              <div className="space-y-2">
                <Label>Constraints</Label>
                <ConstraintsAdd
                  addedConstraints={currentConstraints ?? []}
                  availableDefinitions={availableDefinitions}
                  onAdd={(newConstraints) => {
                    form.setValue("constraints", newConstraints);
                  }}
                />
                <Separator />
                {currentConstraints?.map((constraint, i) => {
                  const Renderer = getRendererForConstraint(constraint.name);
                  if (!Renderer) return null;

                  const error = form.formState.errors.constraints?.[i];
                  let mappedError: OperationError | undefined;

                  if (error) {
                    mappedError = {
                      code: error?.type ?? "INVALID",
                      message: error.message ?? "An error occurred",
                    };
                  }

                  return (
                    <Renderer
                      key={constraint.name}
                      constraintName={constraint.name}
                      value={constraint.value}
                      onConstraintChange={(newVal) => {
                        handleConstraintChange(i, newVal);
                      }}
                      onRemoveConstraint={() => {
                        handleRemoveConstraint(constraint.name);
                      }}
                      error={mappedError}
                    />
                  );
                })}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="submit">Add Property</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
