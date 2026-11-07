import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "rjsb:border-input rjsb:file:text-foreground rjsb:placeholder:text-muted-foreground rjsb:selection:bg-primary rjsb:selection:text-primary-foreground rjsb:flex rjsb:h-9 rjsb:w-full rjsb:min-w-0 rjsb:rounded-md rjsb:border rjsb:bg-transparent rjsb:px-3 rjsb:py-1 rjsb:text-base rjsb:shadow-xs rjsb:transition-[color,box-shadow] rjsb:outline-none rjsb:file:inline-flex rjsb:file:h-7 rjsb:file:border-0 rjsb:file:bg-transparent rjsb:file:text-sm rjsb:file:font-medium rjsb:disabled:pointer-events-none rjsb:disabled:cursor-not-allowed rjsb:disabled:opacity-50 rjsb:md:text-sm",
        "rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:focus-visible:ring-[3px]",
        "rjsb:aria-invalid:ring-destructive/20 rjsb:dark:aria-invalid:ring-destructive/40 rjsb:aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
