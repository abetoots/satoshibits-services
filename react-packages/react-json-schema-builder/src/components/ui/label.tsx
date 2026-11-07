"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "rjsb:flex rjsb:items-center rjsb:gap-2 rjsb:text-sm rjsb:leading-none rjsb:font-medium rjsb:select-none rjsb:group-data-[disabled=true]:pointer-events-none rjsb:group-data-[disabled=true]:opacity-50 rjsb:peer-disabled:cursor-not-allowed rjsb:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
