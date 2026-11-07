import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "rjsb:inline-flex rjsb:items-center rjsb:justify-center rjsb:rounded-md rjsb:border rjsb:px-2 rjsb:py-0.5 rjsb:text-xs rjsb:font-medium rjsb:w-fit rjsb:whitespace-nowrap rjsb:shrink-0 rjsb:[&>svg]:size-3 rjsb:gap-1 rjsb:[&>svg]:pointer-events-none rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:focus-visible:ring-[3px] rjsb:aria-invalid:ring-destructive/20 rjsb:dark:aria-invalid:ring-destructive/40 rjsb:aria-invalid:border-destructive rjsb:transition-[color,box-shadow] rjsb:overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "rjsb:border-transparent rjsb:bg-primary rjsb:text-primary-foreground rjsb:[a&]:hover:bg-primary/90",
        secondary:
          "rjsb:border-transparent rjsb:bg-secondary rjsb:text-secondary-foreground rjsb:[a&]:hover:bg-secondary/90",
        destructive:
          "rjsb:border-transparent rjsb:bg-destructive rjsb:text-white rjsb:[a&]:hover:bg-destructive/90 rjsb:focus-visible:ring-destructive/20 rjsb:dark:focus-visible:ring-destructive/40 rjsb:dark:bg-destructive/60",
        outline:
          "rjsb:text-foreground rjsb:[a&]:hover:bg-accent rjsb:[a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
