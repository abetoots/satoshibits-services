"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("rjsb:relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // radix's display:table wrapper grows to its content; block lets values truncate
        className="rjsb:[&>div]:block! rjsb:focus-visible:ring-ring/50 rjsb:size-full rjsb:rounded-[inherit] rjsb:transition-[color,box-shadow] rjsb:outline-none rjsb:focus-visible:ring-[3px] rjsb:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "rjsb:flex rjsb:touch-none rjsb:p-px rjsb:transition-colors rjsb:select-none",
        orientation === "vertical" &&
          "rjsb:h-full rjsb:w-2.5 rjsb:border-l rjsb:border-l-transparent",
        orientation === "horizontal" &&
          "rjsb:h-2.5 rjsb:flex-col rjsb:border-t rjsb:border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="rjsb:bg-border rjsb:relative rjsb:flex-1 rjsb:rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
