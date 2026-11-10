import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn, ROOT_CLASS } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;

function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onFocus={(e: React.FocusEvent<HTMLButtonElement>) => {
        onFocus?.(e);
        // programmatic focus after a mouse close (focus return) must not reopen the tooltip
        if (!e.currentTarget.matches(":focus-visible")) e.preventDefault();
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          ROOT_CLASS,
          "rjsb:bg-primary rjsb:text-primary-foreground rjsb:animate-in rjsb:fade-in-0 rjsb:zoom-in-95 rjsb:data-[state=closed]:animate-out rjsb:data-[state=closed]:fade-out-0 rjsb:data-[state=closed]:zoom-out-95 rjsb:z-50 rjsb:rounded-md rjsb:px-3 rjsb:py-1.5 rjsb:text-xs",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
