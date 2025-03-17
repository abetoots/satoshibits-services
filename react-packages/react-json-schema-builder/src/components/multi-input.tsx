import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { InputErrorWrapper } from "@/components/input-error";
import { useState } from "react";

interface MultiInputProps {
  renderValues?: () => React.ReactNode;
  values: string[];
  onAddValue: (newVal: string) => void;
  onRemoveValue: (index: number) => void;
  maxValues?: number;
}

const MultiInput = ({
  values,
  onAddValue,
  renderValues,
  maxValues,
  onRemoveValue,
  ...props
}: MultiInputProps &
  Omit<React.ComponentProps<"input">, "value" | "onChange">) => {
  const [primaryError, setPrimaryError] = useState<string>();
  const [errorDescription, setErrorDescription] = useState<string>();

  return (
    <InputErrorWrapper
      errorCode={primaryError}
      errorDescription={errorDescription}
      showError={!!primaryError}
      className="space-y-2"
    >
      <Label>Add Input</Label>
      <Input
        {...props}
        onKeyDown={(e) => {
          // Prevent form submission on Enter key press
          if (e.key === "Enter") {
            e.preventDefault();
            //prevent bubbling up
            e.stopPropagation();
          }
        }}
        onKeyUp={(e) => {
          // Add value on Enter key press
          if (e.key === "Enter") {
            if (maxValues && values.length >= maxValues) {
              setPrimaryError("Maximum reached");
              setErrorDescription(
                "You have reached the maximum number of values",
              );
              return;
            }
            onAddValue?.(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
      />
      {renderValues ? (
        renderValues()
      ) : (
        <div className="space-x-2 flex">
          {values.map((value, i) => (
            <div
              key={`${i}-${value}`}
              className="flex items-center text-xs border rounded p-1 w-max mt-2"
            >
              <span>{value}</span>
              <button onClick={() => onRemoveValue(i)}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </InputErrorWrapper>
  );
};

export default MultiInput;
