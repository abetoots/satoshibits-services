import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "rjsb:relative rjsb:w-full rjsb:rounded-lg rjsb:border rjsb:px-4 rjsb:py-3 rjsb:text-sm rjsb:grid rjsb:has-[>svg]:grid-cols-[--spacing(4)_1fr] rjsb:grid-cols-[0_1fr] rjsb:has-[>svg]:gap-x-3 rjsb:gap-y-0.5 rjsb:items-start rjsb:[&>svg]:size-4 rjsb:[&>svg]:translate-y-0.5 rjsb:[&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "rjsb:bg-background rjsb:text-foreground",
        destructive:
          "rjsb:text-destructive-foreground rjsb:[&>svg]:text-current rjsb:*:data-[slot=alert-description]:text-destructive-foreground/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "rjsb:col-start-2 rjsb:line-clamp-1 rjsb:min-h-4 rjsb:font-medium rjsb:tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "rjsb:text-muted-foreground rjsb:col-start-2 rjsb:grid rjsb:justify-items-start rjsb:gap-1 rjsb:text-sm rjsb:[&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
