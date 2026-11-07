import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "rjsb:peer rjsb:data-[state=checked]:bg-primary rjsb:data-[state=unchecked]:bg-input rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:inline-flex rjsb:h-5 rjsb:w-9 rjsb:shrink-0 rjsb:items-center rjsb:rounded-full rjsb:border-2 rjsb:border-transparent rjsb:shadow-xs rjsb:transition-all rjsb:outline-none rjsb:focus-visible:ring-[3px] rjsb:disabled:cursor-not-allowed rjsb:disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "rjsb:bg-background rjsb:pointer-events-none rjsb:block rjsb:size-4 rjsb:rounded-full rjsb:ring-0 rjsb:shadow-lg rjsb:transition-transform rjsb:data-[state=checked]:translate-x-4 rjsb:data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
