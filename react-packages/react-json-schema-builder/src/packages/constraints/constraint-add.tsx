import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Constraint, ConstraintDefinition } from "./context";

interface ConstraintsSectionProps {
  /** The available constraints for a specific schema type */
  availableDefinitions: ConstraintDefinition[];
  addedConstraints: Constraint[];
  onAdd: (constraints: Constraint[]) => void;
}

const ConstraintsAdd = ({
  availableDefinitions,
  addedConstraints,
  onAdd,
}: ConstraintsSectionProps) => {
  const [selectedConstraintDefinition, setSelectedConstraintDefinition] =
    useState<Constraint["name"]>();

  const handleAddConstraint = () => {
    if (!selectedConstraintDefinition) return;

    const definition = availableDefinitions.find(
      (c) => c.name === selectedConstraintDefinition,
    );
    if (!definition) return;

    const newConstraint: Constraint = {
      name: selectedConstraintDefinition,
      value: definition.defaultValue,
    };

    onAdd([...addedConstraints, newConstraint]);
    setSelectedConstraintDefinition(undefined);
  };

  const unusedConstraintDefinitions = availableDefinitions.filter(
    (constraint) => !addedConstraints.some((v) => v.name === constraint.name),
  );

  return (
    //Don't render the component if there are no constraints to add
    unusedConstraintDefinitions.length > 0 && (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            value={selectedConstraintDefinition}
            onValueChange={(newVal) => {
              setSelectedConstraintDefinition(newVal as Constraint["name"]);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Select constraint">
              <SelectValue placeholder="Select a constraint" />
            </SelectTrigger>
            <SelectContent>
              {unusedConstraintDefinitions.map((constraint) => (
                <SelectItem key={constraint.name} value={constraint.name}>
                  {constraint.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleAddConstraint}
          disabled={!selectedConstraintDefinition}
          aria-label="Add constraint"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    )
  );
};

export default ConstraintsAdd;
