"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn, ROOT_CLASS } from "@/lib/utils";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-testid="select-trigger"
      className={cn(
        "rjsb:border-input rjsb:data-[placeholder]:text-muted-foreground rjsb:[&_svg:not([class*='text-'])]:text-muted-foreground rjsb:focus-visible:border-ring rjsb:focus-visible:ring-ring/50 rjsb:aria-invalid:ring-destructive/20 rjsb:dark:aria-invalid:ring-destructive/40 rjsb:aria-invalid:border-destructive rjsb:flex rjsb:h-9 rjsb:w-fit rjsb:items-center rjsb:justify-between rjsb:gap-2 rjsb:rounded-md rjsb:border rjsb:bg-transparent rjsb:px-3 rjsb:py-2 rjsb:text-sm rjsb:whitespace-nowrap rjsb:shadow-xs rjsb:transition-[color,box-shadow] rjsb:outline-none rjsb:focus-visible:ring-[3px] rjsb:disabled:cursor-not-allowed rjsb:disabled:opacity-50 rjsb:*:data-[slot=select-value]:line-clamp-1 rjsb:*:data-[slot=select-value]:flex rjsb:*:data-[slot=select-value]:items-center rjsb:*:data-[slot=select-value]:gap-2 rjsb:[&_svg]:pointer-events-none rjsb:[&_svg]:shrink-0 rjsb:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="rjsb:size-4 rjsb:opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          ROOT_CLASS,
          "rjsb:bg-popover rjsb:text-popover-foreground rjsb:data-[state=open]:animate-in rjsb:data-[state=closed]:animate-out rjsb:data-[state=closed]:fade-out-0 rjsb:data-[state=open]:fade-in-0 rjsb:data-[state=closed]:zoom-out-95 rjsb:data-[state=open]:zoom-in-95 rjsb:data-[side=bottom]:slide-in-from-top-2 rjsb:data-[side=left]:slide-in-from-right-2 rjsb:data-[side=right]:slide-in-from-left-2 rjsb:data-[side=top]:slide-in-from-bottom-2 rjsb:relative rjsb:z-50 rjsb:max-h-96 rjsb:min-w-[8rem] rjsb:overflow-hidden rjsb:rounded-md rjsb:border rjsb:shadow-md",
          position === "popper" &&
            "rjsb:data-[side=bottom]:translate-y-1 rjsb:data-[side=left]:-translate-x-1 rjsb:data-[side=right]:translate-x-1 rjsb:data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "rjsb:p-1",
            position === "popper" &&
              "rjsb:h-[var(--radix-select-trigger-height)] rjsb:w-full rjsb:min-w-[var(--radix-select-trigger-width)] rjsb:scroll-my-1",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("rjsb:px-2 rjsb:py-1.5 rjsb:text-sm rjsb:font-medium", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "rjsb:focus:bg-accent rjsb:focus:text-accent-foreground rjsb:[&_svg:not([class*='text-'])]:text-muted-foreground rjsb:relative rjsb:flex rjsb:w-full rjsb:cursor-default rjsb:items-center rjsb:gap-2 rjsb:rounded-sm rjsb:py-1.5 rjsb:pr-8 rjsb:pl-2 rjsb:text-sm rjsb:outline-hidden rjsb:select-none rjsb:data-[disabled]:pointer-events-none rjsb:data-[disabled]:opacity-50 rjsb:[&_svg]:pointer-events-none rjsb:[&_svg]:shrink-0 rjsb:[&_svg:not([class*='size-'])]:size-4 rjsb:*:[span]:last:flex rjsb:*:[span]:last:items-center rjsb:*:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="rjsb:absolute rjsb:right-2 rjsb:flex rjsb:size-3.5 rjsb:items-center rjsb:justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="rjsb:size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("rjsb:bg-border rjsb:pointer-events-none rjsb:-mx-1 rjsb:my-1 rjsb:h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "rjsb:flex rjsb:cursor-default rjsb:items-center rjsb:justify-center rjsb:py-1",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="rjsb:size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "rjsb:flex rjsb:cursor-default rjsb:items-center rjsb:justify-center rjsb:py-1",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="rjsb:size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
