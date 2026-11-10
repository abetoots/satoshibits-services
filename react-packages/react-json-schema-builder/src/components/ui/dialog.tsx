import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn, ROOT_CLASS } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// forwards its ref so the portal's Presence can wait for the exit animation (E3)
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "rjsb:data-[state=open]:animate-in rjsb:data-[state=closed]:animate-out rjsb:data-[state=closed]:fade-out-0 rjsb:data-[state=open]:fade-in-0 rjsb:fixed rjsb:inset-0 rjsb:z-50 rjsb:bg-black/80",
        className
      )}
      {...props}
    />
  )
})

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          ROOT_CLASS,
          "rjsb:bg-background rjsb:data-[state=open]:animate-in rjsb:data-[state=closed]:animate-out rjsb:data-[state=closed]:fade-out-0 rjsb:data-[state=open]:fade-in-0 rjsb:data-[state=closed]:zoom-out-95 rjsb:data-[state=open]:zoom-in-95 rjsb:fixed rjsb:top-[50%] rjsb:left-[50%] rjsb:z-50 rjsb:grid rjsb:w-full rjsb:max-w-[calc(100%-2rem)] rjsb:translate-x-[-50%] rjsb:translate-y-[-50%] rjsb:gap-4 rjsb:rounded-lg rjsb:border rjsb:p-6 rjsb:shadow-lg rjsb:duration-200 rjsb:sm:max-w-lg rjsb:text-foreground",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="rjsb:ring-offset-background rjsb:focus:ring-ring rjsb:data-[state=open]:bg-accent rjsb:data-[state=open]:text-muted-foreground rjsb:absolute rjsb:top-4 rjsb:right-4 rjsb:rounded-xs rjsb:opacity-70 rjsb:transition-opacity rjsb:hover:opacity-100 rjsb:focus:ring-2 rjsb:focus:ring-offset-2 rjsb:focus:outline-hidden rjsb:disabled:pointer-events-none rjsb:[&_svg]:pointer-events-none rjsb:[&_svg]:shrink-0 rjsb:[&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="rjsb:sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("rjsb:flex rjsb:flex-col rjsb:gap-2 rjsb:text-center rjsb:sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "rjsb:flex rjsb:flex-col-reverse rjsb:gap-2 rjsb:sm:flex-row rjsb:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("rjsb:text-lg rjsb:leading-none rjsb:font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("rjsb:text-muted-foreground rjsb:text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
