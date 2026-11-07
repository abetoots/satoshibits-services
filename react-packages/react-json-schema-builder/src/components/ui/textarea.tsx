import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "rjsb:border-input rjsb:placeholder:text-muted-foreground rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:aria-invalid:ring-destructive/20 rjsb:dark:aria-invalid:ring-destructive/40 rjsb:aria-invalid:border-destructive rjsb:dark:bg-input/30 rjsb:flex rjsb:field-sizing-content rjsb:min-h-16 rjsb:w-full rjsb:rounded-md rjsb:border rjsb:bg-transparent rjsb:px-3 rjsb:py-2 rjsb:text-base rjsb:shadow-xs rjsb:transition-[color,box-shadow] rjsb:outline-none rjsb:focus-visible:ring-[3px] rjsb:disabled:cursor-not-allowed rjsb:disabled:opacity-50 rjsb:md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
