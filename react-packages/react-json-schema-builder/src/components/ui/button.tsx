import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "rjsb:inline-flex rjsb:items-center rjsb:justify-center rjsb:gap-2 rjsb:whitespace-nowrap rjsb:rounded-md rjsb:text-sm rjsb:font-medium rjsb:transition-[color,box-shadow] rjsb:disabled:pointer-events-none rjsb:disabled:opacity-50 rjsb:[&_svg]:pointer-events-none rjsb:[&_svg:not([class*='size-'])]:size-4 rjsb:shrink-0 rjsb:[&_svg]:shrink-0 rjsb:outline-none rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:focus-visible:ring-[3px] rjsb:aria-invalid:ring-destructive/20 rjsb:dark:aria-invalid:ring-destructive/40 rjsb:aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "rjsb:bg-primary rjsb:text-primary-foreground rjsb:shadow-xs rjsb:hover:bg-primary/90",
        destructive:
          "rjsb:bg-destructive rjsb:text-white rjsb:shadow-xs rjsb:hover:bg-destructive/90 rjsb:focus-visible:ring-destructive/20 rjsb:dark:focus-visible:ring-destructive/40",
        outline:
          "rjsb:border rjsb:border-input rjsb:bg-background rjsb:shadow-xs rjsb:hover:bg-accent rjsb:hover:text-accent-foreground",
        secondary:
          "rjsb:bg-secondary rjsb:text-secondary-foreground rjsb:shadow-xs rjsb:hover:bg-secondary/80",
        ghost: "rjsb:hover:bg-accent rjsb:hover:text-accent-foreground",
        link: "rjsb:text-primary rjsb:underline-offset-4 rjsb:hover:underline",
      },
      size: {
        default: "rjsb:h-9 rjsb:px-4 rjsb:py-2 rjsb:has-[>svg]:px-3",
        sm: "rjsb:h-8 rjsb:rounded-md rjsb:gap-1.5 rjsb:px-3 rjsb:has-[>svg]:px-2.5",
        lg: "rjsb:h-10 rjsb:rounded-md rjsb:px-6 rjsb:has-[>svg]:px-4",
        icon: "rjsb:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// forwards its ref so radix triggers (tooltip) can anchor to it
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> &
    VariantProps<typeof buttonVariants> & { asChild?: boolean }
>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      type="button"
      {...props}
    />
  );
});

export { Button, buttonVariants };
