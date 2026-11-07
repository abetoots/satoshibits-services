import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rjsb:bg-card rjsb:text-card-foreground rjsb:flex rjsb:flex-col rjsb:gap-6 rjsb:rounded-xl rjsb:border rjsb:py-6 rjsb:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "rjsb:@container/card-header rjsb:grid rjsb:auto-rows-min rjsb:grid-rows-[auto_auto] rjsb:items-start rjsb:gap-1.5 rjsb:px-6 rjsb:has-data-[slot=card-action]:grid-cols-[1fr_auto] rjsb:[.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("rjsb:leading-none rjsb:font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("rjsb:text-muted-foreground rjsb:text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "rjsb:col-start-2 rjsb:row-span-2 rjsb:row-start-1 rjsb:self-start rjsb:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("rjsb:px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("rjsb:flex rjsb:items-center rjsb:px-6 rjsb:[.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
