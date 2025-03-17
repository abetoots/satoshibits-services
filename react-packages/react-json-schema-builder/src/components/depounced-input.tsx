import { forwardRef, useState, useEffect } from "react";
import { useDebounce } from "use-debounce";
import { Input } from "@/components/ui/input";

export const DebouncedInput = forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & {
    onDebounce?: (newVal: string) => void;
    delay?: number;
  }
>(({ onDebounce, type, delay = 200, value, ...props }, ref) => {
  const [inputValue, setInputValue] = useState(value);

  const [debouncedValue] = useDebounce(inputValue, delay);

  useEffect(() => {
    //prevents the initial value from being sent
    if (typeof debouncedValue === "string" && debouncedValue !== value) {
      onDebounce?.(debouncedValue);
    }
  }, [debouncedValue]);

  return (
    <Input
      {...props}
      type={type}
      value={inputValue}
      ref={ref}
      onChange={(e) => {
        setInputValue(e.target.value);
      }}
    />
  );
});
DebouncedInput.displayName = "DebouncedInput";
