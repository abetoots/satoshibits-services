import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("rjsb:flex rjsb:flex-col rjsb:gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "rjsb:bg-muted rjsb:text-muted-foreground rjsb:inline-flex rjsb:h-9 rjsb:w-fit rjsb:items-center rjsb:justify-center rjsb:rounded-lg rjsb:p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "rjsb:data-[state=active]:bg-background rjsb:dark:data-[state=active]:text-foreground rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:focus-visible:outline-ring rjsb:dark:data-[state=active]:border-input rjsb:dark:data-[state=active]:bg-input/30 rjsb:text-foreground rjsb:dark:text-muted-foreground rjsb:inline-flex rjsb:h-[calc(100%-1px)] rjsb:flex-1 rjsb:items-center rjsb:justify-center rjsb:gap-1.5 rjsb:rounded-md rjsb:border rjsb:border-transparent rjsb:px-2 rjsb:py-1 rjsb:text-sm rjsb:font-medium rjsb:whitespace-nowrap rjsb:transition-[color,box-shadow] rjsb:focus-visible:ring-[3px] rjsb:focus-visible:outline-1 rjsb:disabled:pointer-events-none rjsb:disabled:opacity-50 rjsb:data-[state=active]:shadow-sm rjsb:[&_svg]:pointer-events-none rjsb:[&_svg]:shrink-0 rjsb:[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("rjsb:flex-1 rjsb:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
