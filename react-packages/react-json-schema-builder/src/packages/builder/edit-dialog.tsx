import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import type { JSONSchema7 } from "json-schema";
import { clone } from "remeda";
import { Constraint, useConstraints } from "@/packages/constraints/context";
import ConstraintsAdd from "@/packages/constraints/constraint-add";
import { Separator } from "@/components/ui/separator";
import { z } from "zod";
import { AddFormSchema } from "./add-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { OperationError } from "./shared-types";
import { Form } from "@/components/ui/form";
import { useSchema } from "./context";

export interface EditPropertyDialogProps {
  property: JSONSchema7;
  propertyKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    params: Parameters<ReturnType<typeof useSchema>["handlePropertyChange"]>,
  ) => void;
}

const EditFormSchema = AddFormSchema.pick({
  constraints: true,
  property: true,
});

/**
 * Handles editing a constraints and other properties of a JSON schema property
 * that aren't shown in the main UI.
 */
export function EditPropertyDialog({
  open,
  onOpenChange,
  onSubmit,
  property: propertyToEdit,
  propertyKey,
}: EditPropertyDialogProps) {
  const form = useForm<z.infer<typeof EditFormSchema>>({
    resolver: zodResolver(EditFormSchema),
    defaultValues: {
      property: propertyToEdit,
    },
  });

  const currentConstraints = form.watch("constraints");

  const {
    getConstraintDefinitionsForType,
    getRendererForConstraint,
    validateConstraintValue,
  } = useConstraints();

  const handleSubmit = (data: z.infer<typeof EditFormSchema>) => {
    const { constraints } = data;
    const propertyUpdatesOnly: JSONSchema7 = {
      ...constraints?.reduce((acc, constraint) => {
        return {
          ...acc,
          [constraint.name]: constraint.value,
        } satisfies JSONSchema7;
      }, {}),
    };
    onSubmit([propertyKey, propertyUpdatesOnly]);
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

  const availableDefinitions = useMemo(() => {
    return getConstraintDefinitionsForType(
      typeof propertyToEdit?.type === "string" ? propertyToEdit.type : "",
    );
  }, [propertyToEdit.type]);

  useEffect(() => {
    //get the current constraints from the property based on the available definitions
    const newConstraints: Constraint[] = [];
    for (const constraintDef of availableDefinitions) {
      if (constraintDef.name in propertyToEdit) {
        newConstraints.push({
          name: constraintDef.name,
          value: propertyToEdit[constraintDef.name],
        });
      }
    }
    form.setValue("constraints", newConstraints);
  }, [availableDefinitions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
          <DialogDescription>
            Constraints and other properties
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
            data-testid="edit-property-form"
          >
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
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
